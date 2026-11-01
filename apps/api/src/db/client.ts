import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema/index.ts';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function createDb(connectionString: string) {
  return drizzle({ connection: { connectionString }, schema, casing: 'snake_case' });
}

export type Db = ReturnType<typeof createDb>;

/** A transaction handle — accepted wherever a Db is, so helpers can run inside one. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
