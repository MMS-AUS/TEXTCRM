import { and, asc, eq, sql } from 'drizzle-orm';
import { IMPORT_FIELDS, mapRow, type ImportAction, type ImportTarget } from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import { importJobRows, importJobs } from '../../db/schema/index.ts';
import type { Logger } from '../../logger.ts';
import type { Actor } from '../audit.ts';
import type { Table } from './parse.ts';
import {
  applyContact,
  changedFields,
  contactRowKey,
  createLeadFromRecord,
  findLeadMatch,
  hasChanges,
  leadIntakeChanges,
  leadRowKey,
  loadLookups,
  planContact,
  toContactRecord,
  toLeadRecord,
  updateLeadIntake,
  type Lookups,
  type Origin,
} from './records.ts';

// The import wizard's engine (Step 3.2). Preview and run make the same decision for every row
// (decideRow), so what the preview promised is what the run does — re-checked at run time in
// case the CRM changed in between. Re-importing the same sheet finds every row again (Lead ID,
// then the §1.4 duplicate rules), so it never creates duplicates.

type ImportJob = typeof importJobs.$inferSelect;

/** What one row will do. `apply` saves it and returns the record's id. */
export type Decision =
  | { action: 'error'; message: string }
  | { action: 'skip'; message: string; recordId: string | null }
  | {
      action: 'create' | 'update';
      message: string | null;
      recordId: string | null;
      apply: (tx: Tx, origin: Origin) => Promise<string>;
    };

/** Rows earlier in the same file, by "same enquiry" key → their row number. */
export type Seen = Map<string, number>;

function fieldLabel(target: ImportTarget, key: string): string {
  const known = IMPORT_FIELDS[target].find((field) => field.key === key)?.label;
  if (known) return known.toLowerCase();
  return key.replace(/([A-Z])/g, ' $1').toLowerCase();
}

const withNotes = (message: string | null, notes: string[]) =>
  [message, ...notes].filter(Boolean).join(' ') || null;

/** The key a valid row is de-duplicated on within the file, or null for an invalid row. */
function rowKey(target: ImportTarget, data: Record<string, string>, lookups: Lookups) {
  if (target === 'leads') {
    const result = toLeadRecord(data, lookups);
    return result.ok ? leadRowKey(result.record) : null;
  }
  const result = toContactRecord(data, lookups);
  return result.ok ? contactRowKey(result.record) || null : null;
}

function sameAsEarlier(key: string | null, seen: Seen, rowNumber: number): Decision | null {
  if (!key) return null;
  const earlier = seen.get(key);
  if (earlier !== undefined && earlier !== rowNumber) {
    return {
      action: 'skip',
      message: `Same customer as row ${String(earlier)} of this sheet — imported once.`,
      recordId: null,
    };
  }
  seen.set(key, rowNumber);
  return null;
}

async function decideLead(
  db: Db | Tx,
  data: Record<string, string>,
  lookups: Lookups,
  seen: Seen,
  rowNumber: number,
): Promise<Decision> {
  const result = toLeadRecord(data, lookups);
  if (!result.ok) return { action: 'error', message: result.message };
  const record = result.record;
  const repeat = sameAsEarlier(leadRowKey(record), seen, rowNumber);
  if (repeat) return repeat;

  // One-off imports never claim a live sheet's leads: sheetSourceId stays null.
  const match = await findLeadMatch(db, record, null);
  if (!match) {
    return {
      action: 'create',
      message: withNotes(null, record.notes),
      recordId: null,
      apply: (tx, origin) => createLeadFromRecord(tx, record, origin, null),
    };
  }
  const name = [match.lead.firstName, match.lead.lastName].filter(Boolean).join(' ');
  if (match.how === 'duplicate') {
    // §1.4/§1.8 rule 7: a duplicate is linked to the lead it matches, never created again.
    return {
      action: 'skip',
      message: `Already in the CRM as ${name} (${match.reason}) — not created again.`,
      recordId: match.lead.id,
    };
  }
  if (match.lead.crmEditedAt) {
    return {
      action: 'skip',
      message: `${name} has been edited in the CRM since it was imported — left as it is.`,
      recordId: match.lead.id,
    };
  }
  const changes = await leadIntakeChanges(db, match.lead, record);
  if (!hasChanges(changes)) {
    return {
      action: 'skip',
      message: 'Already imported — nothing changed.',
      recordId: match.lead.id,
    };
  }
  const fields = changedFields(changes).map((key) => fieldLabel('leads', key));
  return {
    action: 'update',
    message: withNotes(`Updates ${fields.join(', ')}.`, record.notes),
    recordId: match.lead.id,
    apply: async (tx, origin) => {
      await updateLeadIntake(tx, match.lead.id, record, changes, origin);
      return match.lead.id;
    },
  };
}

