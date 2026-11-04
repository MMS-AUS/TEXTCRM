import { and, eq, sql } from 'drizzle-orm';
import { hardwareItemSchemas, type HardwareCatalogKind } from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import { hardwareBatteries, hardwareInverters, hardwarePanels } from '../../db/schema/index.ts';
import { diff, recordAudit } from '../audit.ts';
import type { Origin } from './records.ts';

// Hardware catalogue rows for the import wizard (Step 2.10): one row → a panel, inverter or
// battery. De-duplicated on manufacturer + model (ignoring case), the catalogue's unique key.

export type HardwareTarget = 'panels' | 'inverters' | 'batteries';

const KIND: Record<HardwareTarget, HardwareCatalogKind> = {
  panels: 'panel',
  inverters: 'inverter',
  batteries: 'battery',
};
const TABLE = { panel: hardwarePanels, inverter: hardwareInverters, battery: hardwareBatteries };

/** A validated catalogue row: manufacturer and model always, plus this kind's columns. */
type Values = { manufacturer: string; model: string } & Record<string, string | null>;
export type HardwareRecord = { kind: HardwareCatalogKind; values: Values; given: Set<string> };

export function toHardwareRecord(
  target: HardwareTarget,
  data: Record<string, string>,
): { ok: true; record: HardwareRecord } | { ok: false; message: string } {
  const kind = KIND[target];
  const parsed = hardwareItemSchemas[kind].safeParse({
    ...data,
    // "440W", "5 kW", "13.5kWh" → the number.
    ...Object.fromEntries(
      ['sizeW', 'sizeKw', 'usableCapacityKwh']
        .filter((key) => data[key])
        .map((key) => [key, (data[key] ?? '').replace(/\s*(k?wh?|w)\s*$/i, '')]),
    ),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((issue) => issue.message).join(' ') };
  }
  return {
    ok: true,
    record: { kind, values: parsed.data, given: new Set(Object.keys(data)) },
  };
}

export const hardwareRowKey = (record: HardwareRecord) =>
  `${record.values.manufacturer.toLowerCase()}|${record.values.model.toLowerCase()}`;

export type HardwarePlan =
  | { action: 'create' }
  | {
      action: 'update';
      id: string;
      changes: { before: Record<string, unknown>; after: Record<string, unknown> };
    }
  | { action: 'skip'; id: string; message: string };

export async function planHardware(db: Db | Tx, record: HardwareRecord): Promise<HardwarePlan> {
  const table = TABLE[record.kind];
  const [existing] = await db
    .select()
    .from(table)
    .where(
      and(
        sql`lower(${table.manufacturer}) = lower(${record.values.manufacturer})`,
        sql`lower(${table.model}) = lower(${record.values.model})`,
      ),
    )
    .limit(1);
  if (!existing) return { action: 'create' };
  if (existing.archivedAt) {
    return {
      action: 'skip',
      id: existing.id,
      message: 'In the catalogue but archived — restore it in Settings → Hardware catalogue.',
    };
  }
  // Only columns the sheet has; an empty cell never blanks a catalogue value.
  const incoming = Object.fromEntries(
    Object.entries(record.values).filter(
      ([key, value]) =>
        record.given.has(key) && value !== null && key !== 'manufacturer' && key !== 'model',
    ),
  );
  const changes = diff(existing, incoming);
  if (!changes) return { action: 'skip', id: existing.id, message: 'Already in the catalogue.' };
  return { action: 'update', id: existing.id, changes };
}

export async function applyHardware(
  tx: Tx,
  record: HardwareRecord,
  plan: HardwarePlan,
  origin: Origin,
): Promise<string> {
  const table = TABLE[record.kind];
  if (plan.action === 'skip') return plan.id;
  if (plan.action === 'update') {
    await tx.update(table).set(plan.changes.after).where(eq(table.id, plan.id));
    await recordAudit(tx, origin.actor, {
      action: 'update',
      entityType: `hardware_${record.kind}`,
      entityId: plan.id,
      ...plan.changes,
    });
    return plan.id;
  }
  const [created] = await tx
    .insert(table)
    .values({
      // Validated by this kind's schema (hardwareItemSchemas), so the columns match its table;
      // TypeScript can't relate the union of tables to the union of schemas, hence the cast.
      ...(record.values as unknown as typeof hardwarePanels.$inferInsert),
      source: 'import',
    })
    .returning({ id: table.id });
  if (!created) throw new Error('Insert returned no row');
  await recordAudit(tx, origin.actor, {
    action: 'create',
    entityType: `hardware_${record.kind}`,
    entityId: created.id,
    after: record.values,
  });
  return created.id;
}
