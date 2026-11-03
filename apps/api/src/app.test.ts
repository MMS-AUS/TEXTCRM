import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@mms/shared';
import { createApp } from './app.ts';
import { silentLogger, unconnectedDb } from './test/fakes.ts';

describe('HTTP app', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp({
      config: { APP_URL: 'http://localhost:5173', ALLOWED_EMAIL_DOMAIN: 'makemysolar.com.au' },
      db: unconnectedDb,
      logger: silentLogger,
      verifyIdToken: () => Promise.reject(new Error('invalid token')),
      storage: null,
      jobs: null,
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it('GET /api/health returns ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(await res.json())).toEqual({ status: 'ok' });
  });

  it('serves the tRPC health.ping procedure', async () => {
    const res = await fetch(`${baseUrl}/api/trpc/health.ping`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { data: { status: 'ok' } } });
  });

  it('sets security headers and hides Express', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('only allows the web app origin for CORS', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('echoes a valid incoming request ID and mints one otherwise', async () => {
    const echoed = await fetch(`${baseUrl}/api/health`, { headers: { 'x-request-id': 'abc-123' } });
    expect(echoed.headers.get('x-request-id')).toBe('abc-123');
    const minted = await fetch(`${baseUrl}/api/health`, {
      headers: { 'x-request-id': 'bad id!' },
    });
    expect(minted.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects protected procedures without a token (401)', async () => {
    const res = await fetch(`${baseUrl}/api/trpc/auth.me`);
    expect(res.status).toBe(401);
  });

  it('rejects protected procedures with a bad token (401)', async () => {
    const res = await fetch(`${baseUrl}/api/trpc/auth.me`, {
      headers: { authorization: 'Bearer not.a.token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns JSON 404s without stack traces', async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('Not Found');
    expect(JSON.stringify(body)).not.toContain('at ');
  });

  it('rejects oversized request bodies (413)', async () => {
    const res = await fetch(`${baseUrl}/api/trpc/auth.signIn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(1_100_000) }),
    });
    expect(res.status).toBe(413);
  });
});
