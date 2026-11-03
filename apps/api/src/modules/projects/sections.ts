import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  businessToday,
  completedMonth,
  ebCheckResults,
  ebVerificationSchema,
  financeSchema,
  formatAud,
  gridApplicationSchema,
  gridTiming,
  installationSchema,
  isOnFinance,
  openSolarSchema,
  stcClaimSchema,
  stcTotals,
  warehouseSchema,
} from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import type { projects } from '../../db/schema/index.ts';
import {
  companies,
  projectEbVerification,
  projectFinance,
  projectGridApplications,
  projectInstallation,
  projectOpenSolar,
  projectPricing,
  projectStcClaims,
  projectWarehouse,
  users,
} from '../../db/schema/index.ts';
import { permissionProcedure } from '../../trpc/trpc.ts';
import { logSystemActivity } from '../activities/service.ts';
import { assertOption } from '../options.ts';
import { editableProject, saveSection, type Ctx } from './common.ts';

// Step 2.7: the workspace sections after the sale (§1.4). Each has its own save procedure, all
// with the same shape: check the project, check option values, save the changed fields, audit.

type Project = typeof projects.$inferSelect;
type SectionRow = { projectId: string; createdAt: Date; updatedAt: Date };

/** A section row without its key and timestamps (what the page shows and edits). */
function sectionValues<T extends SectionRow>(row: T): Omit<T, keyof SectionRow> {
  const copy: Partial<T> = { ...row };
  delete copy.projectId;
  delete copy.createdAt;
  delete copy.updatedAt;
  // The three keys were just removed, which is exactly what Omit describes.
  return copy as Omit<T, keyof SectionRow>;
}

async function assertOptions<V extends Record<string, unknown>>(
  tx: Tx,
  values: V,
  existing: Record<string, unknown> | undefined,
  lists: readonly (readonly [list: string, key: keyof V & string, label: string])[],
) {
  for (const [list, key, label] of lists) {
    const value = values[key];
    const current = existing?.[key];
    await assertOption(
      tx,
      list,
      typeof value === 'string' ? value : null,
      label,
      typeof current === 'string' ? current : null,
    );
  }
}

/** "Grid application: Grid App Approved" on the timeline when a section's status changes. */
async function logStatus(
  tx: Tx,
  ctx: Ctx,
  projectId: string,
  section: string,
  before: string | null | undefined,
  after: string | null,
) {
  if (!after || before === after) return;
  await logSystemActivity(tx, {
    entityType: 'project',
    entityId: projectId,
    authorUserId: ctx.user.id,
    subject: `${section}: ${after}`,
    metadata: { section, from: before ?? null, to: after },
  });
}

const sectionInput = <S extends z.ZodType>(values: S) => z.object({ id: z.uuid(), values });

/** A date at midday Sydney time, so it reads back as the same calendar day. */
const middayInSydney = (date: string) => new Date(`${date}T02:00:00Z`);

