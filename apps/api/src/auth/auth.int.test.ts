import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, users } from '../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../db/seed.ts';
import { createTestDb, truncateAll } from '../test/db.ts';
import { fakeContext } from '../test/fakes.ts';
import { appRouter } from '../trpc/router.ts';
import { createCallerFactory } from '../trpc/trpc.ts';
import { upsertUser } from '../users/upsert-user.ts';
import { authenticate } from './authenticate.ts';
import type { VerifiedToken } from './types.ts';
import { findUserForAuth } from './users-repo.ts';

const DOMAIN = 'makemysolar.com.au';
const createCaller = createCallerFactory(appRouter);

describe('auth against the database', () => {
  const db = createTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
  });
  afterAll(() => db.$client.end());

  function signInAs(token: VerifiedToken) {
    return authenticate('Bearer t', {
      verifyIdToken: () => Promise.resolve(token),
      findUserByEmail: (email) => findUserForAuth(db, email),
      allowedEmailDomain: DOMAIN,
    });
  }

  const token = (email: string): VerifiedToken => ({
    uid: 'uid-1',
    email,
    emailVerified: true,
    signInProvider: 'google.com',
  });

  it('loads the role and permission matrix for an allowlisted user', async () => {
    await upsertUser(
      db,
      { email: 'Sales@MakeMySolar.com.au', name: 'S', roleKey: 'sales' },
      DOMAIN,
    );
    const user = await findUserForAuth(db, 'sales@makemysolar.com.au');
    expect(user?.role.key).toBe('sales');
    expect(user?.permissions.leads).toMatchObject({ view: true, delete: false });
    expect(user?.permissions.integrations.view).toBe(false);
  });

  it('signIn records last sign-in, the Firebase UID and an audit entry', async () => {
    const { id } = await upsertUser(
      db,
      { email: 'admin@makemysolar.com.au', name: 'A', roleKey: 'admin' },
      DOMAIN,
    );
    const auth = await signInAs(token('admin@makemysolar.com.au'));
    const profile = await createCaller(fakeContext(auth, { db })).auth.signIn();

    expect(profile.role.key).toBe('admin');
    const [row] = await db.select().from(users).where(eq(users.id, id));
    expect(row?.firebaseUid).toBe('uid-1');
    expect(row?.lastSignInAt).toBeInstanceOf(Date);
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'sign_in'), eq(auditLog.actorUserId, id)));
    expect(audits).toHaveLength(1);
  });

  it('signIn by an unknown Workspace user is refused and audited', async () => {
    const auth = await signInAs(token('stranger@makemysolar.com.au'));
    await expect(createCaller(fakeContext(auth, { db })).auth.signIn()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'sign_in_denied'));
    expect(audit?.changes).toEqual({
      after: { email: 'stranger@makemysolar.com.au', reason: 'unknown_user' },
    });
  });

  it('a deactivated user is refused', async () => {
    const { id } = await upsertUser(
      db,
      { email: 'gone@makemysolar.com.au', name: 'G', roleKey: 'sales' },
      DOMAIN,
    );
    await db.update(users).set({ isActive: false }).where(eq(users.id, id));
    expect(await signInAs(token('gone@makemysolar.com.au'))).toMatchObject({
      status: 'denied',
      reason: 'inactive_user',
    });
  });

  it('upsertUser re-activates an existing user and rejects other domains', async () => {
    const email = 'ops@makemysolar.com.au';
    const first = await upsertUser(db, { email, name: 'O', roleKey: 'operations' }, DOMAIN);
    await db.update(users).set({ isActive: false }).where(eq(users.id, first.id));
    const second = await upsertUser(db, { email, name: 'Ops', roleKey: 'manager' }, DOMAIN);

    expect(second).toEqual({ id: first.id, created: false });
    const user = await findUserForAuth(db, email);
    expect(user).toMatchObject({ isActive: true, name: 'Ops', role: { key: 'manager' } });

    await expect(
      upsertUser(db, { email: 'x@gmail.com', name: 'X', roleKey: 'admin' }, DOMAIN),
    ).rejects.toThrow('Only @makemysolar.com.au');
  });
});
