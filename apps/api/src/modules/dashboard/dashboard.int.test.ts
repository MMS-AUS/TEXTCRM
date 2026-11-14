import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { businessToday, emptyPermissionMatrix, type PermissionMatrix } from '@mms/shared';
import {
  activities,
  contacts,
  leads,
  projectInstallation,
  projectPricing,
  projects,
  projectStcClaims,
  tickets,
} from '../../db/schema/index.ts';
import { insertFakeLeads } from '../../db/fake-leads.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';

const createCaller = createCallerFactory(appRouter);

const daysAgo = (n: number) => {
  const date = new Date(`${businessToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
};
/** The first day of the month `n` months before this one. */
const monthStart = (n: number) => {
  const date = new Date(`${businessToday().slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - n);
  return date.toISOString().slice(0, 10);
};

describe('dashboard (Step 2.9)', () => {
  const db = createTestDb();
  let micky = '';
  let simon = '';

  const as = (permissions: PermissionMatrix = allPermissions(), id = micky) =>
    createCaller(
      fakeContext(
        { status: 'authenticated', user: fakeUser({ id, permissions }), firebaseUid: 'uid' },
        { db },
      ),
    );

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: micky } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
    ({ id: simon } = await upsertUser(
      db,
      { email: 'simon@makemysolar.com.au', name: 'Simon', roleKey: 'sales' },
      'makemysolar.com.au',
    ));
  });
  afterAll(() => db.$client.end());

  async function seedData() {
    const lead = (overrides: Partial<typeof leads.$inferInsert>) => ({
      firstName: 'Test',
      status: 'New',
      leadDate: businessToday(),
      ...overrides,
    });
    await db.insert(leads).values([
      lead({ source: 'Meta', ownerUserId: simon }),
      lead({ source: 'Meta', status: 'Contacted', ownerUserId: simon }),
      lead({ source: 'Website', leadDate: daysAgo(3), status: 'Contacted' }),
      lead({
        source: 'Website',
        leadDate: daysAgo(20),
        status: 'Proposal Sent',
        ownerUserId: micky,
      }),
      lead({ source: 'Google Ads', leadDate: daysAgo(60), status: 'Lost' }),
      lead({
        source: 'Meta',
        leadDate: daysAgo(10),
        status: 'Converted to Project',
        ownerUserId: simon,
        convertedAt: new Date(),
      }),
      lead({ source: 'Meta', deletedAt: new Date() }), // never counted
    ]);

    const [contact] = await db
      .insert(contacts)
      .values({ firstName: 'Ava', type: 'Residential' })
      .returning();
    const project = (n: number, overrides: Partial<typeof projects.$inferInsert>) => ({
      projectNumber: `MMS-TEST-${String(n)}`,
      contactId: contact?.id ?? '',
      streetAddress: '1 Main St',
      suburb: 'Logan',
      state: 'QLD',
      ...overrides,
    });
    const rows = await db
      .insert(projects)
      .values([
        project(1, { stage: 'Install Scheduled', saleDate: monthStart(0) }),
        project(2, { stage: 'Install Scheduled', saleDate: monthStart(1) }),
        project(3, { stage: 'Completed', status: 'Completed', saleDate: monthStart(2) }),
        project(4, { status: 'Lost', saleDate: monthStart(0) }), // no revenue, no STC
      ])
      .returning({ id: projects.id });
    const [p1, p2, p3, p4] = rows.map((row) => row.id);
    await db.insert(projectPricing).values([
      { projectId: p1 ?? '', sellingPriceAud: '10000.00', contractValueAud: '12000.00' },
      { projectId: p2 ?? '', sellingPriceAud: '8000.00' },
      { projectId: p3 ?? '', sellingPriceAud: '5000.50' },
      { projectId: p4 ?? '', sellingPriceAud: '99999.00' },
    ]);
    await db.insert(projectInstallation).values([
      { projectId: p1 ?? '', bookingDate: businessToday() }, // scheduled this month
      { projectId: p3 ?? '', bookingDate: monthStart(0), completedDate: monthStart(0) },
    ]);
    await db.insert(projectStcClaims).values([
      {
        projectId: p3 ?? '',
        solarStcs: 45,
        solarStcsAmountAud: '1822.50',
        solarStcsReceivedDate: monthStart(0),
        batteryStcs: 10,
        batteryStcsAmountAud: '400.00',
      },
      { projectId: p1 ?? '', solarStcs: 20, solarStcsAmountAud: '800.00' },
      { projectId: p4 ?? '', solarStcs: 99, solarStcsAmountAud: '9999.00' },
    ]);

    const ticket = (n: number, overrides: Partial<typeof tickets.$inferInsert>) => ({
      ticketNumber: `TKT-TEST-${String(n)}`,
      contactId: contact?.id ?? '',
      title: 'Problem',
      ...overrides,
    });
    await db.insert(tickets).values([
      ticket(1, { priority: 'Urgent' }),
      ticket(2, { priority: 'High', createdAt: new Date(Date.now() - 10 * 86_400_000) }),
      ticket(3, { priority: 'High', createdAt: new Date(Date.now() - 45 * 86_400_000) }),
      ticket(4, { priority: 'Low', closedAt: new Date() }), // closed: not counted
    ]);

    const task = (dueAt: Date, overrides: Partial<typeof activities.$inferInsert> = {}) => ({
      entityType: 'lead' as const,
      entityId: p1 ?? '',
      type: 'task' as const,
      subject: 'Call back',
      assignedUserId: micky,
      dueAt,
      ...overrides,
    });
    await db.insert(activities).values([
      task(new Date(Date.now() - 3 * 86_400_000)), // overdue
      task(new Date(Date.now() + 30 * 86_400_000)), // later
      task(new Date(Date.now() - 86_400_000), { completedAt: new Date() }), // done
      task(new Date(Date.now() - 86_400_000), { assignedUserId: simon }), // someone else's
    ]);
  }

  it('matches hand counts of the seeded data', async () => {
    await seedData();
    const week = await as().dashboard.overview({ period: '7d' });

    expect(week.leads).toMatchObject({ total: 6, newToday: 2, newWeek: 3, newMonth: 5 });
    expect(week.leads?.bySource).toEqual([
      { label: 'Meta', count: 2 },
      { label: 'Website', count: 1 },
    ]);
    const funnel = Object.fromEntries((week.leads?.funnel ?? []).map((f) => [f.label, f.count]));
    expect(funnel).toEqual({
      New: 1,
      Contacted: 2,
      'Proposal Sent': 1,
      'Converted to Project': 1,
      Lost: 1,
    });
    // Pipeline order from the option list, not alphabetical.
    expect(week.leads?.funnel.map((f) => f.label)).toEqual([
      'New',
      'Contacted',
      'Proposal Sent',
      'Converted to Project',
      'Lost',
    ]);
    expect(week.leads?.conversions[0]).toEqual({ label: 'Simon', leads: 3, converted: 1 });

    const month = await as().dashboard.overview({ period: '30d' });
    expect(month.leads?.bySource).toEqual([
      { label: 'Meta', count: 3 },
      { label: 'Website', count: 2 },
    ]);
    expect((await as().dashboard.overview({ period: 'today' })).leads?.bySource).toEqual([
      { label: 'Meta', count: 2 },
    ]);

    expect(week.projects).toMatchObject({ active: 2, installsCompleted: 1, installsScheduled: 1 });
    expect(week.projects?.byStage.find((s) => s.label === 'Install Scheduled')?.count).toBe(2);
    expect(week.projects?.revenue.slice(-3)).toEqual([
      { month: monthStart(2).slice(0, 7), jobs: 1, revenueAud: '5000.50' },
      { month: monthStart(1).slice(0, 7), jobs: 1, revenueAud: '8000.00' },
      { month: monthStart(0).slice(0, 7), jobs: 1, revenueAud: '12000.00' }, // contract value wins
    ]);
    expect(week.projects?.revenue).toHaveLength(6);
    expect(week.projects?.stc).toEqual({
      receivedAud: '1822.50',
      outstandingAud: '1200.00',
      certificates: 75,
      jobs: 2,
    });

    expect(week.tickets).toEqual({
      open: 3,
      byPriority: [
        { label: 'Urgent', count: 1 },
        { label: 'High', count: 2 },
        { label: 'Medium', count: 0 },
        { label: 'Low', count: 0 },
      ],
      byAge: [
        { label: 'Under 7 days', key: 'week', count: 1 },
        { label: '7–30 days', key: 'month', count: 1 },
        { label: 'Over 30 days', key: 'older', count: 1 },
      ],
    });
    expect(week.tasks).toEqual({ overdue: 1, dueToday: 0, open: 2 });
  });

  it('only returns what the role can view', async () => {
    await seedData();
    const sales = emptyPermissionMatrix();
    sales.leads = { view: true, create: true, edit: true, delete: false, export: false };
    const view = await as(sales, simon).dashboard.overview({});
    expect(view.leads?.total).toBe(6);
    expect(view.projects).toBeNull();
    expect(view.tickets).toBeNull();
    expect(view.tasks).toEqual({ overdue: 1, dueToday: 0, open: 1 });
  });

  it('answers in well under 300 ms with 10,000 leads', async () => {
    await insertFakeLeads(db, 10_000);
    await db.execute('analyze');
    const api = as();
    await api.dashboard.overview({}); // warm up the pool
    const start = performance.now();
    await api.dashboard.overview({ period: '30d' });
    expect(performance.now() - start).toBeLessThan(300);
  }, 60_000);
});
