import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix, type LeadInput, type PermissionMatrix } from '@mms/shared';
import { activities, auditLog, leads } from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';

const createCaller = createCallerFactory(appRouter);
const DOMAIN = 'makemysolar.com.au';

describe('leads', () => {
  const db = createTestDb();
  let micky = '';
  let simon = '';

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: micky } = await upsertUser(
      db,
      { email: `micky@${DOMAIN}`, name: 'Micky', roleKey: 'admin' },
      DOMAIN,
    ));
    ({ id: simon } = await upsertUser(
      db,
      { email: `simon@${DOMAIN}`, name: 'Simon', roleKey: 'sales' },
      DOMAIN,
    ));
  });
  afterAll(() => db.$client.end());

  function as(userId: string, permissions: PermissionMatrix = allPermissions()) {
    return createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id: userId, permissions }),
          firebaseUid: 'uid',
        },
        { db },
      ),
    );
  }

  const olivia: LeadInput = {
    firstName: 'Olivia',
    lastName: 'Nguyen',
    mobile: '0412 345 678',
    email: 'olivia@example.com',
    streetAddress: '12 Church Street',
    suburb: 'Parramatta',
    state: 'NSW',
    postcode: '2150',
    source: 'Meta',
  };

  async function timeline(leadId: string) {
    return (await as(micky).activities.list({ entityType: 'lead', entityId: leadId })).map(
      (a) => a.subject,
    );
  }

  it('creates a lead with derived area, a timeline entry and an audit row, linked to a known contact', async () => {
    const contact = await as(micky).contacts.create({
      firstName: 'Olivia',
      mobile: '+61412345678',
      type: 'Residential',
    });
    const { id } = await as(micky).leads.create({ values: olivia });
    const lead = await as(micky).leads.get({ id });
    expect(lead).toMatchObject({
      status: 'New',
      mobile: '+61412345678',
      area: 'Metro',
      nearestBigCity: 'Sydney',
      contactId: contact.id,
      contactName: 'Olivia',
      createdByName: 'Micky',
    });
    expect(lead.leadDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await timeline(id)).toEqual(['Lead created']);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(audit?.action).toBe('create');
  });

  it('refuses the same person at the same property, but allows a second property', async () => {
    const api = as(micky);
    await api.leads.create({ values: olivia });

    const sameHouse = api.leads.create({
      values: { firstName: 'Liv', mobile: '+61 412 345 678', streetAddress: '12 church st' },
    });
    await expect(sameHouse).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(sameHouse).rejects.toThrow(/Olivia Nguyen's existing lead \(same phone number\)/);

    const investment = {
      ...olivia,
      streetAddress: '3 Ruthven St',
      suburb: 'Toowoomba',
      state: 'QLD' as const,
      postcode: '4350',
    };
    expect((await api.leads.checkDuplicate({ values: investment })).duplicate).toBeNull();
    await api.leads.create({ values: investment });
    expect((await api.leads.list({})).total).toBe(2);
  });

  it('lets a confirmed namesake through, but never an email or phone match', async () => {
    const api = as(micky);
    await api.leads.create({ values: olivia });
    const namesake: LeadInput = {
      firstName: 'Olivia',
      lastName: 'Nguyen',
      email: 'other.olivia@example.com',
      streetAddress: '12 Church St',
      suburb: 'Parramatta',
    };
    const check = await api.leads.checkDuplicate({ values: namesake });
    expect(check.duplicate).toMatchObject({ matchedOn: 'name', name: 'Olivia Nguyen' });
    await expect(api.leads.create({ values: namesake })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await api.leads.create({ values: namesake, confirmNotDuplicate: true });
    await expect(
      api.leads.create({ values: { ...olivia, firstName: 'X' }, confirmNotDuplicate: true }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('keeps status and owner changes on the timeline, and guards the conversion status', async () => {
    const api = as(micky);
    const { id } = await api.leads.create({ values: olivia });
    await api.leads.setStatus({ id, status: 'Contacted' });
    await api.leads.assign({ id, ownerUserId: simon });
    await expect(api.leads.setStatus({ id, status: 'Converted to Project' })).rejects.toThrow(
      /Convert to project/,
    );
    await expect(api.leads.setStatus({ id, status: 'Maybe' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await timeline(id)).toEqual([
      'Assigned to Simon',
      'Status changed from New to Contacted',
      'Lead created',
    ]);
    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    expect(lead?.crmEditedAt).not.toBeNull();
  });

  it('filters, searches, sorts by pipeline order and counts per status', async () => {
    const api = as(micky);
    const a = await api.leads.create({ values: olivia });
    await api.leads.create({
      values: {
        firstName: 'Jack',
        email: 'jack@example.com',
        source: 'Google Ads',
        state: 'QLD',
        ownerUserId: micky,
        leadDate: '2026-01-15',
      },
    });
    await api.leads.create({
      values: { firstName: 'Grace', email: 'grace@example.com', status: 'Proposal Sent' },
    });
    await api.leads.setStatus({ id: a.id, status: 'Contacted' });

    const names = async (input: Parameters<typeof api.leads.list>[0]) =>
      (await api.leads.list(input)).rows.map((row) => row.firstName);

    expect(await names({ search: '0412 345' })).toEqual(['Olivia']);
    expect(await names({ search: 'parra' })).toEqual(['Olivia']);
    expect(await names({ search: '2150' })).toEqual(['Olivia']);
    expect(await names({ source: 'Google Ads' })).toEqual(['Jack']);
    expect(await names({ state: 'QLD' })).toEqual(['Jack']);
    expect(await names({ owner: 'me' })).toEqual(['Jack']);
    expect(await names({ owner: 'none', sort: { id: 'name', desc: false } })).toEqual([
      'Grace',
      'Olivia',
    ]);
    expect(await names({ dateTo: '2026-02-01' })).toEqual(['Jack']);
    expect(
      await names({ statuses: ['New', 'Contacted'], sort: { id: 'name', desc: false } }),
    ).toEqual(['Jack', 'Olivia']);
    expect(await names({ sort: { id: 'status', desc: false } })).toEqual([
      'Jack',
      'Olivia',
      'Grace',
    ]);

    expect(await api.leads.statusCounts({ statuses: ['New'] })).toEqual({
      New: 1,
      Contacted: 1,
      'Proposal Sent': 1,
    });
  });

  it('applies bulk actions, skipping what the rules refuse, and restores deleted leads', async () => {
    const api = as(micky);
    const one = await api.leads.create({ values: olivia });
    const two = await api.leads.create({
      values: { firstName: 'Jack', email: 'jack@example.com' },
    });

    expect(await api.leads.bulkAssign({ ids: [one.id, two.id], ownerUserId: simon })).toEqual({
      updated: 2,
      skipped: [],
    });
    const statusResult = await api.leads.bulkSetStatus({
      ids: [one.id, two.id],
      status: 'Converted to Project',
    });
    expect(statusResult.updated).toBe(0);
    expect(statusResult.skipped).toHaveLength(2);

    await api.leads.bulkDelete({ ids: [one.id] });
    expect((await api.leads.list({})).total).toBe(1);
    expect((await api.leads.list({ deleted: true })).rows.map((r) => r.id)).toEqual([one.id]);
    await expect(api.leads.setStatus({ id: one.id, status: 'Contacted' })).rejects.toThrow(
      /deleted/,
    );
    await api.leads.restore({ id: one.id });
    expect((await api.leads.list({})).total).toBe(2);
  });

  it('enforces permissions', async () => {
    const salesLike = emptyPermissionMatrix();
    salesLike.leads = { view: true, create: true, edit: true, delete: false, export: false };
    const { id } = await as(micky).leads.create({ values: olivia });
    await expect(as(simon, salesLike).leads.remove({ id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      as(simon, emptyPermissionMatrix()).activities.list({ entityType: 'lead', entityId: id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('activities', () => {
  const db = createTestDb();
  let micky = '';

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: micky } = await upsertUser(
      db,
      { email: `micky@${DOMAIN}`, name: 'Micky', roleKey: 'admin' },
      DOMAIN,
    ));
  });
  afterAll(() => db.$client.end());

  const api = () =>
    createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id: micky, permissions: allPermissions() }),
          firebaseUid: 'uid',
        },
        { db },
      ),
    );

  it('logs notes, calls and tasks, completes tasks and lists my tasks due', async () => {
    const { id } = await api().leads.create({
      values: { firstName: 'Olivia', email: 'o@example.com' },
    });
    const entity = { entityType: 'lead' as const, entityId: id };
    await api().activities.create({ ...entity, type: 'note', body: 'Wants a battery quote.' });
    await api().activities.create({
      ...entity,
      type: 'call',
      outcome: 'No answer',
      durationMinutes: 0,
    });
    const task = await api().activities.create({
      ...entity,
      type: 'task',
      subject: 'Call back',
      dueAt: new Date(Date.now() - 3600_000).toISOString(),
    });

    const list = await api().activities.list(entity);
    expect(list.map((a) => a.type)).toEqual(['task', 'call', 'note', 'system']);
    expect(list[0]).toMatchObject({ assigneeName: 'Micky', authorName: 'Micky' });

    const due = await api().activities.myTasks({ before: new Date().toISOString() });
    expect(due).toMatchObject([{ id: task.id, subject: 'Call back', entityName: 'Olivia' }]);

    await api().activities.setCompleted({ id: task.id, completed: true });
    expect(await api().activities.myTasks({ before: new Date().toISOString() })).toEqual([]);
  });

  it('removes your own entries (audited) but never system ones, and checks the record exists', async () => {
    const { id } = await api().leads.create({
      values: { firstName: 'Olivia', email: 'o@example.com' },
    });
    const entity = { entityType: 'lead' as const, entityId: id };
    const note = await api().activities.create({ ...entity, type: 'note', body: 'Typo' });
    await api().activities.remove({ id: note.id });
    const [system] = await db
      .select()
      .from(activities)
      .where(and(eq(activities.entityId, id), eq(activities.type, 'system')));
    if (!system) throw new Error('missing system activity');
    await expect(api().activities.remove({ id: system.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect((await api().activities.list(entity)).map((a) => a.type)).toEqual(['system']);
    const removals = await db.select().from(auditLog).where(eq(auditLog.action, 'activity_remove'));
    expect(removals).toHaveLength(1);

    await expect(
      api().activities.create({
        entityType: 'lead',
        entityId: '00000000-0000-4000-8000-000000000999',
        type: 'note',
        body: 'x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
