import { TRPCError } from '@trpc/server';
import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  areaForPostcode,
  businessToday,
  findDuplicateLead,
  formatPhone,
  LEAD_CONVERTED,
  LEAD_LOST,
  LEAD_PIPELINE,
  leadFiltersSchema,
  leadIdsSchema,
  leadInputSchema,
  leadListInputSchema,
  nearestBigCity,
  normaliseName,
  type DuplicateCandidate,
  type LeadValues,
} from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import { activities, contacts, leads, projects, users } from '../../db/schema/index.ts';
import { permissionProcedure, router } from '../../trpc/trpc.ts';
import { openTasksWhere, logSystemActivity } from '../activities/service.ts';
import { findMatchingContact } from '../contacts/match.ts';
import { leadDetailProcedures, loadLeadDetails } from './details.ts';
import { diff, entityHistory, recordAudit, type Actor } from '../audit.ts';
import { assertOption } from '../options.ts';
import { containsPattern, phoneContains } from '../search.ts';

type Filters = z.output<typeof leadFiltersSchema>;
type ListInput = z.output<typeof leadListInputSchema>;

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'This lead does not exist.' });

const owner = aliasedTable(users, 'owner');

const fullNameSql = sql<string>`${leads.firstName} || coalesce(' ' || ${leads.lastName}, '')`;

function sortBy(column: AnyPgColumn | SQL, descending: boolean): SQL {
  return descending ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
}

/** Statuses sort in pipeline order (New → … → Deposit Received → Converted → Lost). */
const statusOrder = sql`array_position(array[${sql.join(
  [...LEAD_PIPELINE, LEAD_CONVERTED, LEAD_LOST].map((status) => sql`${status}`),
  sql`, `,
)}]::text[], ${leads.status})`;

function filtersWhere(filters: Filters, userId: string, ignoreStatuses = false): SQL | undefined {
  const conditions: SQL[] = [
    filters.deleted ? isNotNull(leads.deletedAt) : isNull(leads.deletedAt),
  ];
  if (!ignoreStatuses && filters.statuses.length > 0) {
    conditions.push(inArray(leads.status, filters.statuses));
  }
  if (filters.platform) conditions.push(eq(leads.platform, filters.platform));
  if (filters.state) conditions.push(eq(leads.state, filters.state));
  if (filters.owner === 'me') conditions.push(eq(leads.ownerUserId, userId));
  else if (filters.owner === 'none') conditions.push(isNull(leads.ownerUserId));
  else if (filters.owner) conditions.push(eq(leads.ownerUserId, filters.owner));
  if (filters.dateFrom) conditions.push(gte(leads.leadDate, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(leads.leadDate, filters.dateTo));
  if (filters.search) {
    const pattern = containsPattern(filters.search);
    const matches = [
      sql`${fullNameSql} ilike ${pattern}`,
      ilike(leads.email, pattern),
      ilike(leads.suburb, pattern),
      /^\d{4}$/.test(filters.search) ? eq(leads.postcode, filters.search) : undefined,
      phoneContains(leads.mobile, filters.search),
      phoneContains(leads.secondaryMobile, filters.search),
    ].filter((condition) => condition !== undefined);
    const anyMatch = or(...matches);
    if (anyMatch) conditions.push(anyMatch);
  }
  return and(...conditions);
}

function listOrder(sort: ListInput['sort']): SQL[] {
  const d = sort.desc;
  switch (sort.id) {
    case 'name':
      return [sortBy(sql`lower(${leads.firstName})`, d), sortBy(sql`lower(${leads.lastName})`, d)];
    case 'leadDate':
      return [sortBy(leads.leadDate, d), sortBy(leads.createdAt, d)];
    case 'status':
      return [sortBy(statusOrder, d)];
    case 'platform':
      return [sortBy(leads.platform, d)];
    case 'owner':
      return [sortBy(sql`lower(${owner.name})`, d)];
    case 'location':
      return [sortBy(leads.state, d), sortBy(leads.suburb, d)];
    case 'updatedAt':
      return [sortBy(leads.updatedAt, d)];
  }
}

const actorOf = (ctx: { user: { id: string }; meta: Actor['meta'] }): Actor => ({
  userId: ctx.user.id,
  meta: ctx.meta,
});

async function loadLead(db: Db | Tx, id: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) throw notFound();
  return lead;
}

