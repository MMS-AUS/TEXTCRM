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
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  areaForPostcode,
  balancePayable,
  hasPermission,
  nearestBigCity,
  PROJECT_FINAL_STAGE,
  PROJECT_STAGES,
  PROJECT_STATUSES,
  projectFiltersSchema,
  projectListInputSchema,
  projectPricingSchema,
  projectSiteSchema,
  projectSystemSchema,
  systemSizeKw,
} from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import {
  companies,
  contacts,
  hardwarePanels,
  projectFinance,
  projectGridApplications,
  projectInstallation,
  projectPricing,
  projects,
  projectStcClaims,
  projectSystemDesign,
  projectSystemInverters,
  users,
} from '../../db/schema/index.ts';
import { permissionProcedure, protectedProcedure, router } from '../../trpc/trpc.ts';
import { logSystemActivity } from '../activities/service.ts';
import { diff, entityHistory, recordAudit, type Actor } from '../audit.ts';
import { checkInverterLines, withInverterLabels } from '../hardware/inverter-lines.ts';
import { assertHardware, hardwareOption } from '../hardware/router.ts';
import { assertOption } from '../options.ts';
import { containsPattern, phoneContains } from '../search.ts';
import { actorOf, editableProject, notFound } from './common.ts';
import { convertLead, previewConversion } from './conversion.ts';
import { loadSections, sectionProcedures } from './sections.ts';

type Filters = z.output<typeof projectFiltersSchema>;
type ListInput = z.output<typeof projectListInputSchema>;

const sales = aliasedTable(users, 'sales');
const customerName = sql<string>`${contacts.firstName} || coalesce(' ' || ${contacts.lastName}, '')`;
const stageOrder = sql`array_position(array[${sql.join(
  PROJECT_STAGES.map((stage) => sql`${stage}`),
  sql`, `,
)}]::text[], ${projects.stage})`;

function sortBy(column: AnyPgColumn | SQL, descending: boolean): SQL {
  return descending ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
}

function filtersWhere(filters: Filters, userId: string): SQL | undefined {
  const conditions: SQL[] = [isNull(projects.deletedAt)];
  if (filters.stages.length > 0) conditions.push(inArray(projects.stage, filters.stages));
  if (filters.status) conditions.push(eq(projects.status, filters.status));
  if (filters.sales === 'me') conditions.push(eq(projects.salesUserId, userId));
  else if (filters.sales === 'none') conditions.push(isNull(projects.salesUserId));
  else if (filters.sales) conditions.push(eq(projects.salesUserId, filters.sales));
  if (filters.state) conditions.push(eq(projects.state, filters.state));
  if (filters.dnsp)
    conditions.push(eq(projectGridApplications.electricityDistributor, filters.dnsp));
  if (filters.finance) conditions.push(eq(projectFinance.financeOption, filters.finance));
  if (filters.stcStatus) conditions.push(eq(projectStcClaims.status, filters.stcStatus));
  if (filters.installerCompanyId) {
    conditions.push(eq(projectInstallation.installerCompanyId, filters.installerCompanyId));
  }
  if (filters.saleDateFrom) conditions.push(gte(projects.saleDate, filters.saleDateFrom));
  if (filters.saleDateTo) conditions.push(lte(projects.saleDate, filters.saleDateTo));
  if (filters.search) {
    const pattern = containsPattern(filters.search);
    const matches = or(
      ilike(projects.projectNumber, pattern),
      ilike(projects.title, pattern),
      sql`${customerName} ilike ${pattern}`,
      ilike(projects.suburb, pattern),
      ilike(contacts.email, pattern),
      phoneContains(contacts.mobile, filters.search),
    );
    if (matches) conditions.push(matches);
  }
  return and(...conditions);
}

function listOrder(sort: ListInput['sort']): SQL[] {
  const d = sort.desc;
  switch (sort.id) {
    case 'projectNumber':
      return [sortBy(projects.createdAt, d)];
    case 'customer':
      return [sortBy(sql`lower(${customerName})`, d)];
    case 'stage':
      return [sortBy(stageOrder, d)];
    case 'status':
      return [sortBy(projects.status, d)];
    case 'saleDate':
      return [sortBy(projects.saleDate, d)];
    case 'sellingPrice':
      return [sortBy(projectPricing.sellingPriceAud, d)];
    case 'updatedAt':
      return [sortBy(projects.updatedAt, d)];
  }
}

