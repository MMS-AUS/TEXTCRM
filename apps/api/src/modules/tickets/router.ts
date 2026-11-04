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
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  businessToday,
  installerVisitSchema,
  isTicketClosed,
  TICKET_DEFAULT_STATUS,
  TICKET_PRIORITIES,
  ticketFiltersSchema,
  ticketHardwareSchema,
  ticketInputSchema,
  ticketListInputSchema,
  ticketTriageSchema,
  type TicketTriageValues,
  warrantyClaimSchema,
} from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import {
  companies,
  contacts,
  projects,
  ticketHardware,
  ticketInstallerVisits,
  tickets,
  ticketWarrantyClaims,
  users,
} from '../../db/schema/index.ts';
import { permissionProcedure, router } from '../../trpc/trpc.ts';
import { logSystemActivity } from '../activities/service.ts';
import { diff, recordAudit, type Actor } from '../audit.ts';
import { assertOption } from '../options.ts';
import { containsPattern, phoneContains } from '../search.ts';

// Service tickets (Step 2.8, §1.4). The ticket core holds triage and resolution; hardware
// rows, warranty claims and installer visits are child rows. Every change is permission
// checked, option-checked, audit-logged, and status changes go on the ticket's timeline.

type Ticket = typeof tickets.$inferSelect;
type Ctx = { user: { id: string }; meta: Actor['meta'] };
type Filters = z.output<typeof ticketFiltersSchema>;
type ListInput = z.output<typeof ticketListInputSchema>;

const actorOf = (ctx: Ctx): Actor => ({ userId: ctx.user.id, meta: ctx.meta });
const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'This ticket does not exist.' });

const assignee = aliasedTable(users, 'assignee');
const customerName = sql<string>`${contacts.firstName} || coalesce(' ' || ${contacts.lastName}, '')`;
const priorityOrder = sql`array_position(array[${sql.join(
  TICKET_PRIORITIES.map((p) => sql`${p}`),
  sql`, `,
)}]::text[], ${tickets.priority})`;

async function loadTicket(db: Db | Tx, id: string): Promise<Ticket> {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id));
  if (!ticket) throw notFound();
  return ticket;
}

async function touch(tx: Tx, ctx: Ctx, id: string) {
  await tx.update(tickets).set({ updatedByUserId: ctx.user.id }).where(eq(tickets.id, id));
}

/** TKT-2026-0001: per-year sequence, serialised with an advisory lock (like project numbers). */
async function nextTicketNumber(tx: Tx): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ticket_number'))`);
  const prefix = `TKT-${businessToday().slice(0, 4)}-`;
  const [row] = await tx
    .select({
      highest: sql<number>`coalesce(max(substring(${tickets.ticketNumber} from ${prefix.length + 1}::int)::int), 0)`,
    })
    .from(tickets)
    .where(sql`${tickets.ticketNumber} ~ ${`^${prefix}[0-9]+$`}`);
  return `${prefix}${String((row?.highest ?? 0) + 1).padStart(4, '0')}`;
}

/** The customer must exist; a linked project must be that customer's. */
async function assertLinks(tx: Tx, contactId: string, projectId: string | null) {
  const [contact] = await tx
    .select({ id: contacts.id, archivedAt: contacts.archivedAt })
    .from(contacts)
    .where(eq(contacts.id, contactId));
  if (!contact)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That customer does not exist.' });
  if (!projectId) return;
  const [project] = await tx
    .select({ contactId: projects.contactId, deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project || project.deletedAt) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That project does not exist.' });
  }
  if (project.contactId !== contactId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "That project belongs to another customer. Choose one of this customer's projects.",
    });
  }
}

async function assertActiveUser(tx: Tx, userId: string | null, current: string | null = null) {
  if (!userId || userId === current) return;
  const [user] = await tx
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId));
  if (!user?.isActive) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose an active staff member.' });
  }
}

