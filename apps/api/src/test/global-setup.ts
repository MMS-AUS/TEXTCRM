import { createDb, runMigrations } from '../db/client.ts';
import { requireDatabaseUrl } from '../env.ts';

/** Brings crm_test up to the latest migration once per integration-test run. */
export default async function setup() {
  const db = createDb(requireDatabaseUrl('DATABASE_URL_TEST'));
  try {
    await runMigrations(db);
  } finally {
    await db.$client.end();
  }
}