const rowFields = {
  id: projects.id,
  projectNumber: projects.projectNumber,
  title: projects.title,
  contactId: projects.contactId,
  customerName,
  suburb: projects.suburb,
  state: projects.state,
  stage: projects.stage,
  status: projects.status,
  salesUserId: projects.salesUserId,
  salesName: sales.name,
  saleDate: projects.saleDate,
  systemSizeKw: projectSystemDesign.systemSizeKw,
  batteryCount: projectSystemDesign.batteryCount,
  sellingPriceAud: projectPricing.sellingPriceAud,
  updatedAt: projects.updatedAt,
};

/** The list/board query with every table a filter can touch. */
function baseQuery(db: Db, where: SQL | undefined) {
  return db
    .select(rowFields)
    .from(projects)
    .innerJoin(contacts, eq(contacts.id, projects.contactId))
    .leftJoin(sales, eq(sales.id, projects.salesUserId))
    .leftJoin(projectSystemDesign, eq(projectSystemDesign.projectId, projects.id))
    .leftJoin(projectPricing, eq(projectPricing.projectId, projects.id))
    .leftJoin(projectGridApplications, eq(projectGridApplications.projectId, projects.id))
    .leftJoin(projectFinance, eq(projectFinance.projectId, projects.id))
    .leftJoin(projectStcClaims, eq(projectStcClaims.projectId, projects.id))
    .leftJoin(projectInstallation, eq(projectInstallation.projectId, projects.id))
    .where(where)
    .$dynamic();
}

type Row = Awaited<ReturnType<typeof baseQuery>>[number];
const serialise = (row: Row) => ({ ...row, updatedAt: row.updatedAt.toISOString() });

/**
 * Stage and status move together at the ends: reaching the final stage completes the job;
 * leaving it, or reopening, makes the job active again. Closed/Lost jobs don't move.
 */
function stageAndStatus(
  current: { stage: string; status: string },
  patch: { stage?: string; status?: string },
) {
  let stage = patch.stage ?? current.stage;
  let status = patch.status ?? current.status;
  if (patch.stage !== undefined) {
    if (current.status === 'Closed' || current.status === 'Lost') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `This job is ${current.status.toLowerCase()}. Set it back to Active before moving it.`,
      });
    }
    status = stage === PROJECT_FINAL_STAGE ? 'Completed' : 'Active';
  }
  if (patch.status === 'Completed') stage = PROJECT_FINAL_STAGE;
  if (
    patch.status === 'Active' &&
    current.stage === PROJECT_FINAL_STAGE &&
    patch.stage === undefined
  ) {
    stage = PROJECT_STAGES[PROJECT_STAGES.length - 2] ?? stage;
  }
  const closed = status !== 'Active';
  return { stage, status, closed };
}

async function changeStageOrStatus(
  tx: Tx,
  ctx: { user: { id: string }; meta: Actor['meta'] },
  id: string,
  patch: { stage?: string; status?: string },
) {
  const existing = await editableProject(tx, id);
  if (patch.stage !== undefined) await assertOption(tx, 'projectStages', patch.stage, 'stage');
  if (patch.status !== undefined) {
    await assertOption(tx, 'projectStatuses', patch.status, 'status');
  }
  const next = stageAndStatus(existing, patch);
  const after = {
    stage: next.stage,
    status: next.status,
    closedAt: next.closed ? (existing.closedAt ?? new Date()) : null,
  };
  const changes = diff(existing, { stage: after.stage, status: after.status });
  if (!changes) return false;
  await tx
    .update(projects)
    .set({ ...after, updatedByUserId: ctx.user.id })
    .where(eq(projects.id, id));
  if (existing.stage !== after.stage) {
    await logSystemActivity(tx, {
      entityType: 'project',
      entityId: id,
      authorUserId: ctx.user.id,
      subject: `Stage moved from ${existing.stage} to ${after.stage}`,
      metadata: { field: 'stage', from: existing.stage, to: after.stage },
    });
  }
  if (existing.status !== after.status) {
    await logSystemActivity(tx, {
      entityType: 'project',
      entityId: id,
      authorUserId: ctx.user.id,
      subject: `Status changed from ${existing.status} to ${after.status}`,
      metadata: { field: 'status', from: existing.status, to: after.status },
    });
  }
  await recordAudit(tx, actorOf(ctx), {
    action: 'update',
    entityType: 'project',
    entityId: id,
    ...changes,
  });
  return true;
}

