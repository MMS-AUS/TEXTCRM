import { and, eq, isNull } from 'drizzle-orm';
import { LEAD_IMPORT_FIELDS, mapRow, mappingProblems } from '@mms/shared';
import type { Db } from '../../db/client.ts';
import {
  leads,
  sheetSyncRunErrors,
  sheetSyncRuns,
  sheetSyncSources,
} from '../../db/schema/index.ts';
import type { Logger } from '../../logger.ts';
import { logSystemActivity } from '../activities/service.ts';
import { recordAudit, type SystemActor } from '../audit.ts';
import { SheetAccessError, type SheetsReader } from '../imports/google-sheets.ts';
import { ImportFileError, toTable } from '../imports/parse.ts';
import {
  changedFields,
  createLeadFromRecord,
  hasChanges,
  leadIntakeChanges,
  loadLookups,
  toLeadRecord,
  updateLeadIntake,
  type Origin,
} from '../imports/records.ts';
import { findDuplicate } from '../leads/router.ts';

// The live leads sync (Step 3.3), exactly per §1.8 — "the Sheet creates, the CRM owns after":
//  1. a row with a new Lead ID creates a lead;
//  2. a known Lead ID updates intake fields only while nobody has edited the lead in the CRM
//     (and only leads the sync itself created);
//  3. status, notes and sales rep are used on create only; activities etc. are never touched;
//  4. a row removed from the sheet never deletes anything;
//  5. rows without a Lead ID are skipped and reported;
//  6. every run is logged with its counts and per-row errors;
//  7. a new row matching an existing lead (§1.4) is linked to it, not created again.
// Sheet → CRM only: nothing is ever written back to the sheet.

type Source = typeof sheetSyncSources.$inferSelect;
type Lead = typeof leads.$inferSelect;

export type SyncTrigger = 'schedule' | 'manual';

const ACTOR: SystemActor = { system: 'sheet_sync' };

type Counts = {
  rowsRead: number;
  createdCount: number;
  updatedCount: number;
  linkedCount: number;
  skippedCount: number;
  errorCount: number;
};

type RowNote = { rowNumber: number; sheetLeadId: string | null; message: string };

/** "mobile" → "primary mobile", for the timeline. */
const fieldLabel = (key: string) =>
  (LEAD_IMPORT_FIELDS.find((field) => field.key === key)?.label ?? key).toLowerCase();

const nameOf = (lead: Pick<Lead, 'firstName' | 'lastName'>) =>
  [lead.firstName, lead.lastName].filter(Boolean).join(' ');

/** Thrown for problems with the sheet or its set-up: the run fails with this message. */
class SyncSetupError extends Error {}

async function readRows(sheets: SheetsReader, source: Source) {
  try {
    const table = toTable(await sheets.read(source.spreadsheetId, source.sheetTab));
    const missing = Object.entries(source.mapping).filter(
      ([, header]) => !table.headers.includes(header),
    );
    if (missing.length) {
      throw new SyncSetupError(
        `The sheet no longer has the column${missing.length > 1 ? 's' : ''} ${missing
          .map(([, header]) => `"${header}"`)
          .join(', ')}. Fix the column mapping in Settings → Live sheet sync.`,
      );
    }
    return table;
  } catch (error) {
    if (error instanceof SheetAccessError || error instanceof ImportFileError) {
      throw new SyncSetupError(error.message);
    }
    throw error;
  }
}

/** The lead that already carries this Lead ID from this sheet — deleted ones included. */
async function leadForSheetId(db: Db, sourceId: string, sheetLeadId: string) {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.sheetSourceId, sourceId), eq(leads.sheetLeadId, sheetLeadId)))
    .limit(1);
  return lead ?? null;
}

/**
 * Syncs one sheet: reads it, applies §1.8 row by row (each row in its own transaction, so one
 * bad row never stops the rest) and logs the run. Returns the run's id and counts.
 */
