import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  mappingProblems,
  SHEET_SYNC_RUNS_PAGE_SIZE,
  sheetColumnsInputSchema,
  sheetLinkSchema,
  sheetSourceInputSchema,
  sheetSyncRunsInputSchema,
  suggestMapping,
} from '@mms/shared';
import type { Db } from '../../db/client.ts';
import {
  leads,
  sheetSyncRunErrors,
  sheetSyncRuns,
  sheetSyncSources,
  users,
} from '../../db/schema/index.ts';
import { QUEUES } from '../../jobs/queue.ts';
import { permissionProcedure, router } from '../../trpc/trpc.ts';
import { diff, recordAudit } from '../audit.ts';
import {
  parseSpreadsheetId,
  SheetAccessError,
  type SheetsReader,
} from '../imports/google-sheets.ts';
import { ImportFileError, toTable } from '../imports/parse.ts';
import { requireJobs } from '../jobs/router.ts';

// Settings → Live sheet sync (Step 3.3): which sheets are synced, their column mapping, on/off,
// "Sync now", and the history of runs with their row errors.

const viewProcedure = permissionProcedure('integrations', 'view');
const editProcedure = permissionProcedure('integrations', 'edit');

function requireSheets(sheets: SheetsReader | null): SheetsReader {
  if (!sheets) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        "Google Sheets isn't connected. Set GOOGLE_SERVICE_ACCOUNT_PATH in .env (Task T-07) and restart.",
    });
  }
  return sheets;
}

async function userFixable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SheetAccessError || error instanceof ImportFileError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    }
    throw error;
  }
}

