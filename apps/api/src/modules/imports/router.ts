import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  hasPermission,
  IMPORT_FILE_TYPES,
  IMPORT_ROWS_PAGE_SIZE,
  IMPORT_TARGETS,
  importIdSchema,
  importPreviewSchema,
  importRowsInputSchema,
  importSheetRequestSchema,
  importTabSchema,
  importUploadRequestSchema,
  MAX_IMPORT_BYTES,
  mappingProblems,
  suggestMapping,
  type ImportTarget,
} from '@mms/shared';
import type { AuthUser } from '../../auth/types.ts';
import type { Db } from '../../db/client.ts';
import { importJobRows, importJobs, users } from '../../db/schema/index.ts';
import { QUEUES } from '../../jobs/queue.ts';
import type { Storage } from '../../storage/storage.ts';
import type { Context } from '../../trpc/context.ts';
import { protectedProcedure, router } from '../../trpc/trpc.ts';
import { recordAudit } from '../audit.ts';
import { requireJobs } from '../jobs/router.ts';
import { parseSpreadsheetId, SheetAccessError, type SheetsReader } from './google-sheets.ts';
import { ImportFileError, readUpload, toTable, type Table } from './parse.ts';
import { errorReportCsv, previewImport } from './service.ts';

// Settings → Import (Step 3.2): upload a CSV/XLSX file or read a Google Sheet, map its columns,
// preview what every row will do, then run it as a background job.

type ImportJob = typeof importJobs.$inferSelect;

/** Importing creates and updates records, so it needs both on the target. */
function canImport(user: AuthUser, target: ImportTarget) {
  return (
    hasPermission(user.permissions, target, 'create') &&
    hasPermission(user.permissions, target, 'edit')
  );
}

function assertCanImport(user: AuthUser, target: ImportTarget) {
  if (!canImport(user, target)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your role does not allow this import.' });
  }
}

const visibleTargets = (user: AuthUser) => IMPORT_TARGETS.filter((t) => canImport(user, t));

function requireStorage(storage: Storage | null): Storage {
  if (!storage) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        "File storage isn't set up yet, so files can't be uploaded. Add the S3_ settings to .env.",
    });
  }
  return storage;
}

function requireSheets(sheets: SheetsReader | null): SheetsReader {
  if (!sheets) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        "Google Sheets isn't connected yet. Set GOOGLE_SERVICE_ACCOUNT_PATH in .env (Task T-07), or download the sheet as .xlsx and upload it.",
    });
  }
  return sheets;
}

/** Problems with the file or sheet that the user can fix become clear 400s. */
async function userFixable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ImportFileError || error instanceof SheetAccessError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    }
    throw error;
  }
}

async function loadJob(ctx: Context & { user: AuthUser }, id: string): Promise<ImportJob> {
  const [job] = await ctx.db.select().from(importJobs).where(eq(importJobs.id, id));
  if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'This import no longer exists.' });
  assertCanImport(ctx.user, job.target as ImportTarget);
  return job;
}

function assertStatus(job: ImportJob, allowed: string[], message: string) {
  if (!allowed.includes(job.status)) throw new TRPCError({ code: 'CONFLICT', message });
}

/** The sheet's rows, read again from storage or Google, plus the tabs to choose from. */
async function readSource(
  ctx: Context,
  job: ImportJob,
  tab?: string,
): Promise<{ tabs: string[]; tab: string | null; table: Table }> {
  return userFixable(async () => {
    if (job.sourceType === 'upload') {
      const storage = requireStorage(ctx.storage);
      if (!job.storageKey || !job.fileName) throw new ImportFileError('The upload is missing.');
      const buffer = await storage.read(job.storageKey, MAX_IMPORT_BYTES);
      return readUpload(buffer, job.fileName, tab ?? job.sheetTab ?? undefined);
    }
    const sheets = requireSheets(ctx.sheets);
    if (!job.spreadsheetId) throw new ImportFileError('The sheet link is missing.');
    const { tabs } = await sheets.describe(job.spreadsheetId);
    const chosen = tab ?? job.sheetTab ?? tabs[0];
    if (!chosen) throw new ImportFileError('The spreadsheet has no tabs.');
    if (!tabs.includes(chosen))
      throw new ImportFileError(`The sheet has no tab called "${chosen}".`);
    return { tabs, tab: chosen, table: toTable(await sheets.read(job.spreadsheetId, chosen)) };
  });
}

async function markReady(db: Db, job: ImportJob, tab: string | null, table: Table) {
  const headersChanged = JSON.stringify(job.headers) !== JSON.stringify(table.headers);
  await db
    .update(importJobs)
    .set({
      status: 'ready',
      sheetTab: tab,
      headers: table.headers,
      totalRows: table.rows.length,
      // A different tab or file layout makes an earlier mapping meaningless.
      ...(headersChanged ? { mapping: null } : {}),
    })
    .where(eq(importJobs.id, job.id));
  if (job.status === 'previewed') {
    await db.delete(importJobRows).where(eq(importJobRows.importJobId, job.id));
  }
}