function assertEditable(lead: { deletedAt: Date | null; status: string }) {
  if (lead.deletedAt) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This lead is deleted. Restore it before making changes.',
    });
  }
}

/** Status rules: must be a listed status; "Converted to Project" only via conversion (Step 2.5). */
async function assertStatusChange(db: Db | Tx, from: string | null, to: string) {
  if (from === to) return;
  if (from === LEAD_CONVERTED) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This lead has been converted to a project; its status can no longer change.',
    });
  }
  if (to === LEAD_CONVERTED) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Use "Convert to project" to convert a lead.',
    });
  }
  await assertOption(db, 'leadStatuses', to, 'lead status');
}

async function assertOwner(db: Db | Tx, ownerUserId: string | null, current?: string | null) {
  if (ownerUserId === null || ownerUserId === current) return;
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, ownerUserId), eq(users.isActive, true)));
  if (!user) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That person is not an active user.' });
  }
}

async function userName(db: Db | Tx, id: string | null): Promise<string | null> {
  if (!id) return null;
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, id));
  return user?.name ?? null;
}

/**
 * Live leads that could be the same enquiry: same email, same phone, or same name. The precise
 * same-person-same-property decision is made by findDuplicateLead (shared, unit-tested).
 */
export async function findDuplicate(
  db: Db | Tx,
  candidate: DuplicateCandidate,
  excludeId?: string,
) {
  const phones = [candidate.mobile, candidate.secondaryMobile].filter((phone): phone is string =>
    Boolean(phone),
  );
  const name = normaliseName(`${candidate.firstName} ${candidate.lastName ?? ''}`);
  const possible = or(
    candidate.email ? eq(leads.email, candidate.email) : undefined,
    phones.length ? inArray(leads.mobile, phones) : undefined,
    phones.length ? inArray(leads.secondaryMobile, phones) : undefined,
    name.length > 2
      ? sql`lower(regexp_replace(btrim(${fullNameSql}), '\\s+', ' ', 'g')) = ${name}`
      : undefined,
  );
  if (!possible) return null;
  const rows = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      mobile: leads.mobile,
      secondaryMobile: leads.secondaryMobile,
      streetAddress: leads.streetAddress,
      suburb: leads.suburb,
      postcode: leads.postcode,
      state: leads.state,
      status: leads.status,
      leadDate: leads.leadDate,
    })
    .from(leads)
    .where(and(isNull(leads.deletedAt), possible, excludeId ? ne(leads.id, excludeId) : undefined))
    .orderBy(desc(leads.createdAt))
    .limit(50);
  return findDuplicateLead(candidate, rows);
}

/** Stored lead fields: the form values plus area/nearest city from the postcode. */
export function leadRow(values: LeadValues) {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email,
    mobile: values.mobile,
    secondaryMobile: values.secondaryMobile,
    streetAddress: values.streetAddress,
    suburb: values.suburb,
    state: values.state,
    postcode: values.postcode,
    area: areaForPostcode(values.postcode),
    nearestBigCity:
      values.postcode || values.state ? nearestBigCity(values.postcode, values.state) : null,
    platform: values.platform,
    source: values.source,
    status: values.status,
    ownerUserId: values.ownerUserId,
    notes: values.notes,
  };
}

async function validateLead(db: Db | Tx, values: LeadValues, current?: typeof leads.$inferSelect) {
  await assertOption(db, 'platforms', values.platform, 'platform', current?.platform);
  await assertOption(db, 'leadSources', values.source, 'lead source', current?.source);
  await assertStatusChange(db, current?.status ?? null, values.status);
  await assertOwner(db, values.ownerUserId, current?.ownerUserId);
}

function duplicateError(match: NonNullable<Awaited<ReturnType<typeof findDuplicate>>>) {
  const name = [match.lead.firstName, match.lead.lastName].filter(Boolean).join(' ');
  return new TRPCError({
    code: 'CONFLICT',
    message: `This looks like ${name}'s existing lead (${match.reason}). Open that lead instead of adding it again.`,
  });
}