export async function syncSheetSource(
  db: Db,
  sheets: SheetsReader,
  sourceId: string,
  trigger: SyncTrigger,
  log?: Logger,
) {
  const [source] = await db
    .select()
    .from(sheetSyncSources)
    .where(eq(sheetSyncSources.id, sourceId));
  if (!source) return null;

  const [run] = await db
    .insert(sheetSyncRuns)
    .values({ sourceId, trigger })
    .returning({ id: sheetSyncRuns.id });
  if (!run) throw new Error('Insert returned no row');

  const counts: Counts = {
    rowsRead: 0,
    createdCount: 0,
    updatedCount: 0,
    linkedCount: 0,
    skippedCount: 0,
    errorCount: 0,
  };
  const notes: RowNote[] = [];
  const fail = (rowNumber: number, sheetLeadId: string | null, message: string) => {
    counts.errorCount += 1;
    notes.push({ rowNumber, sheetLeadId, message });
  };
  const sourceLabel = `live sheet "${source.name}"`;

  const finish = async (status: 'completed' | 'failed', error: string | null) => {
    await db.transaction(async (tx) => {
      for (let i = 0; i < notes.length; i += 500) {
        await tx
          .insert(sheetSyncRunErrors)
          .values(notes.slice(i, i + 500).map((note) => ({ runId: run.id, ...note })));
      }
      await tx
        .update(sheetSyncRuns)
        .set({ status, error, finishedAt: new Date(), ...counts })
        .where(eq(sheetSyncRuns.id, run.id));
      await tx
        .update(sheetSyncSources)
        .set({ lastRunAt: new Date() })
        .where(eq(sheetSyncSources.id, source.id));
    });
    return { runId: run.id, status, error, ...counts };
  };

  try {
    const problems = mappingProblems('leads', source.mapping, { requireLeadId: true });
    if (problems.length) throw new SyncSetupError(problems.join(' '));
    const table = await readRows(sheets, source);
    const lookups = await loadLookups(db);
    const seen = new Map<string, number>();
    counts.rowsRead = table.rows.length;

    for (const row of table.rows) {
      const data = mapRow(table.headers, row.cells, source.mapping);
      const sheetLeadId = data.sheetLeadId?.slice(0, 100) ?? null;

      // Rule 5: no Lead ID → skipped and reported, never guessed.
      if (!sheetLeadId) {
        counts.skippedCount += 1;
        notes.push({
          rowNumber: row.rowNumber,
          sheetLeadId: null,
          message: 'No Lead ID — skipped. Give the row a Lead ID and it is picked up next run.',
        });
        continue;
      }
      const earlier = seen.get(sheetLeadId);
      if (earlier !== undefined) {
        fail(
          row.rowNumber,
          sheetLeadId,
          `Lead ID ${sheetLeadId} is also on row ${String(earlier)} — only that row is used. Give each row its own Lead ID.`,
        );
        continue;
      }
      seen.set(sheetLeadId, row.rowNumber);

      const parsed = toLeadRecord(data, lookups);
      if (!parsed.ok) {
        fail(row.rowNumber, sheetLeadId, parsed.message);
        continue;
      }
      const record = parsed.record;

      try {
        const existing = await leadForSheetId(db, source.id, sheetLeadId);
        if (existing) {
          // Rules 2 and 3: the sheet keeps intake fields up to date only until the CRM owns
          // the lead — after a CRM edit, deletion, or if the lead wasn't created by the sync.
          const ownedByCrm =
            existing.crmEditedAt !== null ||
            existing.deletedAt !== null ||
            existing.createdByUserId !== null;
          if (ownedByCrm) continue;
          const changes = await leadIntakeChanges(db, existing, record);
          if (!hasChanges(changes)) continue;
          await db.transaction(async (tx) => {
            // Never crmEditedAt: a sheet update doesn't make the CRM the owner.
            await updateLeadIntake(tx, existing.id, record, changes, {
              actor: ACTOR,
              authorUserId: null,
              subject: '',
            });
            await logSystemActivity(tx, {
              entityType: 'lead',
              entityId: existing.id,
              authorUserId: null,
              subject: `Updated from the ${sourceLabel}: ${changedFields(changes).map(fieldLabel).join(', ')}`,
              metadata: { sheetLeadId, sourceId: source.id },
            });
          });
          counts.updatedCount += 1;
          continue;
        }

        // Rule 7: a new Lead ID that is someone already in the CRM is linked, not created.
        const duplicate = await findDuplicate(db, record.lead);
        if (duplicate) {
          const [match] = await db.select().from(leads).where(eq(leads.id, duplicate.lead.id));
          if (match && match.sheetSourceId === null) {
            const linked = await db.transaction(async (tx) => {
              const updated = await tx
                .update(leads)
                .set({ sheetSourceId: source.id, sheetLeadId })
                .where(and(eq(leads.id, match.id), isNull(leads.sheetSourceId)))
                .returning({ id: leads.id });
              if (updated.length === 0) return false;
              await logSystemActivity(tx, {
                entityType: 'lead',
                entityId: match.id,
                authorUserId: null,
                subject: `Linked to Lead ID ${sheetLeadId} in the ${sourceLabel} (${duplicate.reason}) — not created twice`,
                metadata: { sheetLeadId, sourceId: source.id },
              });
              await recordAudit(tx, ACTOR, {
                action: 'sheet_link',
                entityType: 'lead',
                entityId: match.id,
                before: { sheetSourceId: null, sheetLeadId: match.sheetLeadId },
                after: { sheetSourceId: source.id, sheetLeadId },
              });
              return true;
            });
            if (linked) {
              counts.linkedCount += 1;
              notes.push({
                rowNumber: row.rowNumber,
                sheetLeadId,
                message: `Linked to ${nameOf(match)}, already in the CRM (${duplicate.reason}) — not created twice.`,
              });
              continue;
            }
          }
          fail(
            row.rowNumber,
            sheetLeadId,
            match?.sheetLeadId && match.sheetSourceId === source.id
              ? `Same customer as Lead ID ${match.sheetLeadId} (${duplicate.reason}) — not created. Merge the two rows or give them different details.`
              : `Same customer as ${match ? nameOf(match) : 'a lead'} from another sheet (${duplicate.reason}) — not created.`,
          );
          continue;
        }

        // Rule 1: a new Lead ID creates the lead — with status, sales rep and notes (rule 3).
        const origin: Origin = {
          actor: ACTOR,
          authorUserId: null,
          subject: `Created from the ${sourceLabel} (Lead ID ${sheetLeadId})`,
        };
        await db.transaction((tx) => createLeadFromRecord(tx, record, origin, source.id));
        counts.createdCount += 1;
        if (record.notes.length) {
          notes.push({
            rowNumber: row.rowNumber,
            sheetLeadId,
            message: `Created. ${record.notes.join(' ')}`,
          });
        }
      } catch (error) {
        log?.warn({ err: error, sourceId, row: row.rowNumber }, 'Sheet sync row failed');
        fail(row.rowNumber, sheetLeadId, "Couldn't be saved. Check the row's values.");
      }
    }
    return await finish('completed', null);
  } catch (error) {
    if (error instanceof SyncSetupError) return finish('failed', error.message);
    log?.error({ err: error, sourceId }, 'Sheet sync failed');
    await finish('failed', 'The sync stopped unexpectedly. It will be tried again.').catch(
      () => undefined,
    );
    throw error;
  }
}

/** SHEETS_SYNC_INTERVAL_MINUTES as a cron expression, e.g. 5 → every fifth minute. */
export function syncCron(minutes: number) {
  return minutes >= 60 ? '0 * * * *' : `*/${String(minutes)} * * * *`;
}

/** The scheduled job: every enabled sheet, one after another. */
export async function syncEnabledSources(
  db: Db,
  sheets: SheetsReader | null,
  log?: Logger,
): Promise<{ synced: number }> {
  const sources = await db
    .select({ id: sheetSyncSources.id })
    .from(sheetSyncSources)
    .where(eq(sheetSyncSources.enabled, true));
  if (sources.length === 0) return { synced: 0 };
  if (!sheets) {
    log?.warn('Live sheet sync is enabled but GOOGLE_SERVICE_ACCOUNT_PATH is not set');
    return { synced: 0 };
  }
  let failures = 0;
  for (const source of sources) {
    try {
      await syncSheetSource(db, sheets, source.id, 'schedule', log);
    } catch {
      failures += 1; // Already logged and recorded on the run; carry on with the other sheets.
    }
  }
  if (failures === sources.length) throw new Error('Every sheet sync failed');
  return { synced: sources.length - failures };
}
