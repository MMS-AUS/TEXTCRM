import { describe, expect, it, vi } from 'vitest';
import { fakeToken, fakeUser } from '../test/fakes.ts';
import { authenticate, parseBearerToken, type AuthenticateDeps } from './authenticate.ts';
import type { AuthUser, VerifiedToken } from './types.ts';

function deps(
  token: VerifiedToken | Error,
  user: AuthUser | null = fakeUser(),
): AuthenticateDeps & { findUserByEmail: ReturnType<typeof vi.fn> } {
  return {
    verifyIdToken: () => (token instanceof Error ? Promise.reject(token) : Promise.resolve(token)),
    findUserByEmail: vi.fn(() => Promise.resolve(user)),
    allowedEmailDomain: 'makemysolar.com.au',
  };
}

describe('parseBearerToken', () => {
  it('handles missing, malformed and valid headers', () => {
    expect(parseBearerToken(undefined)).toEqual({ kind: 'none' });
    expect(parseBearerToken('')).toEqual({ kind: 'none' });
    expect(parseBearerToken('Basic abc')).toEqual({ kind: 'malformed' });
    expect(parseBearerToken('Bearer a.b.c')).toEqual({ kind: 'token', token: 'a.b.c' });
  });
});

describe('authenticate', () => {
  it('no token → anonymous', async () => {
    expect(await authenticate(undefined, deps(fakeToken()))).toEqual({ status: 'anonymous' });
  });

  it('malformed header → invalid', async () => {
    expect(await authenticate('Token xyz', deps(fakeToken()))).toEqual({ status: 'invalid' });
  });

  it('bad / expired / revoked token → invalid', async () => {
    const d = deps(new Error('auth/id-token-expired'));
    expect(await authenticate('Bearer x.y.z', d)).toEqual({ status: 'invalid' });
    expect(d.findUserByEmail).not.toHaveBeenCalled();
  });

  it('non-Google sign-in → denied', async () => {
    const state = await authenticate('Bearer t', deps(fakeToken({ signInProvider: 'password' })));
    expect(state).toMatchObject({ status: 'denied', reason: 'not_google' });
  });

  it('unverified email → denied', async () => {
    const state = await authenticate('Bearer t', deps(fakeToken({ emailVerified: false })));
    expect(state).toMatchObject({ status: 'denied', reason: 'email_not_verified' });
  });

  it('wrong domain → denied without touching the database', async () => {
    const d = deps(fakeToken({ email: 'sam@gmail.com' }));
    expect(await authenticate('Bearer t', d)).toMatchObject({
      status: 'denied',
      reason: 'wrong_domain',
      email: 'sam@gmail.com',
    });
    expect(d.findUserByEmail).not.toHaveBeenCalled();
  });

  it('look-alike domain → denied', async () => {
    const state = await authenticate(
      'Bearer t',
      deps(fakeToken({ email: 'sam@evilmakemysolar.com.au' })),
    );
    expect(state).toMatchObject({ status: 'denied', reason: 'wrong_domain' });
  });

  it('unknown user → denied', async () => {
    const state = await authenticate('Bearer t', deps(fakeToken(), null));
    expect(state).toMatchObject({ status: 'denied', reason: 'unknown_user' });
  });

  it('deactivated user → denied', async () => {
    const user = fakeUser({ isActive: false });
    const state = await authenticate('Bearer t', deps(fakeToken(), user));
    expect(state).toMatchObject({ status: 'denied', reason: 'inactive_user', userId: user.id });
  });

  it('allowlisted active user → authenticated, matching email case-insensitively', async () => {
    const d = deps(fakeToken({ email: 'Sam@MakeMySolar.com.au' }));
    const state = await authenticate('Bearer t', d);
    expect(state).toMatchObject({ status: 'authenticated', firebaseUid: 'firebase-uid-1' });
    expect(d.findUserByEmail).toHaveBeenCalledWith('sam@makemysolar.com.au');
  });
});
