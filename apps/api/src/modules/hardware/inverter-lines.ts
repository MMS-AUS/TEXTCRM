import { inArray } from 'drizzle-orm';
import { inverterCapacityKw, type SystemInverterValues } from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import { hardwareInverters } from '../../db/schema/index.ts';
import { assertHardware, hardwareOption } from './router.ts';

/**
 * Checks the inverter lines of a system (leads and projects use the same rules) and returns their
 * total capacity in kW, or null when there are none. Each line must be a catalog model; an
 * archived model is accepted when the record already uses it.
 */
export async function checkInverterLines(
  tx: Tx,
  lines: readonly SystemInverterValues[],
  alreadyUsed: ReadonlySet<string>,
): Promise<string | null> {
  if (lines.length === 0) return null;
  for (const line of lines) {
    await assertHardware(
      tx,
      'inverter',
      line.inverterId,
      alreadyUsed.has(line.inverterId) ? line.inverterId : null,
    );
  }
  const sizes = await tx
    .select({ id: hardwareInverters.id, sizeKw: hardwareInverters.sizeKw })
    .from(hardwareInverters)
    .where(
      inArray(
        hardwareInverters.id,
        lines.map((line) => line.inverterId),
      ),
    );
  const sizeOf = new Map(sizes.map((row) => [row.id, row.sizeKw]));
  return inverterCapacityKw(
    lines.map((line) => ({ sizeKw: sizeOf.get(line.inverterId) ?? 0, count: line.count })),
  );
}

/** Stored inverter lines with each model's catalog label, in position order. */
export async function withInverterLabels(
  db: Db | Tx,
  rows: readonly { inverterId: string; count: number; type: string }[],
) {
  return Promise.all(
    rows.map(async (row) => ({
      inverterId: row.inverterId,
      count: row.count,
      type: row.type as 'grid' | 'hybrid',
      inverter: await hardwareOption(db, 'inverter', row.inverterId),
    })),
  );
}
