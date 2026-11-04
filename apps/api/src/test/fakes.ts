import { pino } from 'pino';
import { emptyPermissionMatrix, type PermissionMatrix } from '@mms/shared';
import type { AuthState, AuthUser, VerifiedToken } from '../auth/types.ts';
import { createDb } from '../db/client.ts';
import type { Context } from '../trpc/context.ts';

/** A Db that is never connected: pg connects lazily, so this only fails if a query actually runs. */
export const unconnectedDb = createDb('postgres://unused@127.0.0.1:1/unused');

export const silentLogger = pino({ level: 'silent' });

export function fakeToken(overrides: Partial<VerifiedToken> = {}): VerifiedToken {
  return {
    uid: 'firebase-uid-1',
    email: 'sam@makemysolar.com.au',
    emailVerified: true,
    signInProvider: 'google.com',
    ...overrides,
  };
}

export function fakeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'sam@makemysolar.com.au',
    name: 'Sam',
    isActive: true,
    role: { key: 'admin', name: 'Admin' },
    permissions: emptyPermissionMatrix(),
    ...overrides,
  };
}

export function allPermissions(): PermissionMatrix {
  const m = emptyPermissionMatrix();
  for (const p of Object.values(m)) {
    p.view = p.create = p.edit = p.delete = p.export = true;
  }
  return m;
}

export function fakeContext(auth: AuthState, overrides: Partial<Context> = {}): Context {
  return {
    db: unconnectedDb,
    storage: null,
    jobs: null,
    sheets: null,
    syncIntervalMinutes: 5,
    sessions: null,
    allowedEmailDomain: 'makemysolar.com.au',
    log: silentLogger,
    auth,
    meta: { requestId: 'test-request', ipAddress: '127.0.0.1', userAgent: 'vitest' },
    ...overrides,
  };
}