/** Timeline entry on the ticket — and on its project, so the job's history shows service work. */
async function logOnTicket(tx: Tx, ctx: Ctx, ticket: Ticket, subject: string, metadata = {}) {
  await logSystemActivity(tx, {
    entityType: 'ticket',
    entityId: ticket.id,
    authorUserId: ctx.user.id,
    subject,
    metadata,
  });
}

function filtersWhere(filters: Filters, userId: string): SQL | undefined {
  const conditions: SQL[] = [];
  if (filters.state === 'open') conditions.push(isNull(tickets.closedAt));
  if (filters.state === 'closed') conditions.push(isNotNull(tickets.closedAt));
  if (filters.status) conditions.push(eq(tickets.resolutionStatus, filters.status));
  if (filters.priority) conditions.push(eq(tickets.priority, filters.priority));
  if (filters.category) conditions.push(eq(tickets.category, filters.category));
  if (filters.assigned === 'me') conditions.push(eq(tickets.assignedUserId, userId));
  else if (filters.assigned === 'none') conditions.push(isNull(tickets.assignedUserId));
  else if (filters.assigned) conditions.push(eq(tickets.assignedUserId, filters.assigned));
  if (filters.contactId) conditions.push(eq(tickets.contactId, filters.contactId));
  if (filters.projectId) conditions.push(eq(tickets.projectId, filters.projectId));
  if (filters.age) {
    const days = (n: number) => sql`now() - make_interval(days => ${n})`;
    if (filters.age === 'week') conditions.push(gte(tickets.createdAt, days(7)));
    if (filters.age === 'month') {
      conditions.push(lt(tickets.createdAt, days(7)), gte(tickets.createdAt, days(30)));
    }
    if (filters.age === 'older') conditions.push(lt(tickets.createdAt, days(30)));
  }
  if (filters.search) {
    const pattern = containsPattern(filters.search);
    const matches = or(
      ilike(tickets.ticketNumber, pattern),
      ilike(tickets.title, pattern),
      sql`${customerName} ilike ${pattern}`,
      ilike(contacts.email, pattern),
      ilike(projects.projectNumber, pattern),
      phoneContains(contacts.mobile, filters.search),
    );
    if (matches) conditions.push(matches);
  }
  return conditions.length ? and(...conditions) : undefined;
}

function sortBy(column: AnyPgColumn | SQL, descending: boolean): SQL {
  return descending ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
}

function listOrder(sort: ListInput['sort']): SQL[] {
  const d = sort.desc;
  switch (sort.id) {
    case 'ticketNumber':
      return [sortBy(tickets.createdAt, d)];
    case 'customer':
      return [sortBy(sql`lower(${customerName})`, d)];
    case 'priority':
      return [sortBy(priorityOrder, d), sortBy(tickets.createdAt, false)];
    case 'status':
      return [sortBy(tickets.resolutionStatus, d)];
    case 'age':
      // Older tickets first when descending.
      return [sortBy(tickets.createdAt, !d)];
    case 'updatedAt':
      return [sortBy(tickets.updatedAt, d)];
  }
}

const rowFields = {
  id: tickets.id,
  ticketNumber: tickets.ticketNumber,
  title: tickets.title,
  category: tickets.category,
  priority: tickets.priority,
  resolutionStatus: tickets.resolutionStatus,
  contactId: tickets.contactId,
  customerName,
  suburb: sql<
    string | null
  >`(select ca.suburb from contact_addresses ca where ca.contact_id = ${contacts.id} order by ca.is_primary desc limit 1)`,
  projectId: tickets.projectId,
  projectNumber: projects.projectNumber,
  assignedUserId: tickets.assignedUserId,
  assignedName: assignee.name,
  createdAt: tickets.createdAt,
  closedAt: tickets.closedAt,
  updatedAt: tickets.updatedAt,
};

function baseQuery(db: Db, where: SQL | undefined) {
  return db
    .select(rowFields)
    .from(tickets)
    .innerJoin(contacts, eq(contacts.id, tickets.contactId))
    .leftJoin(projects, eq(projects.id, tickets.projectId))
    .leftJoin(assignee, eq(assignee.id, tickets.assignedUserId))
    .where(where)
    .$dynamic();
}

