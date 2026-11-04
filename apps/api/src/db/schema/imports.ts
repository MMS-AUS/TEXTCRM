import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_columns.ts';
import { users } from './users.ts';

/** Spreadsheet column header → CRM field, e.g. { firstName: 'First Name' }. */
export type ColumnMapping = Record<string, string>;

/**
 * One run of the import wizard (Step 3.2): where the rows came from, how the columns were
 * mapped, and the outcome. Rows are kept in import_job_rows for the preview and error report.
 */
export const importJobs = pgTable(
  'import_jobs',
  {
    id: id(),
    /** 'leads' | 'contacts' | 'panels' | 'inverters' | 'batteries' (hardware catalog). */
    target: text().notNull(),
    /** 'upload' (CSV/XLSX in storage) | 'google_sheet'. */
    sourceType: text().notNull(),
    fileName: text(),
    storageKey: text(),
    spreadsheetId: text(),
    spreadsheetTitle: text(),
    /** The tab of a Google Sheet or the worksheet of an XLSX file. */
    sheetTab: text(),
    headers: jsonb().$type<string[]>(),
    mapping: jsonb().$type<ColumnMapping>(),
    /** uploading → ready → previewed → queued → running → completed | failed. */
    status: text().notNull().default('uploading'),
    totalRows: integer().notNull().default(0),
    processedRows: integer().notNull().default(0),
    createdCount: integer().notNull().default(0),
    updatedCount: integer().notNull().default(0),
    skippedCount: integer().notNull().default(0),
    errorCount: integer().notNull().default(0),
    error: text(),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    startedAt: tstz(),
    finishedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    index('import_jobs_created_at_idx').on(t.createdAt),
    check(
      'import_jobs_target_valid',
      sql`${t.target} in ('leads', 'contacts', 'panels', 'inverters', 'batteries')`,
    ),
    check('import_jobs_source_valid', sql`${t.sourceType} in ('upload', 'google_sheet')`),
  ],
);

export const importJobRows = pgTable(
  'import_job_rows',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    importJobId: uuid()
      .notNull()
      .references(() => importJobs.id, { onDelete: 'cascade' }),
    /** The row as people see it in the spreadsheet (header = row 1). */
    rowNumber: integer().notNull(),
    /** The mapped values as read: { firstName: 'Olivia', … }. */
    data: jsonb().$type<Record<string, string>>().notNull(),
    /** create | update | skip | error — the plan after preview, the outcome after the run. */
    action: text().notNull(),
    message: text(),
    /** The lead or contact created/updated/matched. */
    recordId: uuid(),
    /** True once the run has applied this row. */
    applied: boolean().notNull().default(false),
  },
  (t) => [
    unique('import_job_rows_row_unique').on(t.importJobId, t.rowNumber),
    check(
      'import_job_rows_action_valid',
      sql`${t.action} in ('create', 'update', 'skip', 'error')`,
    ),
  ],
);

/** A live leads sheet (Step 3.3), read every SHEETS_SYNC_INTERVAL_MINUTES when enabled. */
export const sheetSyncSources = pgTable('sheet_sync_sources', {
  id: id(),
  name: text().notNull(),
  spreadsheetId: text().notNull(),
  spreadsheetTitle: text(),
  sheetTab: text().notNull(),
  mapping: jsonb().$type<ColumnMapping>().notNull(),
  enabled: boolean().notNull().default(false),
  lastRunAt: tstz(),
  createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/** One sync of one sheet (§1.8 rule 6): every run is logged, with its per-row errors. */
export const sheetSyncRuns = pgTable(
  'sheet_sync_runs',
  {
    id: id(),
    sourceId: uuid()
      .notNull()
      .references(() => sheetSyncSources.id, { onDelete: 'cascade' }),
    /** 'schedule' | 'manual'. */
    trigger: text().notNull(),
    /** running | completed | failed. */
    status: text().notNull().default('running'),
    startedAt: tstz().notNull().defaultNow(),
    finishedAt: tstz(),
    rowsRead: integer().notNull().default(0),
    createdCount: integer().notNull().default(0),
    updatedCount: integer().notNull().default(0),
    linkedCount: integer().notNull().default(0),
    skippedCount: integer().notNull().default(0),
    errorCount: integer().notNull().default(0),
    /** Why the whole run failed (sheet not shared, column missing…). */
    error: text(),
  },
  (t) => [index('sheet_sync_runs_source_idx').on(t.sourceId, t.startedAt)],
);

export const sheetSyncRunErrors = pgTable(
  'sheet_sync_run_errors',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    runId: uuid()
      .notNull()
      .references(() => sheetSyncRuns.id, { onDelete: 'cascade' }),
    rowNumber: integer().notNull(),
    sheetLeadId: text(),
    message: text().notNull(),
  },
  (t) => [index('sheet_sync_run_errors_run_idx').on(t.runId, t.rowNumber)],
);