async function decideContact(
  db: Db | Tx,
  data: Record<string, string>,
  lookups: Lookups,
  seen: Seen,
  rowNumber: number,
): Promise<Decision> {
  const result = toContactRecord(data, lookups);
  if (!result.ok) return { action: 'error', message: result.message };
  const record = result.record;
  const repeat = sameAsEarlier(contactRowKey(record) || null, seen, rowNumber);
  if (repeat) return repeat;

  const plan = await planContact(db, record);
  if (plan.action === 'skip') {
    return { action: 'skip', message: plan.message, recordId: plan.contactId };
  }
  const apply = async (tx: Tx, origin: Origin) => {
    const id = await applyContact(tx, record, plan, origin);
    if (!id) throw new Error('Contact was not saved');
    return id;
  };
  if (plan.action === 'create') {
    return { action: 'create', message: withNotes(null, record.notes), recordId: null, apply };
  }
  const adds = [
    ...Object.keys(plan.fill).map((key) => fieldLabel('contacts', key)),
    ...(plan.addAddress ? ['address'] : []),
  ];
  return {
    action: 'update',
    message: withNotes(`Already in the CRM — adds ${adds.join(', ')}.`, record.notes),
    recordId: plan.contactId,
    apply,
  };
}

export function decideRow(
  db: Db | Tx,
  target: ImportTarget,
  data: Record<string, string>,
  lookups: Lookups,
  seen: Seen,
  rowNumber: number,
): Promise<Decision> {
  return target === 'leads'
    ? decideLead(db, data, lookups, seen, rowNumber)
    : decideContact(db, data, lookups, seen, rowNumber);
}

export type ImportCounts = Record<ImportAction, number>;

const emptyCounts = (): ImportCounts => ({ create: 0, update: 0, skip: 0, error: 0 });

const countColumns = (counts: ImportCounts) => ({
  createdCount: counts.create,
  updatedCount: counts.update,
  skippedCount: counts.skip,
  errorCount: counts.error,
});

/**
 * Plans every row and stores the plan (replacing an earlier preview), so the wizard can page
 * through it and the run can apply it. Nothing in the CRM changes here.
 */
export async function previewImport(
  db: Db,
  job: ImportJob,
  table: Table,
  mapping: Record<string, string>,
): Promise<ImportCounts> {
  const target = job.target as ImportTarget;
  const lookups = await loadLookups(db);
  const seen: Seen = new Map();
  const counts = emptyCounts();
  const planned: (typeof importJobRows.$inferInsert)[] = [];
  for (const row of table.rows) {
    const data = mapRow(table.headers, row.cells, mapping);
    const decision = await decideRow(db, target, data, lookups, seen, row.rowNumber);
    counts[decision.action] += 1;
    planned.push({
      importJobId: job.id,
      rowNumber: row.rowNumber,
      data,
      action: decision.action,
      message: decision.message,
      recordId: decision.action === 'error' ? null : decision.recordId,
    });
  }
  await db.transaction(async (tx) => {
    await tx.delete(importJobRows).where(eq(importJobRows.importJobId, job.id));
    for (let i = 0; i < planned.length; i += 500) {
      await tx.insert(importJobRows).values(planned.slice(i, i + 500));
    }
    await tx
      .update(importJobs)
      .set({
        mapping,
        status: 'previewed',
        totalRows: planned.length,
        processedRows: 0,
        ...countColumns(counts),
        error: null,
      })
      .where(eq(importJobs.id, job.id));
  });
  return counts;
}

/** A row-level save failure in words a user can act on (never SQL). */
function rowFailure(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'cause' in error
      ? (error.cause as { code?: unknown } | undefined)?.code
      : typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
  if (code === '23505') {
    return 'Clashes with an existing record (same email or mobile) — not saved.';
  }
  return "Couldn't be saved. Check the row's values and import it again.";
}

async function storedCounts(db: Db, importId: string): Promise<ImportCounts> {
  const rows = await db
    .select({ action: importJobRows.action, count: sql<number>`count(*)::int` })
    .from(importJobRows)
    .where(and(eq(importJobRows.importJobId, importId), eq(importJobRows.applied, true)))
    .groupBy(importJobRows.action);
  const counts = emptyCounts();
  for (const row of rows) counts[row.action as ImportAction] = row.count;
  return counts;
}

/**
 * Runs a confirmed import (the `imports-run` job). Each row is saved in its own transaction, so
 * one bad row never undoes the others, and rows already applied are skipped — a retried job
 * picks up where the last attempt stopped.
 */
