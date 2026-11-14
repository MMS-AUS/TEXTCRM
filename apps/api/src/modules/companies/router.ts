import { TRPCError } from '@trpc/server';
import {
  aliasedTable,
  and,
  asc,
  count,
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
  companyInputSchema,
  companyListInputSchema,
  formatAbn,
  type CompanyValues,
} from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import { companies, contacts, users } from '../../db/schema/index.ts';
import { permissionProcedure, router } from '../../trpc/trpc.ts';
import { diff, entityHistory, recordAudit, type Actor } from '../audit.ts';
import { extraEmailsLike } from '../emails.ts';
import { assertOption } from '../options.ts';
import { containsPattern, phoneContains } from '../search.ts';

const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'This company does not exist.' });

const idInput = z.object({ id: z.uuid() });

function sortBy(column: AnyPgColumn | SQL, descending: boolean): SQL {
  return descending ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
}

type ListInput = z.output<typeof companyListInputSchema>;

/**
 * Active contacts per company, as a correlated subquery (cheap with contacts_company_idx).
 * Spelled out with an alias: in single-table queries Drizzle renders bare column names, which
 * would make "id" resolve to the inner table.
 */
const contactCount = sql<number>`(
  select count(*)::int from ${contacts} as counted
  where counted.company_id = ${companies}.id and counted.archived_at is null
)`;

function listWhere(input: ListInput): SQL | undefined {
  const conditions: SQL[] = [
    input.archived ? isNotNull(companies.archivedAt) : isNull(companies.archivedAt),
  ];
  if (input.type) conditions.push(eq(companies.type, input.type));
  if (input.search) {
    const pattern = containsPattern(input.search);
    const abnDigits = input.search.replace(/\s/g, '');
    const matches = [
      ilike(companies.name, pattern),
      ilike(companies.email, pattern),
      extraEmailsLike(companies.extraEmails, pattern),
      ilike(companies.suburb, pattern),
      /^\d{3,11}$/.test(abnDigits) ? ilike(companies.abn, containsPattern(abnDigits)) : undefined,
      phoneContains(companies.phone, input.search),
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
      return [sortBy(sql`lower(${companies.name})`, d)];
    case 'type':
      return [sortBy(companies.type, d)];
    case 'location':
      return [sortBy(companies.state, d), sortBy(companies.suburb, d)];
    case 'contacts':
      return [sortBy(contactCount, d)];
    case 'updatedAt':
      return [sortBy(companies.updatedAt, d)];
  }
}

/** One active company per ABN. */
async function assertAbnUnique(
  db: Db | Tx,
  values: Pick<CompanyValues, 'abn'>,
  excludeId?: string,
) {
  if (!values.abn) return;
  const [duplicate] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(
      and(
        eq(companies.abn, values.abn),
        isNull(companies.archivedAt),
        excludeId ? ne(companies.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  if (duplicate) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `${duplicate.name} already has ABN ${formatAbn(values.abn)}.`,
    });
  }
}

async function loadCompany(db: Db | Tx, id: string) {
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) throw notFound();
  return company;
}

const actorOf = (ctx: { user: { id: string }; meta: Actor['meta'] }): Actor => ({
  userId: ctx.user.id,
  meta: ctx.meta,
});