export const projectsRouter = router({
  ...sectionProcedures,

  list: permissionProcedure('projects', 'view')
    .input(projectListInputSchema)
    .query(async ({ ctx, input }) => {
      const where = filtersWhere(input, ctx.user.id);
      const [rows, [totals]] = await Promise.all([
        baseQuery(ctx.db, where)
          .orderBy(...listOrder(input.sort), desc(projects.createdAt), asc(projects.id))
          .limit(input.pageSize)
          .offset(input.page * input.pageSize),
        ctx.db
          .select({ total: count() })
          .from(projects)
          .innerJoin(contacts, eq(contacts.id, projects.contactId))
          .leftJoin(projectGridApplications, eq(projectGridApplications.projectId, projects.id))
          .leftJoin(projectFinance, eq(projectFinance.projectId, projects.id))
          .leftJoin(projectStcClaims, eq(projectStcClaims.projectId, projects.id))
          .leftJoin(projectInstallation, eq(projectInstallation.projectId, projects.id))
          .where(where),
      ]);
      return { total: totals?.total ?? 0, rows: rows.map(serialise) };
    }),

  /** Every matching job for the kanban board, oldest sale first within a stage. */
  board: permissionProcedure('projects', 'view')
    .input(projectFiltersSchema)
    .query(async ({ ctx, input }) => {
      const LIMIT = 1000;
      const rows = await baseQuery(ctx.db, filtersWhere(input, ctx.user.id))
        .orderBy(sortBy(projects.saleDate, false), asc(projects.createdAt))
        .limit(LIMIT + 1);
      return { rows: rows.slice(0, LIMIT).map(serialise), truncated: rows.length > LIMIT };
    }),

  get: permissionProcedure('projects', 'view')
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const createdBy = aliasedTable(users, 'created_by');
      const [row] = await ctx.db
        .select({
          project: projects,
          contact: {
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            mobile: contacts.mobile,
          },
          salesName: sales.name,
          createdByName: createdBy.name,
        })
        .from(projects)
        .innerJoin(contacts, eq(contacts.id, projects.contactId))
        .leftJoin(sales, eq(sales.id, projects.salesUserId))
        .leftJoin(createdBy, eq(createdBy.id, projects.createdByUserId))
        .where(eq(projects.id, input.id));
      if (!row) throw notFound();
      const { project } = row;
      const [[system], inverterRows, [pricing], history, sections] = await Promise.all([
        ctx.db
          .select()
          .from(projectSystemDesign)
          .where(eq(projectSystemDesign.projectId, project.id)),
        ctx.db
          .select()
          .from(projectSystemInverters)
          .where(eq(projectSystemInverters.projectId, project.id))
          .orderBy(asc(projectSystemInverters.position), asc(projectSystemInverters.createdAt)),
        ctx.db.select().from(projectPricing).where(eq(projectPricing.projectId, project.id)),
        entityHistory(ctx.db, 'project', project.id),
        loadSections(ctx.db, project),
      ]);
      const [panel, battery, inverters] = await Promise.all([
        hardwareOption(ctx.db, 'panel', system?.panelId),
        hardwareOption(ctx.db, 'battery', system?.batteryId),
        withInverterLabels(ctx.db, inverterRows),
      ]);
      return {
        ...project,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        closedAt: project.closedAt?.toISOString() ?? null,
        soldAt: project.soldAt?.toISOString() ?? null,
        deletedAt: project.deletedAt?.toISOString() ?? null,
        contact: row.contact,
        salesName: row.salesName,
        createdByName: row.createdByName,
        canViewLead: hasPermission(ctx.user.permissions, 'leads', 'view'),
        system: system
          ? {
              systemSizeKw: system.systemSizeKw,
              panelId: system.panelId,
              panelCount: system.panelCount,
              batteryId: system.batteryId,
              batteryCount: system.batteryCount,
              inverters,
              panel,
              battery,
            }
          : null,
        pricing: pricing
          ? {
              systemPriceAud: pricing.systemPriceAud,
              sellingPriceAud: pricing.sellingPriceAud,
              contractValueAud: pricing.contractValueAud,
              depositAud: pricing.depositAud,
              depositReceivedDate: pricing.depositReceivedDate,
              balanceDueDate: pricing.balanceDueDate,
              customerInvoiceNumber: pricing.customerInvoiceNumber,
              balancePayableAud: balancePayable(pricing),
            }
          : null,
        ...sections,
        history,
      };
    }),

  setStage: permissionProcedure('projects', 'edit')
    .input(z.object({ id: z.uuid(), stage: z.enum(PROJECT_STAGES) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction((tx) =>
        changeStageOrStatus(tx, ctx, input.id, { stage: input.stage }),
      );
      return { id: input.id };
    }),

  setStatus: permissionProcedure('projects', 'edit')
    .input(z.object({ id: z.uuid(), status: z.enum(PROJECT_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction((tx) =>
        changeStageOrStatus(tx, ctx, input.id, { status: input.status }),
      );
      return { id: input.id };
    }),

  assignSales: permissionProcedure('projects', 'edit')
    .input(z.object({ id: z.uuid(), salesUserId: z.uuid().nullable() }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await editableProject(tx, input.id);
        if (existing.salesUserId === input.salesUserId) return { id: input.id };
        let name: string | null = null;
        if (input.salesUserId) {
          const [user] = await tx
            .select({ name: users.name })
            .from(users)
            .where(and(eq(users.id, input.salesUserId), eq(users.isActive, true)));
          if (!user) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'That person is not an active user.',
            });
          }
          name = user.name;
        }
        await tx
          .update(projects)
          .set({ salesUserId: input.salesUserId, updatedByUserId: ctx.user.id })
          .where(eq(projects.id, input.id));
        await logSystemActivity(tx, {
          entityType: 'project',
          entityId: input.id,
          authorUserId: ctx.user.id,
          subject: name ? `Sales person set to ${name}` : 'Sales person removed',
        });
        await recordAudit(tx, actorOf(ctx), {
          action: 'update',
          entityType: 'project',
          entityId: input.id,
          before: { salesUserId: existing.salesUserId },
          after: { salesUserId: input.salesUserId },
        });
        return { id: input.id };
      }),
    ),

  updateSite: permissionProcedure('projects', 'edit')
    .input(z.object({ id: z.uuid(), values: projectSiteSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await editableProject(tx, input.id);
        const values = input.values;
        await assertOption(tx, 'houseStoreys', values.houseStorey, 'storey', existing.houseStorey);
        await assertOption(tx, 'roofTypes', values.roofType, 'roof type', existing.roofType);
        await assertOption(tx, 'phases', values.phase, 'phase', existing.phase);
        const row = {
          ...values,
          area: areaForPostcode(values.postcode),
          nearestBigCity: nearestBigCity(values.postcode, values.state),
        };
        const changes = diff(existing, row);
        if (!changes) return { id: input.id };
        await tx
          .update(projects)
          .set({ ...row, updatedByUserId: ctx.user.id })
          .where(eq(projects.id, input.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'update_site',
          entityType: 'project',
          entityId: input.id,
          ...changes,
        });
        return { id: input.id };
      }),
    ),

  updateSystem: permissionProcedure('projects', 'edit')
    .input(z.object({ id: z.uuid(), values: projectSystemSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await editableProject(tx, input.id);
        const [existing] = await tx
          .select()
          .from(projectSystemDesign)
          .where(eq(projectSystemDesign.projectId, input.id));
        const { inverters, ...systemValues } = input.values;
        const values = { ...systemValues };
        await assertHardware(tx, 'panel', values.panelId, existing?.panelId);
        await assertHardware(tx, 'battery', values.batteryId, existing?.batteryId);
        const currentRows = await tx
          .select()
          .from(projectSystemInverters)
          .where(eq(projectSystemInverters.projectId, input.id))
          .orderBy(asc(projectSystemInverters.position), asc(projectSystemInverters.createdAt));
        // As on a lead, the system size is the inverters' total capacity whenever there are any.
        const capacity = await checkInverterLines(
          tx,
          inverters,
          new Set(currentRows.map((row) => row.inverterId)),
        );
        if (capacity) values.systemSizeKw = capacity;
        if (!values.systemSizeKw && values.panelId && values.panelCount) {
          const [panel] = await tx
            .select({ sizeW: hardwarePanels.sizeW })
            .from(hardwarePanels)
            .where(eq(hardwarePanels.id, values.panelId));
          if (panel) values.systemSizeKw = systemSizeKw(values.panelCount, panel.sizeW);
        }
        const invertersBefore = currentRows.map((row) => ({
          inverterId: row.inverterId,
          count: row.count,
          type: row.type,
        }));
        const changes = diff(
          { ...(existing ?? {}), inverters: invertersBefore },
          { ...values, inverters },
        );
        if (!changes) return { id: input.id };
        await tx
          .insert(projectSystemDesign)
          .values({ projectId: input.id, ...values })
          .onConflictDoUpdate({ target: projectSystemDesign.projectId, set: values });
        await tx
          .delete(projectSystemInverters)
          .where(eq(projectSystemInverters.projectId, input.id));
        if (inverters.length > 0) {
          await tx.insert(projectSystemInverters).values(
            inverters.map((row, position) => ({
              projectId: input.id,
              position,
              inverterId: row.inverterId,
              count: row.count,
              type: row.type,
            })),
          );
        }
        await tx
          .update(projects)
          .set({ updatedByUserId: ctx.user.id })
          .where(eq(projects.id, input.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'update_system',
          entityType: 'project',
          entityId: input.id,
          ...changes,
        });
        return { id: input.id };
      }),
    ),

  updatePricing: permissionProcedure('projects', 'edit')
    .input(z.object({ id: z.uuid(), values: projectPricingSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await editableProject(tx, input.id);
        const [existing] = await tx
          .select()
          .from(projectPricing)
          .where(eq(projectPricing.projectId, input.id));
        const values = input.values;
        const changes = diff(existing ?? {}, values);
        if (!changes) return { id: input.id };
        await tx
          .insert(projectPricing)
          .values({ projectId: input.id, ...values })
          .onConflictDoUpdate({ target: projectPricing.projectId, set: values });
        await tx
          .update(projects)
          .set({ updatedByUserId: ctx.user.id })
          .where(eq(projects.id, input.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'update_pricing',
          entityType: 'project',
          entityId: input.id,
          ...changes,
        });
        return { id: input.id };
      }),
    ),

  /** What converting this lead would create (the confirmation dialog). */
  conversionPreview: permissionProcedure('leads', 'view')
    .input(z.object({ leadId: z.uuid() }))
    .query(({ ctx, input }) => previewConversion(ctx.db, input.leadId)),

  /** Lead → Project (§1.4). Needs permission to create projects and to edit leads. */
  convertLead: permissionProcedure('projects', 'create')
    .input(z.object({ leadId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!hasPermission(ctx.user.permissions, 'leads', 'edit')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Your role does not allow this action.',
        });
      }
      try {
        return await ctx.db.transaction((tx) => convertLead(tx, actorOf(ctx), input.leadId));
      } catch (error) {
        // The UNIQUE lead_id constraint is the last line of defence against double conversion.
        if (
          error instanceof Error &&
          'cause' in error &&
          String(error.cause).includes('projects_lead_id_unique')
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This lead has already been converted.',
          });
        }
        throw error;
      }
    }),

  /** Options for pickers on the project filters (the installer filter). */
  installers: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(isNull(companies.archivedAt), eq(companies.type, 'Subcontractor Installer')))
      .orderBy(asc(companies.name)),
  ),
});
