import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { optionLists, options } from '../db/schema/index.ts';

/** Active options of several lists, in display order: { contactTypes: [{ value, label }], … }. */
export async function activeOptions(db: Db, keys: readonly string[]) {
  const rows = await db
    .select({ key: optionLists.key, value: options.value, label: options.label })
    .from(options)
    .innerJoin(optionLists, eq(optionLists.id, options.listId))
    .where(and(inArray(optionLists.key, [...keys]), isNull(options.archivedAt)))
    .orderBy(asc(optionLists.key), asc(options.sortOrder), asc(options.label));

  const result: Record<string, { value: string; label: string }[]> = {};
  for (const key of keys) result[key] = [];
  for (const row of rows) result[row.key]?.push({ value: row.value, label: row.label });
  return result;
}

/**
 * Rejects a value that isn't an active option of `listKey`. An archived value stays valid on a
 * record that already has it (§1.6: archived options remain on old records).
 */
export async function assertOption(
  db: Db | Tx,
  listKey: string,
  value: string | null,
  field: string,
  current?: string | null,
): Promise<void> {
  if (value === null || value === current) return;
  const [match] = await db
    .select({ id: options.id })
    .from(options)
    .innerJoin(optionLists, eq(optionLists.id, options.listId))
    .where(and(eq(optionLists.key, listKey), eq(options.value, value), isNull(options.archivedAt)));
  if (!match) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `"${value}" is not an available ${field}. Pick one from the list.`,
    });
  }
}
