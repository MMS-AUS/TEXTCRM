import { TRPCError } from '@trpc/server';
import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  addressInputSchema,
  areaForPostcode,
  contactInputSchema,
  contactListInputSchema,
  hasPermission,
  nearestBigCity,
  type AddressValues,
  type ContactValues,
} from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import {
  companies,
  contactAddresses,
  contacts,
  leads,
  projects,
  tickets,
  users,
} from '../../db/schema/index.ts';
import { permissionProcedure, router } from '../../trpc/trpc.ts';
import { diff, entityHistory, recordAudit, type Actor } from '../audit.ts';
import { assertOption } from '../options.ts';
import { containsPattern, phoneContains } from '../search.ts';

const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'This contact does not exist.' });

const idInput = z.object({ id: z.uuid() });

/** `column asc|desc nulls last`, so empty values never crowd the top of a sorted list. */
function sortBy(column: AnyPgColumn | SQL, descending: boolean): SQL {
  return descending ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
}

type ListInput = z.output<typeof contactListInputSchema>;

function listWhere(input: ListInput): SQL | undefined {
  const conditions: SQL[] = [
    input.archived ? isNotNull(contacts.archivedAt) : isNull(contacts.archivedAt),
  ];
  if (input.type) conditions.push(eq(contacts.type, input.type));
  if (input.companyId) conditions.push(eq(contacts.companyId, input.companyId));
  if (input.search) {
    const pattern = containsPattern(input.search);
    const matches = [
      sql`(${contacts.firstName} || ' ' || coalesce(${contacts.lastName}, '')) ilike ${pattern}`,
      ilike(contacts.email, pattern),
      ilike(companies.name, pattern),
      ilike(contactAddresses.suburb, pattern),
      phoneContains(contacts.mobile, input.search),
      phoneContains(contacts.secondaryMobile, input.search),
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
      return [
        sortBy(sql`lower(${contacts.firstName})`, d),
        sortBy(sql`lower(${contacts.lastName})`, d),
      ];
    case 'email':
      return [sortBy(contacts.email, d)];
    case 'type':
      return [sortBy(contacts.type, d)];
    case 'company':
      return [sortBy(sql`lower(${companies.name})`, d)];
    case 'location':
      return [sortBy(contactAddresses.state, d), sortBy(contactAddresses.suburb, d)];
    case 'updatedAt':
      return [sortBy(contacts.updatedAt, d)];
  }
}

/** Another active contact with the same email or mobile (§1.4 duplicate rules). */
async function assertNotDuplicate(db: Db | Tx, values: ContactValues, excludeId?: string) {
  const sameDetails = or(
    values.email ? eq(contacts.email, values.email) : undefined,
    values.mobile ? eq(contacts.mobile, values.mobile) : undefined,
  );
  if (!sameDetails) return;
  const [duplicate] = await db
    .select({ firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
    .from(contacts)
    .where(
      and(
        isNull(contacts.archivedAt),
        sameDetails,
        excludeId ? ne(contacts.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  if (duplicate) {
    const name = [duplicate.firstName, duplicate.lastName].filter(Boolean).join(' ');
    const field = values.email && duplicate.email === values.email ? 'email' : 'mobile';
    throw new TRPCError({
      code: 'CONFLICT',
      message: `${name} already has this ${field}. Search for them instead of adding a duplicate.`,
    });
  }
}

async function assertCompany(db: Db | Tx, companyId: string | null, current?: string | null) {
  if (companyId === null || companyId === current) return;
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), isNull(companies.archivedAt)));
  if (!company) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That company no longer exists.' });
  }
}

async function loadContact(db: Db | Tx, id: string) {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!contact) throw notFound();
  return contact;
}

function assertEditable(contact: { archivedAt: Date | null }) {
  if (contact.archivedAt) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This contact is archived. Restore it before making changes.',
    });
  }
}