function summary(job: ImportJob, creator: string | null) {
  return {
    id: job.id,
    target: job.target as ImportTarget,
    sourceType: job.sourceType as 'upload' | 'google_sheet',
    sourceName: job.fileName ?? job.spreadsheetTitle ?? 'Spreadsheet',
    sheetTab: job.sheetTab,
    status: job.status,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    counts: {
      create: job.createdCount,
      update: job.updatedCount,
      skip: job.skippedCount,
      error: job.errorCount,
    },
    error: job.error,
    createdByName: creator,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

const NOT_EDITABLE = 'This import has already been started, so it can no longer be changed.';

export const importsRouter = router({
  /** What the wizard can offer this user: targets, and whether uploads/Google are set up. */
  setup: protectedProcedure.query(({ ctx }) => ({
    targets: visibleTargets(ctx.user),
    uploadsEnabled: ctx.storage !== null,
    googleSheets: ctx.sheets ? { serviceAccountEmail: ctx.sheets.serviceAccountEmail } : null,
    jobsEnabled: ctx.jobs !== null,
  })),

  /** Recent imports for the targets this user can import. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const targets = visibleTargets(ctx.user);
    if (targets.length === 0) return [];
    const rows = await ctx.db
      .select({ job: importJobs, creator: users.name })
      .from(importJobs)
      .leftJoin(users, eq(users.id, importJobs.createdByUserId))
      .where(and(inArray(importJobs.target, targets), sql`${importJobs.status} <> 'uploading'`))
      .orderBy(desc(importJobs.createdAt))
      .limit(20);
    return rows.map(({ job, creator }) => summary(job, creator));
  }),

  get: protectedProcedure.input(importIdSchema).query(async ({ ctx, input }) => {
    const job = await loadJob(ctx, input.id);
    const [creator] = job.createdByUserId
      ? await ctx.db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, job.createdByUserId))
      : [];
    return { ...summary(job, creator?.name ?? null), mapping: job.mapping };
  }),

  /** Step 1a: a presigned URL the browser PUTs the file to. */
  createUpload: protectedProcedure
    .input(importUploadRequestSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanImport(ctx.user, input.target);
      const storage = requireStorage(ctx.storage);
      const extension = input.fileName.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
      const contentType = IMPORT_FILE_TYPES[extension];
      const id = randomUUID();
      const storageKey = `imports/${id}/upload.${extension}`;
      await ctx.db.insert(importJobs).values({
        id,
        target: input.target,
        sourceType: 'upload',
        fileName: input.fileName,
        storageKey,
        createdByUserId: ctx.user.id,
      });
      return {
        id,
        contentType,
        uploadUrl: await storage.presignUpload(storageKey, contentType, input.sizeBytes),
      };
    }),

  /** Step 1b: checks the file arrived and can be read. */
  completeUpload: protectedProcedure.input(importIdSchema).mutation(async ({ ctx, input }) => {
    const job = await loadJob(ctx, input.id);
    assertStatus(job, ['uploading'], 'This upload has already been checked.');
    const storage = requireStorage(ctx.storage);
    if (!job.storageKey || !(await storage.head(job.storageKey))) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: "The file didn't finish uploading. Please try again.",
      });
    }
    const { tab, table } = await readSource(ctx, job);
    await markReady(ctx.db, job, tab, table);
    return { id: job.id };
  }),

  /** Step 1 (Google): reads a sheet shared with the service account. */
  fromGoogleSheet: protectedProcedure
    .input(importSheetRequestSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanImport(ctx.user, input.target);
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
      const tab = tabs[0];
      if (!tab)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'The spreadsheet has no tabs.' });
      const table = await userFixable(async () => toTable(await sheets.read(spreadsheetId, tab)));
      const [job] = await ctx.db
        .insert(importJobs)
        .values({
          target: input.target,
          sourceType: 'google_sheet',
          spreadsheetId,
          spreadsheetTitle: title,
          createdByUserId: ctx.user.id,
        })
        .returning();
      if (!job) throw new Error('Insert returned no row');
      await markReady(ctx.db, job, tab, table);
      return { id: job.id };
    }),

  /** Step 2 data: tabs, headers, a few sample rows and the suggested (or saved) mapping. */
  source: protectedProcedure.input(importIdSchema).query(async ({ ctx, input }) => {
    const job = await loadJob(ctx, input.id);
    assertStatus(job, ['ready', 'previewed'], NOT_EDITABLE);
    const { tabs, tab, table } = await readSource(ctx, job);
    const target = job.target as ImportTarget;
    const saved = job.mapping
      ? Object.fromEntries(
          Object.entries(job.mapping).filter(([, header]) => table.headers.includes(header)),
        )
      : null;
    return {
      tabs,
      tab,
      headers: table.headers,
      rowCount: table.rows.length,
      sampleRows: table.rows.slice(0, 5).map((row) => row.cells),
      mapping: saved ?? suggestMapping(target, table.headers),
    };
  }),

  chooseTab: protectedProcedure.input(importTabSchema).mutation(async ({ ctx, input }) => {
    const job = await loadJob(ctx, input.id);
    assertStatus(job, ['ready', 'previewed'], NOT_EDITABLE);
    const { tab, table } = await readSource(ctx, job, input.tab);
    await markReady(ctx.db, job, tab, table);
    return { id: job.id };
  }),

  /** Step 3: plans every row (nothing in the CRM changes) and returns the totals. */
  preview: protectedProcedure.input(importPreviewSchema).mutation(async ({ ctx, input }) => {
    const job = await loadJob(ctx, input.id);
    assertStatus(job, ['ready', 'previewed'], NOT_EDITABLE);
    const problems = mappingProblems(job.target as ImportTarget, input.mapping);
    if (problems.length) throw new TRPCError({ code: 'BAD_REQUEST', message: problems.join(' ') });
    const { table } = await readSource(ctx, job);
    const missing = Object.values(input.mapping).filter(
      (header) => !table.headers.includes(header),
    );
    if (missing.length) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `The sheet no longer has these columns: ${missing.join(', ')}.`,
      });
    }
    const counts = await previewImport(ctx.db, job, table, input.mapping);
    return { counts, totalRows: table.rows.length };
  }),

  /** The planned (or, after the run, actual) result of each row, a page at a time. */
  rows: protectedProcedure.input(importRowsInputSchema).query(async ({ ctx, input }) => {
    const job = await loadJob(ctx, input.id);
    const where = and(
      eq(importJobRows.importJobId, job.id),
      input.action ? eq(importJobRows.action, input.action) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      ctx.db
        .select()
        .from(importJobRows)
        .where(where)
        .orderBy(asc(importJobRows.rowNumber))
        .limit(IMPORT_ROWS_PAGE_SIZE)
        .offset(input.page * IMPORT_ROWS_PAGE_SIZE),
      ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(importJobRows)
        .where(where),
    ]);
    return {
      total: total?.count ?? 0,
      rows: rows.map((row) => ({
        rowNumber: row.rowNumber,
        data: row.data,
        action: row.action as 'create' | 'update' | 'skip' | 'error',
        message: row.message,
        recordId: row.recordId,
        applied: row.applied,
      })),
    };
  }),

  /** Step 4: confirms the previewed import and queues it for the worker. */
  start: protectedProcedure.input(importIdSchema).mutation(async ({ ctx, input }) => {
    const job = await loadJob(ctx, input.id);
    assertStatus(
      job,
      ['previewed'],
      job.status === 'ready' ? 'Preview the import first.' : NOT_EDITABLE,
    );
    const jobs = requireJobs(ctx.jobs);
    // Only one confirmation wins, so a double click queues the import once.
    const queued = await ctx.db
      .update(importJobs)
      .set({ status: 'queued' })
      .where(and(eq(importJobs.id, job.id), eq(importJobs.status, 'previewed')))
      .returning({ id: importJobs.id });
    if (queued.length === 0) throw new TRPCError({ code: 'CONFLICT', message: NOT_EDITABLE });
    try {
      await jobs.send(QUEUES.runImport, { importId: job.id });
    } catch (error) {
      await ctx.db.update(importJobs).set({ status: 'previewed' }).where(eq(importJobs.id, job.id));
      throw error;
    }
    await recordAudit(
      ctx.db,
      { userId: ctx.user.id, meta: ctx.meta },
      {
        action: 'import_start',
        entityType: 'import',
        entityId: job.id,
        after: {
          target: job.target,
          source: job.fileName ?? job.spreadsheetTitle,
          rows: job.totalRows,
          mapping: job.mapping,
        },
      },
    );
    return { id: job.id };
  }),

  /** Rows that weren't imported, as a CSV the browser downloads. */
  errorReport: protectedProcedure.input(importIdSchema).query(async ({ ctx, input }) => {
    const job = await loadJob(ctx, input.id);
    const base = (job.fileName ?? job.spreadsheetTitle ?? 'import').replace(/\.(csv|xlsx)$/i, '');
    return { fileName: `${base} - not imported.csv`, csv: await errorReportCsv(ctx.db, job) };
  }),

  /** Abandons an import that hasn't started; its uploaded file is removed. */
  discard: protectedProcedure.input(importIdSchema).mutation(async ({ ctx, input }) => {
    const job = await loadJob(ctx, input.id);
    assertStatus(job, ['uploading', 'ready', 'previewed'], NOT_EDITABLE);
    await ctx.db.delete(importJobs).where(eq(importJobs.id, job.id));
    if (job.storageKey && ctx.storage) await ctx.storage.remove([job.storageKey]);
    return { id: job.id };
  }),
});