/** System timeline entries for status and owner changes. */
async function logChanges(
  tx: Tx,
  leadId: string,
  actorId: string,
  before: { status: string; ownerUserId: string | null },
  after: { status: string; ownerUserId: string | null },
) {
  if (before.status !== after.status) {
    await logSystemActivity(tx, {
      entityType: 'lead',
      entityId: leadId,
      authorUserId: actorId,
      subject: `Status changed from ${before.status} to ${after.status}`,
      metadata: { field: 'status', from: before.status, to: after.status },
    });
  }
  if (before.ownerUserId !== after.ownerUserId) {
    const name = await userName(tx, after.ownerUserId);
    await logSystemActivity(tx, {
      entityType: 'lead',
      entityId: leadId,
      authorUserId: actorId,
      subject: name ? `Assigned to ${name}` : 'Unassigned',
      metadata: { field: 'owner', from: before.ownerUserId, to: after.ownerUserId },
    });
  }
}

/** Apply a status or owner change to one lead, with timeline + audit. */
async function changeLead(
  tx: Tx,
  ctx: { user: { id: string }; meta: Actor['meta'] },
  id: string,
  patch: { status?: string; ownerUserId?: string | null },
) {
  const existing = await loadLead(tx, id);
  assertEditable(existing);
  if (patch.status !== undefined) await assertStatusChange(tx, existing.status, patch.status);
  if (patch.ownerUserId !== undefined)
    await assertOwner(tx, patch.ownerUserId, existing.ownerUserId);
  const after = {
    status: patch.status ?? existing.status,
    ownerUserId: patch.ownerUserId === undefined ? existing.ownerUserId : patch.ownerUserId,
  };
  const changes = diff(existing, after);
  if (!changes) return false;
  await tx
    .update(leads)
    .set({ ...after, crmEditedAt: new Date(), updatedByUserId: ctx.user.id })
    .where(eq(leads.id, id));
  await logChanges(tx, id, ctx.user.id, existing, after);
  await recordAudit(tx, actorOf(ctx), {
    action: 'update',
    entityType: 'lead',
    entityId: id,
    ...changes,
  });
  return true;
}

async function setDeleted(
  tx: Tx,
  ctx: { user: { id: string }; meta: Actor['meta'] },
  id: string,
  deleted: boolean,
) {
  const existing = await loadLead(tx, id);
  if (Boolean(existing.deletedAt) === deleted) return false;
  if (deleted && existing.status === LEAD_CONVERTED) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A lead that became a project cannot be deleted.',
    });
  }
  await tx
    .update(leads)
    .set({ deletedAt: deleted ? new Date() : null, updatedByUserId: ctx.user.id })
    .where(eq(leads.id, id));
  await recordAudit(tx, actorOf(ctx), {
    action: deleted ? 'delete' : 'restore',
    entityType: 'lead',
    entityId: id,
  });
  return true;
}

/** Runs `change` on each lead; leads the rules refuse are skipped and reported, not fatal. */
async function bulk(
  db: Db,
  ids: string[],
  change: (tx: Tx, id: string) => Promise<boolean>,
): Promise<{ updated: number; skipped: { id: string; reason: string }[] }> {
  let updated = 0;
  const skipped: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      if (await db.transaction((tx) => change(tx, id))) updated += 1;
    } catch (error) {
      if (!(error instanceof TRPCError) || error.code === 'INTERNAL_SERVER_ERROR') throw error;
      skipped.push({ id, reason: error.message });
    }
  }
  return { updated, skipped };
}