export async function runImport(
  db: Db,
  importId: string,
  log?: Logger,
): Promise<ImportCounts & { status: string }> {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, importId));
  if (!job) throw new Error(`Import ${importId} no longer exists`);
  if (job.status === 'completed')
    return { status: 'completed', ...(await storedCounts(db, job.id)) };
  if (!['queued', 'running', 'failed'].includes(job.status)) {
    throw new Error(`Import ${importId} is ${job.status}, not queued`);
  }

  await db
    .update(importJobs)
    .set({ status: 'running', error: null, startedAt: job.startedAt ?? new Date() })
    .where(eq(importJobs.id, job.id));

  const target = job.target as ImportTarget;
  const source = job.fileName ?? job.spreadsheetTitle ?? 'a spreadsheet';
  const actor: Actor = {
    // Imports are a person's action: audit rows name who confirmed it.
    userId: job.createdByUserId ?? '',
    meta: { requestId: `import-${job.id}`, ipAddress: null, userAgent: null },
  };

  try {
    const lookups = await loadLookups(db);
    const rows = await db
      .select()
      .from(importJobRows)
      .where(eq(importJobRows.importJobId, job.id))
      .orderBy(asc(importJobRows.rowNumber));
    const seen: Seen = new Map();
    let processed = rows.filter((row) => row.applied).length;

    for (const row of rows) {
      if (row.applied) {
        // Already saved by an earlier attempt; only its "same customer" key matters now.
        if (row.action !== 'error') {
          const key = rowKey(target, row.data, lookups);
          if (key && !seen.has(key)) seen.set(key, row.rowNumber);
        }
        continue;
      }
      const decision = await decideRow(db, target, row.data, lookups, seen, row.rowNumber);
      let outcome: { action: ImportAction; message: string | null; recordId: string | null };
      if (decision.action === 'create' || decision.action === 'update') {
        const origin: Origin = {
          actor: job.createdByUserId ? actor : { system: 'system' },
          authorUserId: job.createdByUserId,
          subject: `Imported from ${source} (row ${String(row.rowNumber)})`,
        };
        try {
          const recordId = await db.transaction((tx) => decision.apply(tx, origin));
          outcome = { action: decision.action, message: decision.message, recordId };
        } catch (error) {
          log?.warn({ err: error, importId, row: row.rowNumber }, 'Import row failed');
          outcome = { action: 'error', message: rowFailure(error), recordId: null };
        }
      } else {
        outcome = {
          action: decision.action,
          message: decision.message,
          recordId: decision.action === 'skip' ? decision.recordId : null,
        };
      }
      await db
        .update(importJobRows)
        .set({ ...outcome, applied: true })
        .where(eq(importJobRows.id, row.id));
      processed += 1;
      if (processed % 25 === 0) {
        await db
          .update(importJobs)
          .set({ processedRows: processed })
          .where(eq(importJobs.id, job.id));
      }
    }

    const counts = await storedCounts(db, job.id);
    await db
      .update(importJobs)
      .set({
        status: 'completed',
        processedRows: processed,
        ...countColumns(counts),
        finishedAt: new Date(),
      })
      .where(eq(importJobs.id, job.id));
    return { status: 'completed', ...counts };
  } catch (error) {
    // Whole-run failure (database unreachable…): shown on the import, then pg-boss retries.
    await db
      .update(importJobs)
      .set({
        status: 'failed',
        error:
          'The import stopped unexpectedly. It is retried automatically; rows already saved stay saved.',
      })
      .where(eq(importJobs.id, job.id))
      .catch(() => undefined);
    throw error;
  }
}

// ── Error report ─────────────────────────────────────────────────────────

/** One CSV cell; a leading = + - @ is neutralised so Excel never runs it as a formula. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Excel opens UTF-8 CSV correctly only with a byte-order mark. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const RESULT_LABELS: Record<ImportAction, string> = {
  create: 'Created',
  update: 'Updated',
  skip: 'Skipped',
  error: 'Error',
};

/** Rows that weren't imported (errors and skips), with the reason and the values read. */
export async function errorReportCsv(db: Db, job: ImportJob): Promise<string> {
  const target = job.target as ImportTarget;
  const rows = await db
    .select()
    .from(importJobRows)
    .where(
      and(eq(importJobRows.importJobId, job.id), sql`${importJobRows.action} in ('error', 'skip')`),
    )
    .orderBy(asc(importJobRows.rowNumber));
  const fields = IMPORT_FIELDS[target].filter((field) => job.mapping?.[field.key]);
  const header = [
    'Row',
    'Result',
    'Reason',
    ...fields.map((field) => job.mapping?.[field.key] ?? field.label),
  ];
  const lines = [
    header,
    ...rows.map((row) => [
      String(row.rowNumber),
      RESULT_LABELS[row.action as ImportAction],
      row.message ?? '',
      ...fields.map((field) => row.data[field.key] ?? ''),
    ]),
  ];
  return `${BYTE_ORDER_MARK}${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
