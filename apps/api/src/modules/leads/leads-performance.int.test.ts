import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertFakeLeads } from '../../db/fake-leads.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';

const createCaller = createCallerFactory(appRouter);

// Step 2.2 "done when": 10,000 leads page and filter instantly. The budget is generous so the
// test stays reliable on a busy laptop; typical times are a few milliseconds per query.
const BUDGET_MS = 250;

describe('leads list with 10,000 leads', () => {
  const db = createTestDb();
  let api: ReturnType<typeof createCaller>;

  beforeAll(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    const { id } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    );
    await insertFakeLeads(db, 10_000);
    await db.execute('analyze leads');
    api = createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id, permissions: allPermissions() }),
          firebaseUid: 'uid',
        },
        { db },
      ),
    );
    await api.leads.list({}); // warm up the connection pool
  }, 60_000);
  afterAll(() => db.$client.end());

  async function timed<T>(run: () => Promise<T>): Promise<[T, number]> {
    const start = performance.now();
    const result = await run();
    return [result, performance.now() - start];
  }

  it.each([
    ['default page', {}],
    ['last page sorted by name', { page: 399, sort: { id: 'name' as const, desc: false } }],
    ['search by name', { search: 'olivia ngu' }],
    ['search by phone digits', { search: '0410 000 12' }],
    [
      'status + platform + state + date range',
      {
        statuses: ['New', 'Contacted'],
        platform: 'Meta',
        state: 'NSW' as const,
        dateFrom: '2026-01-01',
      },
    ],
    [
      'unassigned, sorted by status',
      { owner: 'none' as const, sort: { id: 'status' as const, desc: false } },
    ],
  ])('%s', async (_label, input) => {
    const [result, ms] = await timed(() => api.leads.list(input));
    expect(result.rows.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('counts per status', async () => {
    const [counts, ms] = await timed(() => api.leads.statusCounts({}));
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
