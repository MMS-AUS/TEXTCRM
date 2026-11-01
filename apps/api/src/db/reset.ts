import { sql } from 'drizzle-orm';
import { requireDatabaseUrl } from '../env.ts';
import { createDb, runMigrations } from './client.ts';

// Dev only: wipes the local database and re-applies every migration. Run db:seed afterwards.

const url = requireDatabaseUrl('DATABASE_URL');
const host = new URL(url).hostname;

if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(
    `Refusing to reset: db:reset only runs against a local database (host was "${host}").`,
  );
  process.exit(1);
}

const db = createDb(url);
try {
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  console.log('Database reset and migrations applied. Run `npm run db:seed` next.');
} finally {
  await db.$client.end();
}
