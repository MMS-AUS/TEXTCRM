import { requireDatabaseUrl } from '../env.ts';
import { createDb, runMigrations } from './client.ts';

const db = createDb(requireDatabaseUrl('DATABASE_URL'));
try {
  await runMigrations(db);
  console.log('Migrations applied.');
} finally {
  await db.$client.end();
}
