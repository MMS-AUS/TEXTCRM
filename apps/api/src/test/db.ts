import { sql } from 'drizzle-orm';
import { createDb, type Db } from '../db/client.ts';
import { requireDatabaseUrl } from '../env.ts';

export function createTestDb(): Db {
  return createDb(requireDatabaseUrl('DATABASE_URL_TEST'));
}

/** Empties every application table (migration history in the `drizzle` schema is kept). */
export async function truncateAll(db: Db): Promise<void> {
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (result.rows.length === 0) return;
  const tables = result.rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
}
