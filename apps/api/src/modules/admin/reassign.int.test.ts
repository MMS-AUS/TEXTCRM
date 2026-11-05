import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { activities, auditLog, leads, users } from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';

const createCaller = createCallerFactory(appRouter);

describe('deactivation reassigns open leads (F-02)', () => {
  const db = createTestDb();
  let micky = ''; // the first admin: the primary admin
  let neivedha = ''; // a later admin
  let sam = ''; // a manager
  let priya = ''; // sales, reports to Sam
  let leadIds: Record<string, string> = {};

  const as = (id = micky) =>
    createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id, permissions: allPermissions() }),
          firebaseUid: 'uid',
        },
        { db },
      ),
    );

  async function addUser(email: string, name: string, roleKey: string) {
    return (await upsertUser(db, { email, name, roleKey }, 'makemysolar.com.au')).id;
  }

  async function lead(name: string, ownerUserId: string) {
    const { id } = await as().leads.create({
      values: { firstName: name, email: `${name.toLowerCase()}@example.com`, ownerUserId },
    });
    return id;
  }

  const ownerOf = async (id: string) =>
    (await db.select({ owner: leads.ownerUserId }).from(leads).where(eq(leads.id, id)))[0]?.owner;

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    micky = await addUser('micky@makemysolar.com.au', 'Micky', 'admin');
    neivedha = await addUser('neivedha@makemysolar.com.au', 'Neivedha', 'admin');
    sam = await addUser('sam@makemysolar.com.au', 'Sam', 'manager');
    priya = await addUser('priya@makemysolar.com.au', 'Priya', 'sales');
    // The primary admin is the longest-serving one: make the order explicit.
    await db
      .update(users)
      .set({ createdAt: new Date('2026-01-01') })
      .where(eq(users.id, micky));
    await as().admin.users.update({
      id: priya,
      values: {
        name: 'Priya',
        roleId: (await as().admin.users.list()).find((u) => u.id === priya)?.roleId ?? '',
        managerUserId: sam,
      },
    });
    leadIds = {
      open1: await lead('Olivia', priya),
      open2: await lead('Jack', priya),
      lost: await lead('Lena', priya),
      converted: await lead('Carl', priya),
      deleted: await lead('Dee', priya),
      samsOwn: await lead('Sara', sam),
    };
    await db
      .update(leads)
      .set({ status: 'Lost' })
      .where(eq(leads.id, leadIds.lost ?? ''));
    await db
      .update(leads)
      .set({ status: 'Converted to Project', convertedAt: new Date() })
      .where(eq(leads.id, leadIds.converted ?? ''));
    await db
      .update(leads)
      .set({ deletedAt: new Date() })
      .where(eq(leads.id, leadIds.deleted ?? ''));
  });
  afterAll(() => db.$client.end());

  it('moves open leads to the manager, with a timeline entry and audit on each', async () => {
    expect(await as().admin.users.deactivationPreview({ id: priya })).toEqual({
      openLeads: 2,
      to: { id: sam, name: 'Sam', reason: 'manager' },
    });
    const result = await as().admin.users.setActive({ id: priya, active: false });
    expect(result.reassigned).toEqual({ count: 2, to: 'Sam' });

    expect(await ownerOf(leadIds.open1 ?? '')).toBe(sam);
    expect(await ownerOf(leadIds.open2 ?? '')).toBe(sam);
    // Closed, converted and deleted leads keep their history as it was.
    for (const key of ['lost', 'converted', 'deleted']) {
      expect(await ownerOf(leadIds[key] ?? '')).toBe(priya);
    }
    const timeline = await db
      .select()
      .from(activities)
      .where(and(eq(activities.entityId, leadIds.open1 ?? ''), eq(activities.type, 'system')));
    expect(timeline.map((a) => a.subject)).toContain(
      'Reassigned from Priya to Sam due to deactivation',
    );
    expect(timeline.find((a) => a.subject?.startsWith('Reassigned'))).toMatchObject({
      authorUserId: micky,
      metadata: { reason: 'deactivation', fromUserId: priya, toUserId: sam, to: 'manager' },
    });
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'reassign'), eq(auditLog.entityType, 'lead')));
    expect(audits).toHaveLength(2);
    expect(audits[0]?.changes).toEqual({
      before: { ownerUserId: priya },
      after: { ownerUserId: sam },
    });

    // Reactivating doesn't move anything back.
    await as().admin.users.setActive({ id: priya, active: true });
    expect(await ownerOf(leadIds.open1 ?? '')).toBe(sam);
  });

  it('with no manager — or an inactive one — the primary admin takes them', async () => {
    // Sam leaves first: Sam has no manager, so Sam's lead goes to Micky (the first admin).
    const samGone = await as().admin.users.setActive({ id: sam, active: false });
    expect(samGone.reassigned).toEqual({ count: 1, to: 'Micky' });
    expect(await ownerOf(leadIds.samsOwn ?? '')).toBe(micky);
    // Priya's manager is now inactive: hers go to Micky too.
    expect((await as().admin.users.deactivationPreview({ id: priya })).to).toEqual({
      id: micky,
      name: 'Micky',
      reason: 'primary_admin',
    });
    await as().admin.users.setActive({ id: priya, active: false });
    expect(await ownerOf(leadIds.open1 ?? '')).toBe(micky);
  });

  it('when the primary admin is the one leaving, the next admin takes over', async () => {
    const lead1 = await lead('Ana', micky);
    const result = await as(neivedha).admin.users.setActive({ id: micky, active: false });
    expect(result.reassigned).toEqual({ count: 1, to: 'Neivedha' });
    expect(await ownerOf(lead1)).toBe(neivedha);
  });

  it('nothing to move: deactivation just happens', async () => {
    const result = await as().admin.users.setActive({ id: neivedha, active: false });
    expect(result.reassigned).toEqual({ count: 0, to: null });
  });

  it('is all or nothing: if reassigning fails, the user stays active and keeps their leads', async () => {
    await db.execute(sql`
      create or replace function fail_reassign() returns trigger language plpgsql as $$
      begin raise exception 'timeline unavailable'; end $$;
      create trigger fail_reassign before insert on activities
        for each row when (new.subject like 'Reassigned%') execute function fail_reassign();
    `);
    try {
      await expect(as().admin.users.setActive({ id: priya, active: false })).rejects.toThrow();
      const [row] = await db.select().from(users).where(eq(users.id, priya));
      expect(row).toMatchObject({ isActive: true, deactivatedAt: null });
      expect(await ownerOf(leadIds.open1 ?? '')).toBe(priya);
    } finally {
      await db.execute(sql`
        drop trigger if exists fail_reassign on activities;
        drop function if exists fail_reassign();
      `);
    }
  });

  it('a manager must be someone else who is active', async () => {
    const list = await as().admin.users.list();
    const priyaRow = list.find((u) => u.id === priya);
    expect(priyaRow).toMatchObject({ managerUserId: sam, managerName: 'Sam' });
    const values = { name: 'Priya', roleId: priyaRow?.roleId ?? '' };
    await expect(
      as().admin.users.update({ id: priya, values: { ...values, managerUserId: priya } }),
    ).rejects.toThrow('their own manager');
    await as().admin.users.setActive({ id: neivedha, active: false });
    await expect(
      as().admin.users.update({ id: priya, values: { ...values, managerUserId: neivedha } }),
    ).rejects.toThrow('active user');
    // Leaving the manager out keeps it; null clears it.
    await as().admin.users.update({ id: priya, values: { ...values, phone: '0400 000 000' } });
    expect((await as().admin.users.list()).find((u) => u.id === priya)?.managerUserId).toBe(sam);
    await as().admin.users.update({ id: priya, values: { ...values, managerUserId: null } });
    expect((await as().admin.users.list()).find((u) => u.id === priya)?.managerUserId).toBeNull();
  });
});