export const companiesRouter = router({
  list: permissionProcedure('companies', 'view')
    .input(companyListInputSchema)
    .query(async ({ ctx, input }) => {
      const where = listWhere(input);
      const [rows, [totals]] = await Promise.all([
        ctx.db
          .select({
            id: companies.id,
            name: companies.name,
            type: companies.type,
            abn: companies.abn,
            phone: companies.phone,
            email: companies.email,
            extraEmails: companies.extraEmails,
            suburb: companies.suburb,
            state: companies.state,
            contacts: contactCount,
            updatedAt: companies.updatedAt,
            archivedAt: companies.archivedAt,
          })
          .from(companies)
          .where(where)
          .orderBy(...listOrder(input.sort), asc(companies.id))
          .limit(input.pageSize)
          .offset(input.page * input.pageSize),
        ctx.db.select({ total: count() }).from(companies).where(where),
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

  /** Lightweight name search for pickers (e.g. "Company" on the contact form). */
  search: permissionProcedure('companies', 'view')
    .input(z.object({ search: z.string().trim().max(100).default('') }))
    .query(({ ctx, input }) =>
      ctx.db
        .select({ id: companies.id, name: companies.name, suburb: companies.suburb })
        .from(companies)
        .where(
          and(
            isNull(companies.archivedAt),
            input.search ? ilike(companies.name, containsPattern(input.search)) : undefined,
          ),
        )
        .orderBy(sql`lower(${companies.name})`)
        .limit(20),
    ),

  get: permissionProcedure('companies', 'view')
    .input(idInput)
    .query(async ({ ctx, input }) => {
      const createdBy = aliasedTable(users, 'created_by');
      const updatedBy = aliasedTable(users, 'updated_by');
      const [row] = await ctx.db
        .select({
          company: companies,
          createdByName: createdBy.name,
          updatedByName: updatedBy.name,
        })
        .from(companies)
        .leftJoin(createdBy, eq(createdBy.id, companies.createdByUserId))
        .leftJoin(updatedBy, eq(updatedBy.id, companies.updatedByUserId))
        .where(eq(companies.id, input.id));
      if (!row) throw notFound();

      const [people, history] = await Promise.all([
        ctx.db
          .select({
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            extraEmails: contacts.extraEmails,
            mobile: contacts.mobile,
            type: contacts.type,
          })
          .from(contacts)
          .where(and(eq(contacts.companyId, input.id), isNull(contacts.archivedAt)))
          .orderBy(sql`lower(${contacts.firstName})`)
          .limit(200),
        entityHistory(ctx.db, 'company', input.id),
      ]);

      const { company } = row;
      return {
        ...company,
        createdAt: company.createdAt.toISOString(),
        updatedAt: company.updatedAt.toISOString(),
        archivedAt: company.archivedAt?.toISOString() ?? null,
        createdByName: row.createdByName,
        updatedByName: row.updatedByName,
        contacts: people,
        history,
      };
    }),

  create: permissionProcedure('companies', 'create')
    .input(companyInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await assertOption(tx, 'companyTypes', input.type, 'company type');
        await assertAbnUnique(tx, input);
        const [created] = await tx
          .insert(companies)
          .values({ ...input, createdByUserId: ctx.user.id, updatedByUserId: ctx.user.id })
          .returning({ id: companies.id });
        if (!created) throw new Error('Insert returned no row');
        await recordAudit(tx, actorOf(ctx), {
          action: 'create',
          entityType: 'company',
          entityId: created.id,
          after: input,
        });
        return created;
      }),
    ),

  update: permissionProcedure('companies', 'edit')
    .input(z.object({ id: z.uuid(), values: companyInputSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await loadCompany(tx, input.id);
        if (existing.archivedAt) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This company is archived. Restore it before making changes.',
          });
        }
        const values = input.values;
        await assertOption(tx, 'companyTypes', values.type, 'company type', existing.type);
        await assertAbnUnique(tx, values, input.id);
        // A changed ABN hasn't been checked against the ABR.
        const abnVerified = values.abn === existing.abn ? existing.abnVerified : false;
        const changes = diff(existing, { ...values, abnVerified });
        if (!changes) return { id: input.id };
        await tx
          .update(companies)
          .set({ ...values, abnVerified, updatedByUserId: ctx.user.id })
          .where(eq(companies.id, input.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'update',
          entityType: 'company',
          entityId: input.id,
          ...changes,
        });
        return { id: input.id };
      }),
    ),

  /** Archive = the CRM's delete. Contacts keep their link to the company. */
  archive: permissionProcedure('companies', 'delete')
    .input(idInput)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await loadCompany(tx, input.id);
        if (existing.archivedAt) return { id: input.id };
        await tx
          .update(companies)
          .set({ archivedAt: new Date(), updatedByUserId: ctx.user.id })
          .where(eq(companies.id, input.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'archive',
          entityType: 'company',
          entityId: input.id,
        });
        return { id: input.id };
      }),
    ),

  restore: permissionProcedure('companies', 'delete')
    .input(idInput)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await loadCompany(tx, input.id);
        if (!existing.archivedAt) return { id: input.id };
        await assertAbnUnique(tx, existing, input.id);
        await tx
          .update(companies)
          .set({ archivedAt: null, updatedByUserId: ctx.user.id })
          .where(eq(companies.id, input.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'restore',
          entityType: 'company',
          entityId: input.id,
        });
        return { id: input.id };
      }),
    ),
});
