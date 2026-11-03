import { TRPCError } from '@trpc/server';
import { and, asc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from '../../db/client.ts';
import { hardwareBatteries, hardwareInverters, hardwarePanels } from '../../db/schema/index.ts';
import { protectedProcedure, router } from '../../trpc/trpc.ts';
import { containsPattern } from '../search.ts';

export const HARDWARE_KINDS = ['panel', 'inverter', 'battery'] as const;
export type HardwareKind = (typeof HARDWARE_KINDS)[number];

const TABLES = {
  panel: hardwarePanels,
  inverter: hardwareInverters,
  battery: hardwareBatteries,
} as const;

/** "440 W", "10 kW", "13.5 kWh" — the number that matters when choosing a model. */
function specOf(kind: HardwareKind): SQL<string> {
  switch (kind) {
    case 'panel':
      return sql<string>`trim(trailing '.' from trim(trailing '0' from ${hardwarePanels.sizeW}::text)) || ' W'`;
    case 'inverter':
      return sql<string>`trim(trailing '.' from trim(trailing '0' from ${hardwareInverters.sizeKw}::text)) || ' kW'`;
    case 'battery':
      return sql<string>`trim(trailing '.' from trim(trailing '0' from ${hardwareBatteries.usableCapacityKwh}::text)) || ' kWh'`;
  }
}

/** Catalog rows as picker options: { id, label: "Jinko Tiger Neo 440", spec: "440 W", archived }. */
export async function hardwareOptions(
  db: Db | Tx,
  kind: HardwareKind,
  where: SQL | undefined,
  limit = 30,
) {
  const table = TABLES[kind];
  const rows = await db
    .select({
      id: table.id,
      manufacturer: table.manufacturer,
      model: table.model,
      spec: specOf(kind),
      archivedAt: table.archivedAt,
    })
    .from(table)
    .where(where)
    .orderBy(asc(table.manufacturer), asc(table.model))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    label: `${row.manufacturer} ${row.model}`,
    spec: row.spec,
    archived: row.archivedAt !== null,
  }));
}

/** One catalog item as a picker option (archived ones too — old records keep them). */
export async function hardwareOption(
  db: Db | Tx,
  kind: HardwareKind,
  id: string | null | undefined,
) {
  if (!id) return null;
  const [option] = await hardwareOptions(db, kind, eq(TABLES[kind].id, id), 1);
  return option ?? null;
}

/** An active catalog item (or the one already on the record, even if since archived). */
export async function assertHardware(
  db: Db | Tx,
  kind: HardwareKind,
  id: string | null,
  current?: string | null,
) {
  if (id === null || id === current) return;
  const table = TABLES[kind];
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), isNull(table.archivedAt)));
  if (!row) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `That ${kind} is not in the catalog any more. Choose another.`,
    });
  }
}

export const hardwareRouter = router({
  /**
   * Search one catalog by manufacturer or model. Any signed-in user may search — the catalog
   * isn't sensitive and every quote needs it; managing it needs hardware permissions.
   */
  search: protectedProcedure
    .input(
      z.object({
        kind: z.enum(HARDWARE_KINDS),
        search: z.string().trim().max(100).default(''),
      }),
    )
    .query(({ ctx, input }) => {
      const table = TABLES[input.kind];
      const words = input.search.split(/\s+/).filter(Boolean);
      // Every word must match the manufacturer or model: "jinko 440" finds "Jinko … 440W".
      const matches = words.map((word) =>
        or(
          ilike(table.manufacturer, containsPattern(word)),
          ilike(table.model, containsPattern(word)),
        ),
      );
      return hardwareOptions(ctx.db, input.kind, and(isNull(table.archivedAt), ...matches));
    }),
});