const sheetUrl = (spreadsheetId: string) =>
  `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

async function lastRuns(db: Db) {
  // The newest run of each sheet.
  const rows = await db
    .selectDistinctOn([sheetSyncRuns.sourceId])
    .from(sheetSyncRuns)
    .orderBy(sheetSyncRuns.sourceId, desc(sheetSyncRuns.startedAt));
  return new Map(rows.map((run) => [run.sourceId, run]));
}

function runSummary(run: typeof sheetSyncRuns.$inferSelect) {
  return {
    id: run.id,
    trigger: run.trigger as 'schedule' | 'manual',
    status: run.status as 'running' | 'completed' | 'failed',
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    rowsRead: run.rowsRead,
    created: run.createdCount,
    updated: run.updatedCount,
    linked: run.linkedCount,
    skipped: run.skippedCount,
    errors: run.errorCount,
    error: run.error,
  };
}

async function loadSource(db: Db, id: string) {
  const [source] = await db.select().from(sheetSyncSources).where(eq(sheetSyncSources.id, id));
  if (!source)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'This sheet is no longer set up.' });
  return source;
}

export const sheetSyncRouter = router({
  setup: viewProcedure.query(({ ctx }) => ({
    serviceAccountEmail: ctx.sheets?.serviceAccountEmail ?? null,
    intervalMinutes: ctx.syncIntervalMinutes,
    jobsEnabled: ctx.jobs !== null,
  })),

  /** Every configured sheet with its latest run and how many leads came from it. */
  list: viewProcedure.query(async ({ ctx }) => {
    const [sources, latest, leadCounts] = await Promise.all([
      ctx.db.select().from(sheetSyncSources).orderBy(asc(sheetSyncSources.createdAt)),
      lastRuns(ctx.db),
      ctx.db
        .select({ sourceId: leads.sheetSourceId, count: sql<number>`count(*)::int` })
        .from(leads)
        .where(sql`${leads.sheetSourceId} is not null`)
        .groupBy(leads.sheetSourceId),
    ]);
    const counts = new Map(leadCounts.map((row) => [row.sourceId, row.count]));
    return sources.map((source) => {
      const run = latest.get(source.id);
      return {
        id: source.id,
        name: source.name,
        spreadsheetTitle: source.spreadsheetTitle,
        sheetTab: source.sheetTab,
        url: sheetUrl(source.spreadsheetId),
        enabled: source.enabled,
        leads: counts.get(source.id) ?? 0,
        lastRun: run ? runSummary(run) : null,
      };
    });
  }),

  get: viewProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const source = await loadSource(ctx.db, input.id);
    const [editor] = source.updatedByUserId
      ? await ctx.db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, source.updatedByUserId))
      : [];
    return {
      id: source.id,
      name: source.name,
      spreadsheetId: source.spreadsheetId,
      spreadsheetTitle: source.spreadsheetTitle,
      sheetTab: source.sheetTab,
      url: sheetUrl(source.spreadsheetId),
      mapping: source.mapping,
      enabled: source.enabled,
      updatedByName: editor?.name ?? null,
      updatedAt: source.updatedAt.toISOString(),
    };
  }),

  /** Step 1 of adding a sheet: the link → its title and tabs (proves it's shared with us). */
  inspect: editProcedure.input(sheetLinkSchema).mutation(async ({ ctx, input }) => {
    const sheets = requireSheets(ctx.sheets);
    const spreadsheetId = parseSpreadsheetId(input.url);
    if (!spreadsheetId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          "That doesn't look like a Google Sheets link. Copy it from the browser's address bar.",
      });
    }
    const { title, tabs } = await userFixable(() => sheets.describe(spreadsheetId));
    return { spreadsheetId, title, tabs };
  }),

  /** Step 2: a tab's headings, a few rows and the suggested mapping. */
  columns: editProcedure.input(sheetColumnsInputSchema).query(async ({ ctx, input }) => {
    const sheets = requireSheets(ctx.sheets);
    const table = await userFixable(async () =>
      toTable(await sheets.read(input.spreadsheetId, input.tab)),
    );
    return {
      headers: table.headers,
      rowCount: table.rows.length,
      sampleRows: table.rows.slice(0, 5).map((row) => row.cells),
      mapping: suggestMapping('leads', table.headers),
    };
  }),

  /** Adds or changes a sheet. The mapping must include Lead ID (§1.8) and match the sheet. */
  save: editProcedure.input(sheetSourceInputSchema).mutation(async ({ ctx, input }) => {
    const sheets = requireSheets(ctx.sheets);
    const problems = mappingProblems('leads', input.mapping, { requireLeadId: true });
    if (problems.length) throw new TRPCError({ code: 'BAD_REQUEST', message: problems.join(' ') });

    const existing = input.id ? await loadSource(ctx.db, input.id) : null;
    const spreadsheetId = existing?.spreadsheetId ?? input.spreadsheetId;
    const { title, tabs } = await userFixable(() => sheets.describe(spreadsheetId));
    if (!tabs.includes(input.tab)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `The sheet has no tab called "${input.tab}".`,
      });
    }
    const table = await userFixable(async () =>
      toTable(await sheets.read(spreadsheetId, input.tab)),
    );
    const missing = Object.values(input.mapping).filter((h) => !table.headers.includes(h));
    if (missing.length) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `The sheet has no column called ${missing.map((h) => `"${h}"`).join(', ')}.`,
      });
    }
    const [clash] = await ctx.db
      .select({ name: sheetSyncSources.name })
      .from(sheetSyncSources)
      .where(
        and(
          eq(sheetSyncSources.spreadsheetId, spreadsheetId),
          eq(sheetSyncSources.sheetTab, input.tab),
          existing ? ne(sheetSyncSources.id, existing.id) : undefined,
        ),
      );
    if (clash) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `This tab is already synced as "${clash.name}".`,
      });
    }

    const values = {
      name: input.name,
      spreadsheetTitle: title,
      sheetTab: input.tab,
      mapping: input.mapping,
      enabled: input.enabled,
      updatedByUserId: ctx.user.id,
    };
    const actor = { userId: ctx.user.id, meta: ctx.meta };
    return ctx.db.transaction(async (tx) => {
      if (existing) {
        await tx.update(sheetSyncSources).set(values).where(eq(sheetSyncSources.id, existing.id));
        const changes = diff(existing, values);
        if (changes) {
          await recordAudit(tx, actor, {
            action: 'update',
            entityType: 'sheet_sync_source',
            entityId: existing.id,
            ...changes,
          });
        }
        return { id: existing.id };
      }
      const [created] = await tx
        .insert(sheetSyncSources)
        .values({ ...values, spreadsheetId, createdByUserId: ctx.user.id })
        .returning({ id: sheetSyncSources.id });
      if (!created) throw new Error('Insert returned no row');
      await recordAudit(tx, actor, {
        action: 'create',
        entityType: 'sheet_sync_source',
        entityId: created.id,
        after: { ...values, spreadsheetId },
      });
      return { id: created.id };
    });
  }),

  setEnabled: editProcedure
    .input(z.object({ id: z.uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const source = await loadSource(ctx.db, input.id);
      if (source.enabled === input.enabled) return { id: source.id };
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(sheetSyncSources)
          .set({ enabled: input.enabled, updatedByUserId: ctx.user.id })
          .where(eq(sheetSyncSources.id, source.id));
        await recordAudit(
          tx,
          { userId: ctx.user.id, meta: ctx.meta },
          {
            action: input.enabled ? 'enable' : 'disable',
            entityType: 'sheet_sync_source',
            entityId: source.id,
          },
        );
      });
      return { id: source.id };
    }),

  /** Queues a run of one sheet now (also works while the schedule is off, to test it). */
  syncNow: editProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const source = await loadSource(ctx.db, input.id);
    requireSheets(ctx.sheets);
    const jobId = await requireJobs(ctx.jobs).send(QUEUES.syncSheets, { sourceId: source.id });
    if (!jobId) {
      throw new TRPCError({ code: 'CONFLICT', message: 'A sync is already waiting to run.' });
    }
    return { id: source.id };
  }),

  runs: viewProcedure.input(sheetSyncRunsInputSchema).query(async ({ ctx, input }) => {
    const where = eq(sheetSyncRuns.sourceId, input.sourceId);
    const [rows, [total]] = await Promise.all([
      ctx.db
        .select()
        .from(sheetSyncRuns)
        .where(where)
        .orderBy(desc(sheetSyncRuns.startedAt))
        .limit(SHEET_SYNC_RUNS_PAGE_SIZE)
        .offset(input.page * SHEET_SYNC_RUNS_PAGE_SIZE),
      ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(sheetSyncRuns)
        .where(where),
    ]);
    return { total: total?.count ?? 0, runs: rows.map(runSummary) };
  }),

  /** One run's row messages: errors, skipped rows without a Lead ID, links. */
  runErrors: viewProcedure.input(z.object({ runId: z.uuid() })).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select()
      .from(sheetSyncRunErrors)
      .where(eq(sheetSyncRunErrors.runId, input.runId))
      .orderBy(asc(sheetSyncRunErrors.rowNumber))
      .limit(1000);
    return rows.map((row) => ({
      rowNumber: row.rowNumber,
      sheetLeadId: row.sheetLeadId,
      message: row.message,
    }));
  }),
});
