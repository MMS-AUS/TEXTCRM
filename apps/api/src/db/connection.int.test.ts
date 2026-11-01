import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../test/db.ts';

describe('database connection', () => {
  const db = createTestDb();
  afterAll(() => db.$client.end());

  it('connects to crm_test', async () => {
    const result = await db.execute<{ db: string }>(sql`select current_database() as db`);
    expect(result.rows[0]?.db).toBe('crm_test');
  });

  it('has the migrated core tables', async () => {
    const result = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const tables = result.rows.map((r) => r.tablename);
    for (const t of ['users', 'roles', 'contacts', 'leads', 'projects', 'tickets', 'audit_log']) {
      expect(tables).toContain(t);
    }
  });
});