export const leadsRouter = router({
  ...leadDetailProcedures,
  list: permissionProcedure('leads', 'view')
    .input(leadListInputSchema)
    .query(async ({ ctx, input }) => {
      const where = filtersWhere(input, ctx.user.id);
      const [rows, [totals]] = await Promise.all([
        ctx.db
          .select({
            id: leads.id,
            firstName: leads.firstName,
            lastName: leads.lastName,
            email: leads.email,
            mobile: leads.mobile,
            suburb: leads.suburb,
            state: leads.state,
            postcode: leads.postcode,
            platform: leads.platform,
            source: leads.source,
            status: leads.status,
            leadDate: leads.leadDate,
            ownerUserId: leads.ownerUserId,
            ownerName: owner.name,
            contactId: leads.contactId,
            updatedAt: leads.updatedAt,
            deletedAt: leads.deletedAt,
          })
          .from(leads)
          .leftJoin(owner, eq(owner.id, leads.ownerUserId))
          .where(where)
          .orderBy(...listOrder(input.sort), desc(leads.createdAt), asc(leads.id))
          .limit(input.pageSize)
          .offset(input.page * input.pageSize),
        ctx.db.select({ total: count() }).from(leads).where(where),
      ]);
      return {
        total: totals?.total ?? 0,
        rows: rows.map((row) => ({
          ...row,
          updatedAt: row.updatedAt.toISOString(),
          deletedAt: row.deletedAt?.toISOString() ?? null,
        })),
      };
    }),

  /** Leads per status for the current filters (ignoring the status filter) — the status pills. */
  statusCounts: permissionProcedure('leads', 'view')
    .input(leadFiltersSchema)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ status: leads.status, total: count() })
        .from(leads)
        .where(filtersWhere(input, ctx.user.id, true))
        .groupBy(leads.status);
      return Object.fromEntries(rows.map((row) => [row.status, row.total]));
    }),

  get: permissionProcedure('leads', 'view')
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const createdBy = aliasedTable(users, 'created_by');
      const [row] = await ctx.db
        .select({
          lead: leads,
          ownerName: owner.name,
          createdByName: createdBy.name,
          contactFirstName: contacts.firstName,
          contactLastName: contacts.lastName,
        })
        .from(leads)
        .leftJoin(owner, eq(owner.id, leads.ownerUserId))
        .leftJoin(createdBy, eq(createdBy.id, leads.createdByUserId))
        .leftJoin(contacts, eq(contacts.id, leads.contactId))
        .where(eq(leads.id, input.id));
      if (!row) throw notFound();
      const { lead } = row;

      const [otherLeads, [openTasks], history, details, [project]] = await Promise.all([
        lead.contactId
          ? ctx.db
              .select({
                id: leads.id,
                status: leads.status,
                suburb: leads.suburb,
                state: leads.state,
                leadDate: leads.leadDate,
              })
              .from(leads)
              .where(
                and(
                  eq(leads.contactId, lead.contactId),
                  ne(leads.id, lead.id),
                  isNull(leads.deletedAt),
                ),
              )
              .orderBy(desc(leads.leadDate))
          : [],
        ctx.db.select({ total: count() }).from(activities).where(openTasksWhere('lead', lead.id)),
        entityHistory(ctx.db, 'lead', lead.id),
        loadLeadDetails(ctx.db, lead.id),
        ctx.db
          .select({ id: projects.id, projectNumber: projects.projectNumber })
          .from(projects)
          .where(eq(projects.leadId, lead.id)),
      ]);

      return {
        ...lead,
        createdAt: lead.createdAt.toISOString(),
        updatedAt: lead.updatedAt.toISOString(),
        deletedAt: lead.deletedAt?.toISOString() ?? null,
        convertedAt: lead.convertedAt?.toISOString() ?? null,
        crmEditedAt: lead.crmEditedAt?.toISOString() ?? null,
        ownerName: row.ownerName,
        createdByName: row.createdByName,
        contactName: row.contactFirstName
          ? [row.contactFirstName, row.contactLastName].filter(Boolean).join(' ')
          : null,
        otherLeads,
        openTasks: openTasks?.total ?? 0,
        history,
        ...details,
        /** The project this lead was converted into, if any. */
        project: project ?? null,
      };
    }),

  /** Live duplicate warning for the "New lead" form; create() enforces the same rule. */
  checkDuplicate: permissionProcedure('leads', 'view')
    .input(z.object({ values: leadInputSchema, excludeId: z.uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const [match, contact] = await Promise.all([
        findDuplicate(ctx.db, input.values, input.excludeId),
        findMatchingContact(ctx.db, input.values),
      ]);
      return {
        duplicate: match && {
          id: match.lead.id,
          name: [match.lead.firstName, match.lead.lastName].filter(Boolean).join(' '),
          status: match.lead.status,
          leadDate: match.lead.leadDate,
          suburb: match.lead.suburb,
          phone: formatPhone(match.lead.mobile),
          matchedOn: match.matchedOn,
          reason: match.reason,
        },
        contact: contact && {
          id: contact.id,
          name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
        },
      };
    }),

  create: permissionProcedure('leads', 'create')
    .input(
      z.object({
        values: leadInputSchema,
        /** A name-only match may be a namesake; the user confirmed it's a different person. */
        confirmNotDuplicate: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const { values } = input;
        await validateLead(tx, values);
        const match = await findDuplicate(tx, values);
        if (match && (match.matchedOn !== 'name' || !input.confirmNotDuplicate)) {
          throw duplicateError(match);
        }
        const contact = await findMatchingContact(tx, values);
        const [created] = await tx
          .insert(leads)
          .values({
            ...leadRow(values),
            leadDate: values.leadDate ?? businessToday(),
            contactId: contact?.id ?? null,
            createdByUserId: ctx.user.id,
            updatedByUserId: ctx.user.id,
          })
          .returning({ id: leads.id });
        if (!created) throw new Error('Insert returned no row');
        await logSystemActivity(tx, {
          entityType: 'lead',
          entityId: created.id,
          authorUserId: ctx.user.id,
          subject: 'Lead created',
          metadata: { status: values.status },
        });
        await recordAudit(tx, actorOf(ctx), {
          action: 'create',
          entityType: 'lead',
          entityId: created.id,
          after: { ...leadRow(values), contactId: contact?.id ?? null },
        });
        return created;
      }),
    ),

  update: permissionProcedure('leads', 'edit')
    .input(z.object({ id: z.uuid(), values: leadInputSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await loadLead(tx, input.id);
        assertEditable(existing);
        const { values } = input;
        await validateLead(tx, values, existing);
        const match = await findDuplicate(tx, values, input.id);
        if (match && match.matchedOn !== 'name') throw duplicateError(match);

        const row = {
          ...leadRow(values),
          leadDate: values.leadDate ?? existing.leadDate,
          contactId: existing.contactId ?? (await findMatchingContact(tx, values))?.id ?? null,
        };
        const changes = diff(existing, row);
        if (!changes) return { id: input.id };
        await tx
          .update(leads)
          .set({ ...row, crmEditedAt: new Date(), updatedByUserId: ctx.user.id })
          .where(eq(leads.id, input.id));
        await logChanges(tx, input.id, ctx.user.id, existing, row);
        await recordAudit(tx, actorOf(ctx), {
          action: 'update',
          entityType: 'lead',
          entityId: input.id,
          ...changes,
        });
        return { id: input.id };
      }),
    ),

  setStatus: permissionProcedure('leads', 'edit')
    .input(z.object({ id: z.uuid(), status: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction((tx) => changeLead(tx, ctx, input.id, { status: input.status }));
      return { id: input.id };
    }),

  assign: permissionProcedure('leads', 'edit')
    .input(z.object({ id: z.uuid(), ownerUserId: z.uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction((tx) =>
        changeLead(tx, ctx, input.id, { ownerUserId: input.ownerUserId }),
      );
      return { id: input.id };
    }),

  /** Soft delete: hidden from lists, restorable from the "Deleted" filter. */
  remove: permissionProcedure('leads', 'delete')
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction((tx) => setDeleted(tx, ctx, input.id, true));
      return { id: input.id };
    }),

  restore: permissionProcedure('leads', 'delete')
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction((tx) => setDeleted(tx, ctx, input.id, false));
      return { id: input.id };
    }),

  bulkAssign: permissionProcedure('leads', 'edit')
    .input(z.object({ ids: leadIdsSchema, ownerUserId: z.uuid().nullable() }))
    .mutation(({ ctx, input }) =>
      bulk(ctx.db, input.ids, (tx, id) =>
        changeLead(tx, ctx, id, { ownerUserId: input.ownerUserId }),
      ),
    ),

  bulkSetStatus: permissionProcedure('leads', 'edit')
    .input(z.object({ ids: leadIdsSchema, status: z.string().trim().min(1) }))
    .mutation(({ ctx, input }) =>
      bulk(ctx.db, input.ids, (tx, id) => changeLead(tx, ctx, id, { status: input.status })),
    ),

  bulkDelete: permissionProcedure('leads', 'delete')
    .input(z.object({ ids: leadIdsSchema }))
    .mutation(({ ctx, input }) =>
      bulk(ctx.db, input.ids, (tx, id) => setDeleted(tx, ctx, id, true)),
    ),
});
