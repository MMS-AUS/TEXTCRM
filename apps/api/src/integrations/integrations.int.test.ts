import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix, type PermissionMatrix } from '@mms/shared';
import { createApp } from '../app.ts';
import { auditLog, integrationConnections, integrationOAuthStates } from '../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../db/seed.ts';
import { createTestDb, truncateAll } from '../test/db.ts';
import { allPermissions, fakeContext, fakeUser, silentLogger } from '../test/fakes.ts';
import { appRouter } from '../trpc/router.ts';
import { createCallerFactory } from '../trpc/trpc.ts';
import { upsertUser } from '../users/upsert-user.ts';
import { decryptJson } from './crypto.ts';
import type { Fetch } from './http.ts';
import type { OAuthTokens } from './oauth.ts';
import { completeOAuth, createIntegrations, type Integrations } from './service.ts';

const createCaller = createCallerFactory(appRouter);
const KEY = randomBytes(32).toString('base64');

type Reply = { status: number; body?: unknown };
type Route = (request: {
  url: URL;
  method: string;
  body: string;
  headers: Headers;
}) => Reply | undefined;

/** A stand-in for the providers, answering like their APIs do, recording every call. */
function fakeProviders() {
  const calls: { method: string; url: string; body: string; headers: Headers }[] = [];
  const routes: Route[] = [];
  const fetchImpl: Fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? 'GET';
    const raw = init?.body;
    const body =
      raw instanceof URLSearchParams ? raw.toString() : typeof raw === 'string' ? raw : '';
    const headers = new Headers(init?.headers);
    calls.push({ method, url: url.href, body, headers });
    for (const route of [...routes].reverse()) {
      const reply = route({ url, method, body, headers });
      if (reply) {
        return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return Promise.resolve(new Response(JSON.stringify({ error: 'no fake' }), { status: 599 }));
  };
  const on = (
    method: string,
    match: string,
    reply: Reply | ((body: string, headers: Headers) => Reply),
  ) => {
    routes.push((req) =>
      req.method === method && `${req.url.origin}${req.url.pathname}`.includes(match)
        ? typeof reply === 'function'
          ? reply(req.body, req.headers)
          : reply
        : undefined,
    );
  };
  return { fetchImpl, calls, on };
}

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

describe('integrations backend (Phase 5)', () => {
  const db = createTestDb();
  let userId = '';
  let providers = fakeProviders();
  let integrations: Integrations;

  const config = {
    APP_URL: 'http://localhost:5173',
    TOKEN_ENCRYPTION_KEY: KEY,
    GOOGLE_OAUTH_CLIENT_ID: 'google-client',
    GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
    GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/integrations/gmail/callback',
    XERO_CLIENT_ID: 'xero-client',
    XERO_CLIENT_SECRET: 'xero-secret',
    XERO_REDIRECT_URI: 'http://localhost:3000/api/integrations/xero/callback',
  };

  function as(permissions: PermissionMatrix = allPermissions()) {
    return createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id: userId, email: 'micky@makemysolar.com.au', permissions }),
          firebaseUid: 'uid',
        },
        { db, integrations },
      ),
    );
  }

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: userId } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
    providers = fakeProviders();
    integrations = createIntegrations(config, providers.fetchImpl);
  });
  afterAll(() => db.$client.end());

  /** Starts OAuth through the API and returns the state the provider would send back. */
  async function begin(provider: 'gmail' | 'xero') {
    const { url } = await as().integrations.connect({ provider });
    const parsed = new URL(url);
    return { url: parsed, state: parsed.searchParams.get('state') ?? '' };
  }

  function googleAnswers(email = 'micky@makemysolar.com.au') {
    providers.on('POST', 'oauth2.googleapis.com/token', (body) =>
      new URLSearchParams(body).get('grant_type') === 'refresh_token'
        ? {
            status: 200,
            body: {
              access_token: 'g-access-2',
              expires_in: 3599,
              scope: 'openid email',
              token_type: 'Bearer',
            },
          }
        : {
            status: 200,
            body: {
              access_token: 'g-access-1',
              refresh_token: 'g-refresh-1',
              expires_in: 3599,
              scope:
                'openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
              token_type: 'Bearer',
            },
          },
    );
    providers.on('GET', 'gmail.googleapis.com/gmail/v1/users/me/profile', {
      status: 200,
      body: { emailAddress: email, messagesTotal: 1234, threadsTotal: 900, historyId: '1' },
    });
    providers.on('POST', 'oauth2.googleapis.com/revoke', { status: 200, body: {} });
  }

  describe('Gmail', () => {
    it('connects the user’s own mailbox: PKCE + state, encrypted tokens, audit', async () => {
      googleAnswers();
      const { url, state } = await begin('gmail');
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('scope')).toContain('gmail.send');
      expect(url.searchParams.get('login_hint')).toBe('micky@makemysolar.com.au');

      const location = await completeOAuth(db, integrations, 'gmail', { state, code: 'auth-code' });
      expect(location).toBe(
        'http://localhost:5173/settings/integrations?provider=gmail&result=connected',
      );
      const tokenCall = providers.calls.find((c) => c.url.includes('/token'));
      const sent = new URLSearchParams(tokenCall?.body);
      expect(sent.get('code')).toBe('auth-code');
      expect(sent.get('code_verifier')?.length).toBeGreaterThan(40);

      const [row] = await db.select().from(integrationConnections);
      expect(row).toMatchObject({
        provider: 'gmail',
        userId,
        accountName: 'micky@makemysolar.com.au',
        status: 'connected',
      });
      expect(row?.secrets).not.toContain('g-refresh-1');
      expect(
        decryptJson<OAuthTokens>(Buffer.from(KEY, 'base64'), row?.secrets ?? '').refreshToken,
      ).toBe('g-refresh-1');
      expect(await db.select().from(integrationOAuthStates)).toHaveLength(0); // single use
      const audits = await db.select().from(auditLog).where(eq(auditLog.entityType, 'integration'));
      expect(audits.map((a) => a.action)).toEqual(['connect']);

      const status = await as().integrations.status();
      expect(JSON.stringify(status)).not.toContain('g-access');
      expect(status.providers.find((p) => p.provider === 'gmail')?.connection).toMatchObject({
        status: 'connected',
        account: 'micky@makemysolar.com.au',
      });
    });

    it('refuses someone else’s mailbox, a reused state, and a cancelled sign-in', async () => {
      googleAnswers('personal@gmail.com');
      const first = await begin('gmail');
      const wrong = await completeOAuth(db, integrations, 'gmail', {
        state: first.state,
        code: 'c',
      });
      expect(new URL(wrong).searchParams.get('message')).toContain(
        'signed in to Google as personal@gmail.com',
      );
      expect(providers.calls.some((c) => c.url.includes('/revoke'))).toBe(true);
      expect(await db.select().from(integrationConnections)).toHaveLength(0);

      const reused = await completeOAuth(db, integrations, 'gmail', {
        state: first.state,
        code: 'c',
      });
      expect(new URL(reused).searchParams.get('message')).toContain('expired or was already used');

      const second = await begin('gmail');
      const cancelled = await completeOAuth(db, integrations, 'gmail', {
        state: second.state,
        error: 'access_denied',
      });
      expect(new URL(cancelled).searchParams.get('message')).toBe('The connection was cancelled.');
    });

    it('test connection refreshes an expired token; a revoked grant shows as expired', async () => {
      googleAnswers();
      const { state } = await begin('gmail');
      await completeOAuth(db, integrations, 'gmail', { state, code: 'c' });
      const keyBuf = Buffer.from(KEY, 'base64');
      const [row] = await db.select().from(integrationConnections);
      const stale = {
        ...decryptJson<OAuthTokens>(keyBuf, row?.secrets ?? ''),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };
      const { encryptJson } = await import('./crypto.ts');
      await db.update(integrationConnections).set({ secrets: encryptJson(keyBuf, stale) });

      const ok = await as().integrations.test({ provider: 'gmail' });
      expect(ok).toMatchObject({ ok: true, status: 'connected' });
      expect(ok.message).toContain('1,234 messages');
      const refreshed = decryptJson<OAuthTokens>(
        keyBuf,
        (await db.select().from(integrationConnections))[0]?.secrets ?? '',
      );
      expect(refreshed).toMatchObject({ accessToken: 'g-access-2', refreshToken: 'g-refresh-1' });

      await db.update(integrationConnections).set({ secrets: encryptJson(keyBuf, stale) });
      providers.on('POST', 'oauth2.googleapis.com/token', {
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
      });
      const bad = await as().integrations.test({ provider: 'gmail' });
      expect(bad).toMatchObject({ ok: false, status: 'expired' });
      expect(bad.message).toContain('Reconnect your mailbox');
      expect((await db.select().from(integrationConnections))[0]).toMatchObject({
        status: 'expired',
      });
    });

    it('disconnect revokes at Google and deletes the tokens', async () => {
      googleAnswers();
      const { state } = await begin('gmail');
      await completeOAuth(db, integrations, 'gmail', { state, code: 'c' });
      const result = await as().integrations.disconnect({ provider: 'gmail' });
      expect(result).toEqual({ disconnected: true, warning: null });
      const revoke = providers.calls.filter((c) => c.url.includes('/revoke')).at(-1);
      expect(new URLSearchParams(revoke?.body).get('token')).toBe('g-refresh-1');
      expect(await db.select().from(integrationConnections)).toHaveLength(0);
    });
  });

  describe('Xero', () => {
    function xeroAnswers(tenants: object[], authEvent = 'ev-1') {
      let refreshes = 0;
      providers.on('POST', 'identity.xero.com/connect/token', (body, headers) => {
        expect(headers.get('authorization')).toBe(
          `Basic ${Buffer.from('xero-client:xero-secret').toString('base64')}`,
        );
        const grant = new URLSearchParams(body).get('grant_type');
        if (grant === 'refresh_token') {
          refreshes += 1;
          return {
            status: 200,
            body: {
              access_token: jwt({ authentication_event_id: authEvent }),
              refresh_token: `x-refresh-${String(refreshes + 1)}`,
              expires_in: 1800,
            },
          };
        }
        return {
          status: 200,
          body: {
            access_token: jwt({ authentication_event_id: authEvent }),
            refresh_token: 'x-refresh-1',
            expires_in: 1800,
            scope: 'openid accounting.invoices accounting.payments',
          },
        };
      });
      providers.on('GET', 'api.xero.com/connections', { status: 200, body: tenants });
      providers.on('GET', 'api.xero.com/api.xro/2.0/Organisation', {
        status: 200,
        body: {
          Organisations: [
            { Name: 'Make My Solar Pty Ltd', CountryCode: 'AU', IsDemoCompany: false },
          ],
        },
      });
      providers.on('DELETE', 'api.xero.com/connections/', { status: 204 });
      providers.on('POST', 'identity.xero.com/connect/revocation', { status: 200 });
    }
    const tenant = (tenantId: string, name: string, authEventId = 'ev-1') => ({
      id: `conn-${tenantId}`,
      tenantId,
      tenantName: name,
      tenantType: 'ORGANISATION',
      authEventId,
    });

    it('connects the organisation; tokens rotate on refresh and the new one is kept', async () => {
      xeroAnswers([tenant('11111111-1111-4111-8111-111111111111', 'Make My Solar')]);
      const { url, state } = await begin('xero');
      expect(url.origin + url.pathname).toBe('https://login.xero.com/identity/connect/authorize');
      expect(url.searchParams.get('scope')).toContain('offline_access');
      const location = await completeOAuth(db, integrations, 'xero', { state, code: 'x-code' });
      expect(new URL(location).searchParams.get('result')).toBe('connected');
      const [row] = await db.select().from(integrationConnections);
      expect(row).toMatchObject({
        provider: 'xero',
        userId: null,
        accountName: 'Make My Solar Pty Ltd',
        status: 'connected',
      });

      const keyBuf = Buffer.from(KEY, 'base64');
      const { encryptJson } = await import('./crypto.ts');
      const stale = {
        ...decryptJson<OAuthTokens>(keyBuf, row?.secrets ?? ''),
        expiresAt: new Date(0).toISOString(),
      };
      await db.update(integrationConnections).set({ secrets: encryptJson(keyBuf, stale) });
      const ok = await as().integrations.test({ provider: 'xero' });
      expect(ok).toMatchObject({ ok: true, account: 'Make My Solar Pty Ltd' });
      const orgCall = providers.calls.find((c) => c.url.endsWith('/Organisation'));
      expect(orgCall?.headers.get('xero-tenant-id')).toBe('11111111-1111-4111-8111-111111111111');
      expect(
        decryptJson<OAuthTokens>(
          keyBuf,
          (await db.select().from(integrationConnections))[0]?.secrets ?? '',
        ).refreshToken,
      ).toBe('x-refresh-2');
    });

    it('asks which organisation when several were authorised', async () => {
      xeroAnswers([
        tenant('22222222-2222-4222-8222-222222222222', 'Demo Company (AU)'),
        tenant('33333333-3333-4333-8333-333333333333', 'Make My Solar'),
      ]);
      const { state } = await begin('xero');
      await completeOAuth(db, integrations, 'xero', { state, code: 'x-code' });
      const status = await as().integrations.status();
      const xero = status.providers.find((p) => p.provider === 'xero');
      expect(xero?.connection?.status).toBe('needs_tenant');
      expect(xero?.xeroChoices.map((c) => c.name)).toEqual(['Demo Company (AU)', 'Make My Solar']);
      expect((await as().integrations.test({ provider: 'xero' })).status).toBe('needs_tenant');
      await as().integrations.selectXeroTenant({
        tenantId: '33333333-3333-4333-8333-333333333333',
      });
      expect((await db.select().from(integrationConnections))[0]).toMatchObject({
        status: 'connected',
        accountId: '33333333-3333-4333-8333-333333333333',
      });
    });

    it('disconnect removes the organisation connection and revokes the refresh token', async () => {
      xeroAnswers([tenant('11111111-1111-4111-8111-111111111111', 'Make My Solar')]);
      const { state } = await begin('xero');
      await completeOAuth(db, integrations, 'xero', { state, code: 'x-code' });
      await as().integrations.disconnect({ provider: 'xero' });
      expect(
        providers.calls.some(
          (c) =>
            c.method === 'DELETE' &&
            c.url.endsWith('/connections/conn-11111111-1111-4111-8111-111111111111'),
        ),
      ).toBe(true);
      expect(providers.calls.some((c) => c.url.includes('/connect/revocation'))).toBe(true);
      expect(await db.select().from(integrationConnections)).toHaveLength(0);
    });

    it('organisation integrations need the integrations permission', async () => {
      const sales = emptyPermissionMatrix();
      sales.leads.view = true;
      await expect(as(sales).integrations.connect({ provider: 'xero' })).rejects.toThrow(
        'does not allow',
      );
      const mine = await as(sales).integrations.status();
      expect(mine.providers.map((p) => p.provider)).toEqual(['gmail']);
      expect(mine.mailboxes).toEqual([]);
    });
  });

  describe('MessageMedia', () => {
    const creds = {
      apiKey: 'mm-key-12345',
      apiSecret: 'mm-secret-67890',
      defaultSender: 'MakeMySolar',
    };

    it('checks credentials before saving them (read-only GET /v1/replies), stored encrypted', async () => {
      providers.on('GET', 'api.messagemedia.com/v1/replies', (_body, headers) =>
        headers.get('authorization') ===
        `Basic ${Buffer.from('mm-key-12345:mm-secret-67890').toString('base64')}`
          ? { status: 200, body: { replies: [{ reply_id: 'r1' }] } }
          : { status: 401, body: { message: 'Unauthorised' } },
      );
      await expect(
        as().integrations.saveMessageMediaCredentials({ ...creds, apiSecret: 'wrong-secret' }),
      ).rejects.toThrow('refused the API key or secret');
      expect(await db.select().from(integrationConnections)).toHaveLength(0);

      await as().integrations.saveMessageMediaCredentials(creds);
      const [row] = await db.select().from(integrationConnections);
      expect(row).toMatchObject({
        provider: 'messagemedia',
        accountId: 'mm-k…',
        accountName: 'MakeMySolar',
      });
      expect(row?.secrets).not.toContain('mm-secret');
      expect(providers.calls.every((c) => c.method === 'GET')).toBe(true); // nothing sent or confirmed

      const test = await as().integrations.test({ provider: 'messagemedia' });
      expect(test).toMatchObject({ ok: true, status: 'connected' });
      expect(test.message).toContain('1 unread reply waiting');
      await as().integrations.disconnect({ provider: 'messagemedia' });
      expect(await db.select().from(integrationConnections)).toHaveLength(0);
    });

    it('uses .env credentials when none are saved, and says when there are none', async () => {
      expect((await as().integrations.test({ provider: 'messagemedia' })).status).toBe(
        'not_connected',
      );
      integrations = createIntegrations(
        {
          ...config,
          MESSAGEMEDIA_API_KEY: 'env-key-123',
          MESSAGEMEDIA_API_SECRET: 'env-secret-456',
        },
        providers.fetchImpl,
      );
      providers.on('GET', 'api.messagemedia.com/v1/replies', {
        status: 200,
        body: { replies: [] },
      });
      const test = await as().integrations.test({ provider: 'messagemedia' });
      expect(test.message).toContain('from .env');
      expect(
        (await as().integrations.status()).providers.find((p) => p.provider === 'messagemedia')
          ?.credentialsFrom,
      ).toBe('env');
    });
  });

  it('explains a missing or invalid encryption key instead of connecting', async () => {
    integrations = createIntegrations(
      { ...config, TOKEN_ENCRYPTION_KEY: 'x' },
      providers.fetchImpl,
    );
    await expect(as().integrations.connect({ provider: 'gmail' })).rejects.toThrow(
      '32 random bytes',
    );
    const status = await as().integrations.status();
    expect(status.providers.find((p) => p.provider === 'xero')?.problem).toContain(
      'TOKEN_ENCRYPTION_KEY',
    );
  });

  it('the callback route redirects the browser back to the web app', async () => {
    googleAnswers();
    const { state } = await begin('gmail');
    const app = createApp({
      config: { APP_URL: 'http://localhost:5173', ALLOWED_EMAIL_DOMAIN: 'makemysolar.com.au' },
      db,
      logger: silentLogger,
      verifyIdToken: () => Promise.reject(new Error('unused')),
      storage: null,
      jobs: null,
      sheets: null,
      integrations,
    });
    const server: Server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(
        `http://127.0.0.1:${String(port)}/api/integrations/gmail/callback?state=${state}&code=c`,
        { redirect: 'manual' },
      );
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(
        'http://localhost:5173/settings/integrations?provider=gmail&result=connected',
      );
    } finally {
      server.close();
    }
  });
});