export const sectionProcedures = {
  updateEbVerification: permissionProcedure('projects', 'edit')
    .input(sectionInput(ebVerificationSchema))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const project = await editableProject(tx, input.id);
        const [existing] = await tx
          .select()
          .from(projectEbVerification)
          .where(eq(projectEbVerification.projectId, input.id));
        const values = input.values;
        await assertOptions(tx, values, existing, [
          ['ebCustomerNameMatchOptions', 'customerNameMatch', 'answer'],
          ['ebAddressMatchOptions', 'addressMatch', 'answer'],
          ['ebMeterMatchOptions', 'meterMatch', 'answer'],
          ['ebMeterPhaseOptions', 'meterPhase', 'meter phase'],
          ['ebOpenSolarSystemMatchOptions', 'openSolarSystemMatch', 'answer'],
          ['ebOpenSolarPricingMatchOptions', 'openSolarPricingMatch', 'answer'],
          ['docsReceivedOptions', 'docsReceived', 'documents option'],
        ]);
        const allPassed = (answers: Parameters<typeof ebCheckResults>[0]) =>
          ebCheckResults(answers, project.phase).every((check) => check.state === 'passed');
        const nowPassed = allPassed(values);
        const verified = nowPassed
          ? existing?.verifiedAt && allPassed(existing)
            ? { verifiedByUserId: existing.verifiedByUserId, verifiedAt: existing.verifiedAt }
            : { verifiedByUserId: ctx.user.id, verifiedAt: new Date() }
          : { verifiedByUserId: null, verifiedAt: null };
        const row = { ...values, ...verified };
        const changes = await saveSection(tx, ctx, input.id, 'update_eb', existing, values, () =>
          tx
            .insert(projectEbVerification)
            .values({ projectId: input.id, ...row })
            .onConflictDoUpdate({ target: projectEbVerification.projectId, set: row }),
        );
        if (changes && nowPassed && verified.verifiedByUserId === ctx.user.id) {
          await logSystemActivity(tx, {
            entityType: 'project',
            entityId: input.id,
            authorUserId: ctx.user.id,
            subject: 'Electricity bill verified — all 6 checks passed',
          });
        }
        return { id: input.id };
      }),
    ),

  updateGridApplication: permissionProcedure('projects', 'edit')
    .input(sectionInput(gridApplicationSchema))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await editableProject(tx, input.id);
        const [existing] = await tx
          .select()
          .from(projectGridApplications)
          .where(eq(projectGridApplications.projectId, input.id));
        const values = input.values;
        await assertOptions(tx, values, existing, [
          ['electricityDistributors', 'electricityDistributor', 'DNSP'],
          ['gridApplicationStatuses', 'status', 'grid status'],
          ['energyRetailers', 'energyRetailer', 'retailer'],
        ]);
        await saveSection(tx, ctx, input.id, 'update_grid', existing, values, () =>
          tx
            .insert(projectGridApplications)
            .values({ projectId: input.id, ...values })
            .onConflictDoUpdate({ target: projectGridApplications.projectId, set: values }),
        );
        await logStatus(tx, ctx, input.id, 'Grid application', existing?.status, values.status);
        return { id: input.id };
      }),
    ),

  updateFinance: permissionProcedure('projects', 'edit')
    .input(sectionInput(financeSchema))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await editableProject(tx, input.id);
        const [existing] = await tx
          .select()
          .from(projectFinance)
          .where(eq(projectFinance.projectId, input.id));
        const values = input.values;
        await assertOptions(tx, values, existing, [
          ['isFinanceOptions', 'financeOption', 'finance option'],
          ['financeCompanies', 'financeCompany', 'finance company'],
          ['financeStatuses', 'status', 'finance status'],
        ]);
        if (values.approvedAmountAud) {
          const [pricing] = await tx
            .select()
            .from(projectPricing)
            .where(eq(projectPricing.projectId, input.id));
          const price = pricing?.contractValueAud ?? pricing?.sellingPriceAud;
          if (price && Number(values.approvedAmountAud) > Number(price)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `The approved amount is more than the job's price (${formatAud(price)}).`,
            });
          }
        }
        await saveSection(tx, ctx, input.id, 'update_finance', existing, values, () =>
          tx
            .insert(projectFinance)
            .values({ projectId: input.id, ...values })
            .onConflictDoUpdate({ target: projectFinance.projectId, set: values }),
        );
        await logStatus(tx, ctx, input.id, 'Finance', existing?.status, values.status);
        return { id: input.id };
      }),
    ),

  updateWarehouse: permissionProcedure('projects', 'edit')
    .input(sectionInput(warehouseSchema))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await editableProject(tx, input.id);
        const [existing] = await tx
          .select()
          .from(projectWarehouse)
          .where(eq(projectWarehouse.projectId, input.id));
        const values = input.values;
        await assertOptions(tx, values, existing, [
          ['warehouses', 'warehouse', 'warehouse'],
          ['stockStatuses', 'stockStatus', 'stock status'],
          ['warehouseInvoiceStatuses', 'invoiceStatus', 'invoice status'],
        ]);
        await saveSection(tx, ctx, input.id, 'update_warehouse', existing, values, () =>
          tx
            .insert(projectWarehouse)
            .values({ projectId: input.id, ...values })
            .onConflictDoUpdate({ target: projectWarehouse.projectId, set: values }),
        );
        await logStatus(tx, ctx, input.id, 'Stock', existing?.stockStatus, values.stockStatus);
        return { id: input.id };
      }),
    ),

  updateInstallation: permissionProcedure('projects', 'edit')
    .input(sectionInput(installationSchema))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await editableProject(tx, input.id);
        const [existing] = await tx
          .select()
          .from(projectInstallation)
          .where(eq(projectInstallation.projectId, input.id));
        const values = input.values;
        await assertOptions(tx, values, existing, [
          ['installationStatuses', 'status', 'installation status'],
          ['installationDocsStatuses', 'docsStatus', 'documents status'],
          ['installerInvoiceStatuses', 'installerInvoiceStatus', 'invoice status'],
        ]);
        if (
          values.installerCompanyId &&
          values.installerCompanyId !== existing?.installerCompanyId
        ) {
          const [installer] = await tx
            .select({ id: companies.id })
            .from(companies)
            .where(
              and(
                eq(companies.id, values.installerCompanyId),
                eq(companies.type, 'Subcontractor Installer'),
                isNull(companies.archivedAt),
              ),
            );
          if (!installer) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Choose an installer from the list (a company of type Subcontractor Installer).',
            });
          }
        }
        if (values.bookedByUserId && values.bookedByUserId !== existing?.bookedByUserId) {
          const [user] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, values.bookedByUserId), eq(users.isActive, true)));
          if (!user) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'That person is not an active user.',
            });
          }
        }
        await saveSection(tx, ctx, input.id, 'update_installation', existing, values, () =>
          tx
            .insert(projectInstallation)
            .values({ projectId: input.id, ...values })
            .onConflictDoUpdate({ target: projectInstallation.projectId, set: values }),
        );
        await logStatus(tx, ctx, input.id, 'Installation', existing?.status, values.status);
        return { id: input.id };
      }),
    ),

  updateStcClaim: permissionProcedure('projects', 'edit')
    .input(sectionInput(stcClaimSchema))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await editableProject(tx, input.id);
        const [existing] = await tx
          .select()
          .from(projectStcClaims)
          .where(eq(projectStcClaims.projectId, input.id));
        const values = input.values;
        await assertOptions(tx, values, existing, [
          ['stcPortals', 'portal', 'STC portal'],
          ['stcStatuses', 'status', 'STC status'],
        ]);
        await saveSection(tx, ctx, input.id, 'update_stc', existing, values, () =>
          tx
            .insert(projectStcClaims)
            .values({ projectId: input.id, ...values })
            .onConflictDoUpdate({ target: projectStcClaims.projectId, set: values }),
        );
        await logStatus(tx, ctx, input.id, 'STC claim', existing?.status, values.status);
        return { id: input.id };
      }),
    ),

  updateOpenSolar: permissionProcedure('projects', 'edit')
    .input(sectionInput(openSolarSchema))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await editableProject(tx, input.id);
        const [existing] = await tx
          .select()
          .from(projectOpenSolar)
          .where(eq(projectOpenSolar.projectId, input.id));
        const { contractSignedDate, ...rest } = input.values;
        // Keep the stored moment when the day didn't change, so re-saving isn't a "change".
        const sameDay =
          existing?.contractSignedAt &&
          businessToday(existing.contractSignedAt) === contractSignedDate;
        const values = {
          ...rest,
          contractSignedAt: contractSignedDate
            ? sameDay
              ? existing.contractSignedAt
              : middayInSydney(contractSignedDate)
            : null,
        };
        const changes = await saveSection(
          tx,
          ctx,
          input.id,
          'update_opensolar',
          existing,
          values,
          () =>
            tx
              .insert(projectOpenSolar)
              .values({ projectId: input.id, ...values })
              .onConflictDoUpdate({ target: projectOpenSolar.projectId, set: values }),
        );
        if (changes && values.contractSigned && !existing?.contractSigned) {
          await logSystemActivity(tx, {
            entityType: 'project',
            entityId: input.id,
            authorUserId: ctx.user.id,
            subject: 'Contract signed (OpenSolar)',
          });
        }
        return { id: input.id };
      }),
    ),
};