type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>['execute']>>[number];

const toRow = (row: Row) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  closedAt: row.closedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Saves the triage flow and resolution. A closing status (TICKET_CLOSED_STATUSES) closes the
 * ticket and dates the resolution today unless given; any other status reopens it.
 */
async function applyTriage(tx: Tx, ctx: Ctx, id: string, triage: TicketTriageValues) {
  const existing = await loadTicket(tx, id);
  const values = { ...triage };
  const lists = [
    ['ticketIssueRecordedOptions', 'issueRecorded', 'issue'],
    ['ticketInitialCheckOptions', 'initialCheck', 'initial check'],
    ['ticketWorkRequiredOptions', 'workRequired', 'work required'],
    ['ticketIssueResolutionStatuses', 'resolutionStatus', 'resolution status'],
  ] as const;
  for (const [list, key, label] of lists) {
    await assertOption(tx, list, values[key], label, existing[key]);
  }
  const closing = isTicketClosed(values.resolutionStatus);
  if (closing && !values.resolvedDate)
    values.resolvedDate = existing.resolvedDate ?? businessToday();
  if (!closing) values.resolvedDate = null;
  const closedAt = closing ? (existing.closedAt ?? new Date()) : null;
  const changes = diff(existing, values);
  if (!changes && Boolean(existing.closedAt) === closing) return { id: existing.id };
  await tx
    .update(tickets)
    .set({ ...values, closedAt, updatedByUserId: ctx.user.id })
    .where(eq(tickets.id, existing.id));
  if (existing.resolutionStatus !== values.resolutionStatus) {
    const reopened = Boolean(existing.closedAt) && !closing;
    await logOnTicket(
      tx,
      ctx,
      existing,
      reopened ? `Reopened: ${values.resolutionStatus}` : `Status: ${values.resolutionStatus}`,
      { from: existing.resolutionStatus, to: values.resolutionStatus },
    );
    if (closing && existing.projectId) {
      await logSystemActivity(tx, {
        entityType: 'project',
        entityId: existing.projectId,
        authorUserId: ctx.user.id,
        subject: `Service ticket ${existing.ticketNumber} closed: ${values.resolutionStatus}`,
        metadata: { ticketId: existing.id },
      });
    }
  }
  for (const step of ['issueRecorded', 'initialCheck', 'workRequired'] as const) {
    if (values[step] && values[step] !== existing[step]) {
      const label = {
        issueRecorded: 'Issue',
        initialCheck: 'Initial check',
        workRequired: 'Work required',
      }[step];
      await logOnTicket(tx, ctx, existing, `${label}: ${values[step]}`);
    }
  }
  await recordAudit(tx, actorOf(ctx), {
    action: 'update_triage',
    entityType: 'ticket',
    entityId: existing.id,
    ...(changes ?? {}),
  });
  return { id: existing.id, closed: closing };
}

const childInput = <S extends z.ZodType>(values: S) =>
  z.object({ ticketId: z.uuid(), id: z.uuid().optional(), values });
const childRemove = z.object({ ticketId: z.uuid(), id: z.uuid() });

const editProcedure = permissionProcedure('tickets', 'edit');

