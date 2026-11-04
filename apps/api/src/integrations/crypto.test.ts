import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptJson,
  decryptSecret,
  encryptJson,
  encryptSecret,
  parseEncryptionKey,
} from './crypto.ts';
import { jwtClaims, needsRefresh, pkce } from './oauth.ts';
import { tenantsFromThisSignIn, XERO_SCOPES } from './xero.ts';

const key = randomBytes(32);

describe('secret encryption', () => {
  it('round-trips, and every encryption is different', () => {
    const a = encryptSecret(key, 'refresh-token-123');
    const b = encryptSecret(key, 'refresh-token-123');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\./);
    expect(a).not.toContain('refresh-token-123');
    expect(decryptSecret(key, a)).toBe('refresh-token-123');
    expect(decryptJson<{ x: number }>(key, encryptJson(key, { x: 1 }))).toEqual({ x: 1 });
  });

  it('refuses tampered data and the wrong key', () => {
    const sealed = encryptSecret(key, 'secret');
    const parts = sealed.split('.');
    const flipped = [...parts.slice(0, 3), Buffer.from('other').toString('base64url')].join('.');
    expect(() => decryptSecret(key, flipped)).toThrow('TOKEN_ENCRYPTION_KEY has changed');
    expect(() => decryptSecret(randomBytes(32), sealed)).toThrow();
    expect(() => decryptSecret(key, 'plain text')).toThrow('unknown format');
  });

  it('accepts only a 32-byte base64 key, explaining how to make one', () => {
    expect(parseEncryptionKey(key.toString('base64'))).toMatchObject({ ok: true });
    const short = parseEncryptionKey('x');
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.problem).toContain('randomBytes(32)');
    expect(parseEncryptionKey(undefined)).toMatchObject({ ok: false });
  });
});

describe('OAuth helpers', () => {
  it('makes an S256 PKCE pair', () => {
    const { verifier, challenge } = pkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('refreshes two minutes before expiry', () => {
    const tokens = (inMs: number) => ({
      accessToken: 'a',
      refreshToken: 'r',
      scopes: [],
      expiresAt: new Date(Date.now() + inMs).toISOString(),
    });
    expect(needsRefresh(tokens(60_000))).toBe(true);
    expect(needsRefresh(tokens(600_000))).toBe(false);
  });

  it('picks the Xero organisations authorised in this sign-in', () => {
    const token = `x.${Buffer.from(JSON.stringify({ authentication_event_id: 'ev-2' })).toString('base64url')}.y`;
    expect(jwtClaims(token).authentication_event_id).toBe('ev-2');
    const tenant = (tenantId: string, authEventId: string, tenantType = 'ORGANISATION') => ({
      connectionId: `c-${tenantId}`,
      tenantId,
      tenantName: tenantId,
      tenantType,
      authEventId,
    });
    expect(
      tenantsFromThisSignIn(token, [
        tenant('old', 'ev-1'),
        tenant('new', 'ev-2'),
        tenant('practice', 'ev-2', 'PRACTICEMANAGER'),
      ]).map((t) => t.tenantId),
    ).toEqual(['new']);
  });
});

describe('Xero scopes', () => {
  it('uses the granular scopes (no retired accounting.transactions)', () => {
    expect(XERO_SCOPES).toEqual([
      'openid',
      'profile',
      'email',
      'offline_access',
      'accounting.invoices',
      'accounting.payments',
      'accounting.banktransactions',
      'accounting.contacts',
      'accounting.settings',
    ]);
  });
});