/** Stored address = the form values plus area and nearest city worked out from the postcode. */
function addressRow(address: AddressValues) {
  return {
    ...address,
    area: areaForPostcode(address.postcode),
    nearestBigCity: nearestBigCity(address.postcode, address.state),
  };
}

/** Address changes are recorded against the contact, so they show in its history. */
function addressSummary(address: AddressValues) {
  return `${address.streetAddress}, ${address.suburb} ${address.state} ${address.postcode}`;
}

const actorOf = (ctx: { user: { id: string }; meta: Actor['meta'] }): Actor => ({
  userId: ctx.user.id,
  meta: ctx.meta,
});

export const contactsRouter = router({
  list: permissionProcedure('contacts', 'view')
    .input(contactListInputSchema)
    .query(async ({ ctx, input }) => {
      const where = listWhere(input);
      const primaryAddress = and(
        eq(contactAddresses.contactId, contacts.id),
        eq(contactAddresses.isPrimary, true),
      );
      const [rows, [totals]] = await Promise.all([
        ctx.db
          .select({
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            mobile: contacts.mobile,
            type: contacts.type,
            companyId: companies.id,
            companyName: companies.name,
            suburb: contactAddresses.suburb,
            state: contactAddresses.state,
            updatedAt: contacts.updatedAt,
            archivedAt: contacts.archivedAt,
          })
          .from(contacts)
          .leftJoin(companies, eq(companies.id, contacts.companyId))
          .leftJoin(contactAddresses, primaryAddress)
          .where(where)
          .orderBy(...listOrder(input.sort), asc(contacts.id))
          .limit(input.pageSize)
          .offset(input.page * input.pageSize),
        ctx.db
          .select({ total: count() })
          .from(contacts)
          .leftJoin(companies, eq(companies.id, contacts.companyId))
          .leftJoin(contactAddresses, primaryAddress)
          .where(where),
      ]);
      return {
        total: totals?.total ?? 0,
        rows: rows.map((row) => ({
          ...row,
          updatedAt: row.updatedAt.toISOString(),
          archivedAt: row.archivedAt?.toISOString() ?? null,
        })),
      };
    }),

  get: permissionProcedure('contacts', 'view')
    .input(idInput)
    .query(async ({ ctx, input }) => {
      const createdBy = aliasedTable(users, 'created_by');
      const updatedBy = aliasedTable(users, 'updated_by');
      const [row] = await ctx.db
        .select({
          contact: contacts,
          companyName: companies.name,
          createdByName: createdBy.name,
          updatedByName: updatedBy.name,
        })
        .from(contacts)
        .leftJoin(companies, eq(companies.id, contacts.companyId))
        .leftJoin(createdBy, eq(createdBy.id, contacts.createdByUserId))
        .leftJoin(updatedBy, eq(updatedBy.id, contacts.updatedByUserId))
        .where(eq(contacts.id, input.id));
      if (!row) throw notFound();

      const can = (feature: 'leads' | 'projects' | 'tickets') =>
        hasPermission(ctx.user.permissions, feature, 'view');

      const [addresses, linkedLeads, linkedProjects, linkedTickets, history] = await Promise.all([
        ctx.db
          .select()
          .from(contactAddresses)
          .where(eq(contactAddresses.contactId, input.id))
          .orderBy(desc(contactAddresses.isPrimary), asc(contactAddresses.createdAt)),
        can('leads')
          ? ctx.db
              .select({
                id: leads.id,
                status: leads.status,
                suburb: leads.suburb,
                state: leads.state,
                createdAt: leads.createdAt,
              })
              .from(leads)
              .where(eq(leads.contactId, input.id))
              .orderBy(desc(leads.createdAt))
          : null,
        can('projects')
          ? ctx.db
              .select({
                id: projects.id,
                projectNumber: projects.projectNumber,
                title: projects.title,
                status: projects.status,
                stage: projects.stage,
                createdAt: projects.createdAt,
              })
              .from(projects)
              .where(eq(projects.contactId, input.id))
              .orderBy(desc(projects.createdAt))
          : null,
        can('tickets')
          ? ctx.db
              .select({
                id: tickets.id,
                ticketNumber: tickets.ticketNumber,
                title: tickets.title,
                status: tickets.resolutionStatus,
                createdAt: tickets.createdAt,
              })
              .from(tickets)
              .where(eq(tickets.contactId, input.id))
              .orderBy(desc(tickets.createdAt))
          : null,
        entityHistory(ctx.db, 'contact', input.id),
      ]);

      const iso = <T extends { createdAt: Date }>(items: T[] | null) =>
        items?.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })) ?? null;
      const { contact } = row;
      return {
        ...contact,
        createdAt: contact.createdAt.toISOString(),
        updatedAt: contact.updatedAt.toISOString(),
        archivedAt: contact.archivedAt?.toISOString() ?? null,
        lastContactedAt: contact.lastContactedAt?.toISOString() ?? null,
        companyName: row.companyName,
        createdByName: row.createdByName,
        updatedByName: row.updatedByName,
        addresses: addresses.map((address) => ({
          ...address,
          createdAt: address.createdAt.toISOString(),
          updatedAt: address.updatedAt.toISOString(),
        })),
        leads: iso(linkedLeads),
        projects: iso(linkedProjects),
        tickets: iso(linkedTickets),
        history,
      };
    }),

  create: permissionProcedure('contacts', 'create')
    .input(contactInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await assertOption(tx, 'contactTypes', input.type, 'contact type');
        await assertCompany(tx, input.companyId);
        await assertNotDuplicate(tx, input);
        const [created] = await tx
          .insert(contacts)
          .values({
            ...input,
            source: 'Manual',
            createdByUserId: ctx.user.id,
            updatedByUserId: ctx.user.id,
          })
          .returning({ id: contacts.id });
        if (!created) throw new Error('Insert returned no row');
        await recordAudit(tx, actorOf(ctx), {
          action: 'create',
          entityType: 'contact',
          entityId: created.id,
          after: input,
        });
        return created;
      }),
    ),

  update: permissionProcedure('contacts', 'edit')
    .input(z.object({ id: z.uuid(), values: contactInputSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await loadContact(tx, input.id);
        assertEditable(existing);
        const values = input.values;
        await assertOption(tx, 'contactTypes', values.type, 'contact type', existing.type);
        await assertCompany(tx, values.companyId, existing.companyId);
        await assertNotDuplicate(tx, values, input.id);
        const changes = diff(existing, values);
        if (!changes) return { id: input.id };
        await tx
          .update(contacts)
          .set({ ...values, updatedByUserId: ctx.user.id })
          .where(eq(contacts.id, input.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'update',
          entityType: 'contact',
          entityId: input.id,
          ...changes,
        });
        return { id: input.id };
      }),
    ),

  /** Archive = the CRM's delete: hidden from lists, kept for linked leads/projects and history. */
  archive: permissionProcedure('contacts', 'delete')
    .input(idInput)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await loadContact(tx, input.id);
        if (existing.archivedAt) return { id: input.id };
        await tx
          .update(contacts)
          .set({ archivedAt: new Date(), updatedByUserId: ctx.user.id })
          .where(eq(contacts.id, input.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'archive',
          entityType: 'contact',
          entityId: input.id,
        });
        return { id: input.id };
      }),
    ),

  restore: permissionProcedure('contacts', 'delete')
    .input(idInput)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await loadContact(tx, input.id);
        if (!existing.archivedAt) return { id: input.id };
        await tx
          .update(contacts)
          .set({ archivedAt: null, updatedByUserId: ctx.user.id })
          .where(eq(contacts.id, input.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'restore',
          entityType: 'contact',
          entityId: input.id,
        });
        return { id: input.id };
      }),
    ),

  addAddress: permissionProcedure('contacts', 'edit')
    .input(z.object({ contactId: z.uuid(), address: addressInputSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        assertEditable(await loadContact(tx, input.contactId));
        const [{ existing } = { existing: 0 }] = await tx
          .select({ existing: count() })
          .from(contactAddresses)
          .where(eq(contactAddresses.contactId, input.contactId));
        // The first address is always the primary one.
        const isPrimary = input.address.isPrimary || existing === 0;
        if (isPrimary) {
          await tx
            .update(contactAddresses)
            .set({ isPrimary: false })
            .where(eq(contactAddresses.contactId, input.contactId));
        }
        const [created] = await tx
          .insert(contactAddresses)
          .values({ ...addressRow({ ...input.address, isPrimary }), contactId: input.contactId })
          .returning({ id: contactAddresses.id });
        if (!created) throw new Error('Insert returned no row');
        await tx
          .update(contacts)
          .set({ updatedByUserId: ctx.user.id })
          .where(eq(contacts.id, input.contactId));
        await recordAudit(tx, actorOf(ctx), {
          action: 'address_add',
          entityType: 'contact',
          entityId: input.contactId,
          after: { address: addressSummary(input.address), isPrimary },
        });
        return created;
      }),
    ),

  updateAddress: permissionProcedure('contacts', 'edit')
    .input(z.object({ id: z.uuid(), address: addressInputSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(contactAddresses)
          .where(eq(contactAddresses.id, input.id));
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'This address no longer exists.' });
        }
        assertEditable(await loadContact(tx, existing.contactId));
        // The primary address can't be un-set directly — make another one primary instead.
        const isPrimary = input.address.isPrimary || existing.isPrimary;
        if (isPrimary && !existing.isPrimary) {
          await tx
            .update(contactAddresses)
            .set({ isPrimary: false })
            .where(eq(contactAddresses.contactId, existing.contactId));
        }
        const row = addressRow({ ...input.address, isPrimary });
        const changes = diff(existing, row);
        if (!changes) return { id: input.id };
        await tx.update(contactAddresses).set(row).where(eq(contactAddresses.id, input.id));
        await tx
          .update(contacts)
          .set({ updatedByUserId: ctx.user.id })
          .where(eq(contacts.id, existing.contactId));
        await recordAudit(tx, actorOf(ctx), {
          action: 'address_update',
          entityType: 'contact',
          entityId: existing.contactId,
          ...changes,
        });
        return { id: input.id };
      }),
    ),

  removeAddress: permissionProcedure('contacts', 'edit')
    .input(idInput)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(contactAddresses)
          .where(eq(contactAddresses.id, input.id));
        if (!existing) return { id: input.id };
        assertEditable(await loadContact(tx, existing.contactId));
        await tx.delete(contactAddresses).where(eq(contactAddresses.id, input.id));
        if (existing.isPrimary) {
          // Promote the oldest remaining address so the contact keeps a primary one.
          const [next] = await tx
            .select({ id: contactAddresses.id })
            .from(contactAddresses)
            .where(eq(contactAddresses.contactId, existing.contactId))
            .orderBy(asc(contactAddresses.createdAt))
            .limit(1);
          if (next) {
            await tx
              .update(contactAddresses)
              .set({ isPrimary: true })
              .where(eq(contactAddresses.id, next.id));
          }
        }
        await tx
          .update(contacts)
          .set({ updatedByUserId: ctx.user.id })
          .where(eq(contacts.id, existing.contactId));
        await recordAudit(tx, actorOf(ctx), {
          action: 'address_remove',
          entityType: 'contact',
          entityId: existing.contactId,
          before: {
            address:
              `${existing.streetAddress}, ${existing.suburb} ${existing.state} ${existing.postcode ?? ''}`.trim(),
          },
        });
        return { id: input.id };
      }),
    ),
});