export const ticketsRouter = router({
  list: permissionProcedure('tickets', 'view')
    .input(ticketListInputSchema)
    .query(async ({ ctx, input }) => {
      const where = filtersWhere(input, ctx.user.id);
      const [rows, [total]] = await Promise.all([
        baseQuery(ctx.db, where)
          .orderBy(...listOrder(input.sort), desc(tickets.id))
          .limit(input.pageSize)
          .offset(input.page * input.pageSize),
        ctx.db
          .select({ total: count() })
          .from(tickets)
          .innerJoin(contacts, eq(contacts.id, tickets.contactId))
          .leftJoin(projects, eq(projects.id, tickets.projectId))
          .where(where),
      ]);
      return { rows: rows.map(toRow), total: total?.total ?? 0 };
    }),

  /** Open tickets for the board, grouped by resolution status on the page. */
  board: permissionProcedure('tickets', 'view')
    .input(ticketFiltersSchema)
    .query(async ({ ctx, input }) => {
      const where = filtersWhere({ ...input, state: 'open' }, ctx.user.id);
      const rows = await baseQuery(ctx.db, where)
        .orderBy(sortBy(priorityOrder, true), asc(tickets.createdAt))
        .limit(500);
      return { rows: rows.map(toRow), truncated: rows.length === 500 };
    }),

  get: permissionProcedure('tickets', 'view')
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const ticket = await loadTicket(ctx.db, input.id);
      const [contact] = await ctx.db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
          mobile: contacts.mobile,
        })
        .from(contacts)
        .where(eq(contacts.id, ticket.contactId));
      const [project] = ticket.projectId
        ? await ctx.db
            .select({
              id: projects.id,
              projectNumber: projects.projectNumber,
              title: projects.title,
              streetAddress: projects.streetAddress,
              suburb: projects.suburb,
              state: projects.state,
              stage: projects.stage,
            })
            .from(projects)
            .where(eq(projects.id, ticket.projectId))
        : [];
      const people = await ctx.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          inArray(
            users.id,
            [ticket.assignedUserId, ticket.createdByUserId].filter((id): id is string =>
              Boolean(id),
            ),
          ),
        );
      const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
      const [hardware, claims, visits] = await Promise.all([
        ctx.db
          .select()
          .from(ticketHardware)
          .where(eq(ticketHardware.ticketId, ticket.id))
          .orderBy(asc(ticketHardware.role), asc(ticketHardware.createdAt)),
        ctx.db
          .select()
          .from(ticketWarrantyClaims)
          .where(eq(ticketWarrantyClaims.ticketId, ticket.id))
          .orderBy(asc(ticketWarrantyClaims.createdAt)),
        ctx.db
          .select({ visit: ticketInstallerVisits, companyName: companies.name })
          .from(ticketInstallerVisits)
          .leftJoin(companies, eq(companies.id, ticketInstallerVisits.installerCompanyId))
          .where(eq(ticketInstallerVisits.ticketId, ticket.id))
          .orderBy(asc(ticketInstallerVisits.createdAt)),
      ]);
      const stamp = <T extends { createdAt: Date; updatedAt: Date }>(row: T) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
      return {
        ...stamp(ticket),
        closedAt: ticket.closedAt?.toISOString() ?? null,
        assignedName: nameOf(ticket.assignedUserId),
        createdByName: nameOf(ticket.createdByUserId),
        contact: contact ?? null,
        project: project ?? null,
        hardware: hardware.map(stamp),
        claims: claims.map(stamp),
        visits: visits.map(({ visit, companyName }) => ({ ...stamp(visit), companyName })),
      };
    }),

  /** Opens a ticket: number TKT-YYYY-NNNN, status "Under Investigation". */
  create: permissionProcedure('tickets', 'create')
    .input(ticketInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await assertLinks(tx, input.contactId, input.projectId);
        await assertOption(tx, 'ticketCategories', input.category, 'category');
        await assertOption(tx, 'ticketPriorities', input.priority, 'priority');
        await assertActiveUser(tx, input.assignedUserId);
        const ticketNumber = await nextTicketNumber(tx);
        const [created] = await tx
          .insert(tickets)
          .values({
            ...input,
            ticketNumber,
            resolutionStatus: TICKET_DEFAULT_STATUS,
            createdByUserId: ctx.user.id,
            updatedByUserId: ctx.user.id,
          })
          .returning();
        if (!created) throw new Error('Insert returned no row');
        await logOnTicket(tx, ctx, created, `Ticket opened: ${created.title}`, {
          priority: created.priority,
        });
        if (created.projectId) {
          await logSystemActivity(tx, {
            entityType: 'project',
            entityId: created.projectId,
            authorUserId: ctx.user.id,
            subject: `Service ticket ${ticketNumber} opened: ${created.title}`,
            metadata: { ticketId: created.id },
          });
        }
        await recordAudit(tx, actorOf(ctx), {
          action: 'create',
          entityType: 'ticket',
          entityId: created.id,
          after: { ...input, ticketNumber },
        });
        return { id: created.id, ticketNumber };
      }),
    ),

  /** Customer, project, title, description, category, priority, technician. */
  update: editProcedure
    .input(z.object({ id: z.uuid(), values: ticketInputSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await loadTicket(tx, input.id);
        const values = input.values;
        await assertLinks(tx, values.contactId, values.projectId);
        await assertOption(tx, 'ticketCategories', values.category, 'category', existing.category);
        await assertOption(tx, 'ticketPriorities', values.priority, 'priority', existing.priority);
        await assertActiveUser(tx, values.assignedUserId, existing.assignedUserId);
        const changes = diff(existing, values);
        if (!changes) return { id: existing.id };
        await tx
          .update(tickets)
          .set({ ...values, updatedByUserId: ctx.user.id })
          .where(eq(tickets.id, existing.id));
        if (existing.priority !== values.priority) {
          await logOnTicket(
            tx,
            ctx,
            existing,
            `Priority: ${existing.priority} → ${values.priority}`,
          );
        }
        if (existing.assignedUserId !== values.assignedUserId) {
          const [person] = values.assignedUserId
            ? await tx
                .select({ name: users.name })
                .from(users)
                .where(eq(users.id, values.assignedUserId))
            : [];
          await logOnTicket(
            tx,
            ctx,
            existing,
            person ? `Assigned to ${person.name}` : 'Unassigned',
          );
        }
        await recordAudit(tx, actorOf(ctx), {
          action: 'update',
          entityType: 'ticket',
          entityId: existing.id,
          ...changes,
        });
        return { id: existing.id };
      }),
    ),

  /**
   * The triage flow and the resolution. A closing status (§ TICKET_CLOSED_STATUSES) closes the
   * ticket and dates the resolution today unless given; any other status reopens it.
   */
  updateTriage: editProcedure
    .input(z.object({ id: z.uuid(), values: ticketTriageSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction((tx) => applyTriage(tx, ctx, input.id, input.values)),
    ),

  /** Board "Move to…": just the resolution status. */
  setStatus: editProcedure
    .input(z.object({ id: z.uuid(), status: z.string().trim().min(1).max(150) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const existing = await loadTicket(tx, input.id);
        return applyTriage(tx, ctx, input.id, {
          issueRecorded: existing.issueRecorded,
          initialCheck: existing.initialCheck,
          workRequired: existing.workRequired,
          resolutionStatus: input.status,
          serviceIssueNotes: existing.serviceIssueNotes,
          resolvedDate: existing.resolvedDate,
          serviceChargeAud: existing.serviceChargeAud,
        });
      });
    }),

  // ── Hardware rows ─────────────────────────────────────────────────────

  saveHardware: editProcedure.input(childInput(ticketHardwareSchema)).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const ticket = await loadTicket(tx, input.ticketId);
      const values = input.values;
      if (input.id) {
        const [existing] = await tx
          .select()
          .from(ticketHardware)
          .where(and(eq(ticketHardware.id, input.id), eq(ticketHardware.ticketId, ticket.id)));
        if (!existing)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'That row no longer exists.' });
        const changes = diff(existing, values);
        if (!changes) return { id: existing.id };
        await tx.update(ticketHardware).set(values).where(eq(ticketHardware.id, existing.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'update_hardware',
          entityType: 'ticket',
          entityId: ticket.id,
          ...changes,
        });
        await touch(tx, ctx, ticket.id);
        return { id: existing.id };
      }
      const [row] = await tx
        .insert(ticketHardware)
        .values({ ticketId: ticket.id, ...values })
        .returning({ id: ticketHardware.id });
      if (!row) throw new Error('Insert returned no row');
      const what = [
        values.quantity > 1 ? `${String(values.quantity)} ×` : null,
        values.brand,
        values.model ?? values.kind,
      ]
        .filter(Boolean)
        .join(' ');
      await logOnTicket(
        tx,
        ctx,
        ticket,
        `${values.role === 'replaced' ? 'Replaced hardware' : 'Existing hardware'} recorded: ${what}`,
      );
      await recordAudit(tx, actorOf(ctx), {
        action: 'add_hardware',
        entityType: 'ticket',
        entityId: ticket.id,
        after: values,
      });
      await touch(tx, ctx, ticket.id);
      return { id: row.id };
    }),
  ),

  removeHardware: editProcedure.input(childRemove).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(ticketHardware)
        .where(and(eq(ticketHardware.id, input.id), eq(ticketHardware.ticketId, input.ticketId)))
        .returning();
      if (!removed)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That row no longer exists.' });
      await recordAudit(tx, actorOf(ctx), {
        action: 'remove_hardware',
        entityType: 'ticket',
        entityId: input.ticketId,
        before: removed,
      });
      await touch(tx, ctx, input.ticketId);
      return { id: input.id };
    }),
  ),

  // ── Warranty claims ──────────────────────────────────────────────────

  saveClaim: editProcedure.input(childInput(warrantyClaimSchema)).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const ticket = await loadTicket(tx, input.ticketId);
      const values = input.values;
      const [existing] = input.id
        ? await tx
            .select()
            .from(ticketWarrantyClaims)
            .where(
              and(
                eq(ticketWarrantyClaims.id, input.id),
                eq(ticketWarrantyClaims.ticketId, ticket.id),
              ),
            )
        : [];
      if (input.id && !existing)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That claim no longer exists.' });
      await assertOption(
        tx,
        'ticketWarrantyClaimStatuses',
        values.status,
        'claim status',
        existing?.status,
      );
      await assertOption(
        tx,
        'ticketWarrantyClaimInvoiceStatuses',
        values.invoiceStatus,
        'claim invoice status',
        existing?.invoiceStatus,
      );
      let id = existing?.id;
      if (existing) {
        const changes = diff(existing, values);
        if (!changes) return { id: existing.id };
        await tx
          .update(ticketWarrantyClaims)
          .set(values)
          .where(eq(ticketWarrantyClaims.id, existing.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'update_claim',
          entityType: 'ticket',
          entityId: ticket.id,
          ...changes,
        });
      } else {
        const [row] = await tx
          .insert(ticketWarrantyClaims)
          .values({ ticketId: ticket.id, ...values })
          .returning({ id: ticketWarrantyClaims.id });
        if (!row) throw new Error('Insert returned no row');
        id = row.id;
        await recordAudit(tx, actorOf(ctx), {
          action: 'add_claim',
          entityType: 'ticket',
          entityId: ticket.id,
          after: values,
        });
      }
      if (values.status && values.status !== existing?.status) {
        await logOnTicket(
          tx,
          ctx,
          ticket,
          `Warranty claim${values.claimReference ? ` ${values.claimReference}` : ''}: ${values.status}`,
        );
      }
      await touch(tx, ctx, ticket.id);
      return { id };
    }),
  ),

  removeClaim: editProcedure.input(childRemove).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(ticketWarrantyClaims)
        .where(
          and(
            eq(ticketWarrantyClaims.id, input.id),
            eq(ticketWarrantyClaims.ticketId, input.ticketId),
          ),
        )
        .returning();
      if (!removed)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That claim no longer exists.' });
      await recordAudit(tx, actorOf(ctx), {
        action: 'remove_claim',
        entityType: 'ticket',
        entityId: input.ticketId,
        before: removed,
      });
      await touch(tx, ctx, input.ticketId);
      return { id: input.id };
    }),
  ),

  // ── Installer visits ─────────────────────────────────────────────────

  saveVisit: editProcedure.input(childInput(installerVisitSchema)).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const ticket = await loadTicket(tx, input.ticketId);
      const values = input.values;
      const [existing] = input.id
        ? await tx
            .select()
            .from(ticketInstallerVisits)
            .where(
              and(
                eq(ticketInstallerVisits.id, input.id),
                eq(ticketInstallerVisits.ticketId, ticket.id),
              ),
            )
        : [];
      if (input.id && !existing)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That visit no longer exists.' });
      await assertOption(
        tx,
        'installerInvoiceStatuses',
        values.invoiceStatus,
        'invoice status',
        existing?.invoiceStatus,
      );
      if (values.installerCompanyId && values.installerCompanyId !== existing?.installerCompanyId) {
        const [company] = await tx
          .select({ id: companies.id })
          .from(companies)
          .where(and(eq(companies.id, values.installerCompanyId), isNull(companies.archivedAt)));
        if (!company)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'That installer company does not exist.',
          });
      }
      let id = existing?.id;
      if (existing) {
        const changes = diff(existing, values);
        if (!changes) return { id: existing.id };
        await tx
          .update(ticketInstallerVisits)
          .set(values)
          .where(eq(ticketInstallerVisits.id, existing.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'update_visit',
          entityType: 'ticket',
          entityId: ticket.id,
          ...changes,
        });
      } else {
        const [row] = await tx
          .insert(ticketInstallerVisits)
          .values({ ticketId: ticket.id, ...values })
          .returning({ id: ticketInstallerVisits.id });
        if (!row) throw new Error('Insert returned no row');
        id = row.id;
        await logOnTicket(
          tx,
          ctx,
          ticket,
          `Installer visit${values.visitDate ? ` on ${values.visitDate}` : ''} recorded`,
        );
        await recordAudit(tx, actorOf(ctx), {
          action: 'add_visit',
          entityType: 'ticket',
          entityId: ticket.id,
          after: values,
        });
      }
      await touch(tx, ctx, ticket.id);
      return { id };
    }),
  ),

  removeVisit: editProcedure.input(childRemove).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(ticketInstallerVisits)
        .where(
          and(
            eq(ticketInstallerVisits.id, input.id),
            eq(ticketInstallerVisits.ticketId, input.ticketId),
          ),
        )
        .returning();
      if (!removed)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That visit no longer exists.' });
      await recordAudit(tx, actorOf(ctx), {
        action: 'remove_visit',
        entityType: 'ticket',
        entityId: input.ticketId,
        before: removed,
      });
      await touch(tx, ctx, input.ticketId);
      return { id: input.id };
    }),
  ),

  /** For the "New ticket" form: customers by name, email or phone (10 at most). */
  customerSearch: permissionProcedure('tickets', 'view')
    .input(z.object({ search: z.string().trim().max(100) }))
    .query(({ ctx, input }) => {
      const pattern = containsPattern(input.search);
      const matches = input.search
        ? or(
            sql`${customerName} ilike ${pattern}`,
            ilike(contacts.email, pattern),
            phoneContains(contacts.mobile, input.search),
          )
        : undefined;
      return ctx.db
        .select({
          id: contacts.id,
          name: customerName,
          email: contacts.email,
          mobile: contacts.mobile,
        })
        .from(contacts)
        .where(and(isNull(contacts.archivedAt), matches))
        .orderBy(asc(sql`lower(${customerName})`))
        .limit(10);
    }),

  /** For the "New ticket" form: the customer's projects. */
  contactProjects: permissionProcedure('tickets', 'view')
    .input(z.object({ contactId: z.uuid() }))
    .query(({ ctx, input }) =>
      ctx.db
        .select({
          id: projects.id,
          projectNumber: projects.projectNumber,
          title: projects.title,
          suburb: projects.suburb,
        })
        .from(projects)
        .where(and(eq(projects.contactId, input.contactId), isNull(projects.deletedAt)))
        .orderBy(desc(projects.createdAt)),
    ),
});
