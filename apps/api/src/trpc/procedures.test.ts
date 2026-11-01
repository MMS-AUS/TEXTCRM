import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { allPermissions, fakeContext, fakeUser } from '../test/fakes.ts';
import { appRouter } from './router.ts';
import { createCallerFactory } from './trpc.ts';

const createCaller = createCallerFactory(appRouter);

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error.code;
    throw error;
  }
  return undefined;
}

describe('procedure guards', () => {
  it('health.ping is public', async () => {
    const caller = createCaller(fakeContext({ status: 'anonymous' }));
    expect(await caller.health.ping()).toEqual({ status: 'ok' });
  });

  it('protected procedures reject anonymous requests with UNAUTHORIZED', async () => {
    const caller = createCaller(fakeContext({ status: 'anonymous' }));
    expect(await errorCode(caller.auth.me())).toBe('UNAUTHORIZED');
  });

  it('protected procedures reject invalid tokens with UNAUTHORIZED', async () => {
    const caller = createCaller(fakeContext({ status: 'invalid' }));
    expect(await errorCode(caller.auth.me())).toBe('UNAUTHORIZED');
  });

  it('protected procedures end the session of a denied identity (e.g. deactivated mid-session)', async () => {
    const caller = createCaller(
      fakeContext({ status: 'denied', reason: 'inactive_user', email: 'x@y.z', userId: 'u' }),
    );
    await expect(caller.auth.me()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Your account does not have access to the CRM. Ask an admin to add you.',
    });
  });
  it('auth.me returns the profile for an authenticated user', async () => {
    const user = fakeUser({ permissions: allPermissions() });
    const caller = createCaller(fakeContext({ status: 'authenticated', user, firebaseUid: 'u' }));
    expect(await caller.auth.me()).toMatchObject({ id: user.id, role: { key: 'admin' } });
  });

  it('permission procedures reject a role without the permission (insufficient role)', async () => {
    const user = fakeUser({ role: { key: 'service', name: 'Service' } }); // no permissions at all
    const caller = createCaller(fakeContext({ status: 'authenticated', user, firebaseUid: 'u' }));
    expect(await errorCode(caller.optionLists.list())).toBe('FORBIDDEN');
  });
});