/** Every post-sale section of one project, with the values worked out on the server. */
export async function loadSections(db: Db, project: Project) {
  const verifiedBy = db
    .select({ name: users.name })
    .from(users)
    .innerJoin(projectEbVerification, eq(projectEbVerification.verifiedByUserId, users.id))
    .where(eq(projectEbVerification.projectId, project.id));
  const [[eb], [verifier], [grid], [finance], [warehouse], [installation], [stc], [openSolar]] =
    await Promise.all([
      db
        .select()
        .from(projectEbVerification)
        .where(eq(projectEbVerification.projectId, project.id)),
      verifiedBy,
      db
        .select()
        .from(projectGridApplications)
        .where(eq(projectGridApplications.projectId, project.id)),
      db.select().from(projectFinance).where(eq(projectFinance.projectId, project.id)),
      db.select().from(projectWarehouse).where(eq(projectWarehouse.projectId, project.id)),
      db
        .select({
          row: projectInstallation,
          installerName: companies.name,
          bookedByName: users.name,
        })
        .from(projectInstallation)
        .leftJoin(companies, eq(companies.id, projectInstallation.installerCompanyId))
        .leftJoin(users, eq(users.id, projectInstallation.bookedByUserId))
        .where(eq(projectInstallation.projectId, project.id)),
      db.select().from(projectStcClaims).where(eq(projectStcClaims.projectId, project.id)),
      db.select().from(projectOpenSolar).where(eq(projectOpenSolar.projectId, project.id)),
    ]);

  const checks = ebCheckResults(eb ?? {}, project.phase);
  return {
    eb: eb
      ? {
          ...sectionValues(eb),
          verifiedAt: eb.verifiedAt?.toISOString() ?? null,
          verifiedByName: verifier?.name ?? null,
        }
      : null,
    ebChecks: checks,
    grid: grid ? { ...sectionValues(grid), timing: gridTiming(grid) } : null,
    finance: finance
      ? { ...sectionValues(finance), onFinance: isOnFinance(finance.financeOption) }
      : null,
    warehouse: warehouse ? sectionValues(warehouse) : null,
    installation: installation
      ? {
          ...sectionValues(installation.row),
          installerName: installation.installerName,
          bookedByName: installation.bookedByName,
          completedMonth: completedMonth(installation.row.completedDate),
        }
      : null,
    stc: stc
      ? {
          ...sectionValues(stc),
          bridgeselectSyncedAt: stc.bridgeselectSyncedAt?.toISOString() ?? null,
          totals: stcTotals(stc),
        }
      : null,
    openSolar: openSolar
      ? {
          ...sectionValues(openSolar),
          contractSignedAt: openSolar.contractSignedAt?.toISOString() ?? null,
          contractSignedDate: openSolar.contractSignedAt
            ? businessToday(openSolar.contractSignedAt)
            : null,
          lastSyncedAt: openSolar.lastSyncedAt?.toISOString() ?? null,
        }
      : null,
  };
}
