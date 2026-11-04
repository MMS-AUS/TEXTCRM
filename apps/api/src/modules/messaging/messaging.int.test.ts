import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix, type PermissionMatrix } from '@mms/shared';
import { createApp } from '../../app.ts';
import {
  activities,
  emailMessages,
  integrationConnections,
  smsMessages,
  users,
} from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { encryptJson } from '../../integrations/crypto.ts';
import type { Fetch } from '../../integrations/http.ts';
import { createIntegrations, type Integrations } from '../../integrations/service.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser, silentLogger } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';
import { webhookToken } from './service.ts';

const createCaller = createCallerFactory(appRouter);
const KEY = randomBytes(32);
const SECRET = 'webhook-secret-for-tests';

type Call = { method: string; url: string; body: string; headers: Headers };

function fakeProviders() {
  const calls: Call[] = [];
  const replies = new Map<string, (call: Call) => { status: number; body?: unknown }>();
  const fetchImpl: Fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const raw = init?.body;
    const call = {
      method: init?.method ?? 'GET',
      url,
      body: typeof raw === 'string' ? raw : raw instanceof URLSearchParams ? raw.toString() : '',
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    const match = [...replies.entries()].find(([key]) => `${call.method} ${url}`.startsWith(key));
    const reply = match ? match[1](call) : { status: 599, body: { error: 'no fake' } };
    return Promise.resolve(
      new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status,
      }),
    );
  };
  return {
    fetchImpl,
    calls,
    on: (key: string, reply: (call: Call) => { status: number; body?: unknown }) =>
      replies.set(key, reply),
  };
}

describe('SMS and email (Steps 5.3, 5.2)', () => {
  const db = createTestDb();
  let micky = '';
  let leadId = '';
  let contactId = '';
  let providers = fakeProviders();
  let integrations: Integrations;

  const config = {
    APP_URL: 'http://localhost:5173',
    TOKEN_ENCRYPTION_KEY: KEY.toString('base64'),
    GOOGLE_OAUTH_CLIENT_ID: 'g',
    GOOGLE_OAUTH_CLIENT_SECRET: 'g',
    GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/integrations/gmail/callback',
    MESSAGEMEDIA_API_KEY: 'mm-key-12345',
    MESSAGEMEDIA_API_SECRET: 'mm-secret-678',
    MESSAGEMEDIA_DEFAULT_SENDER: 'MakeMySolar',
    MESSAGEMEDIA_WEBHOOK_SECRET: SECRET,
    API_URL: 'https://crm.makemysolar.com.au',
  };

  function as(permissions: PermissionMatrix = allPermissions()) {
    return createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({
            id: micky,
            name: 'Micky',
            email: 'micky@makemysolar.com.au',
            permissions,
          }),
          firebaseUid: 'uid',
        },
        { db, integrations },
      ),
    );
  }

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: micky } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
    providers = fakeProviders();
    integrations = createIntegrations(config, providers.fetchImpl);
    ({ id: contactId } = await as().contacts.create({
      firstName: 'Jack',
      mobile: '0423 456 789',
      email: 'jack@example.com',
      type: 'Residential',
    }));
    ({ id: leadId } = await as().leads.create({
      values: { firstName: 'Olivia', mobile: '0412 345 678', email: 'olivia@example.com' },
    }));
    providers.on('POST https://api.messagemedia.com/v1/messages', () => ({
      status: 202,
      body: { messages: [{ message_id: 'mm-msg-1', status: 'queued' }] },
    }));
  });
  afterAll(() => db.$client.end());

  describe('sending SMS', () => {
    it('sends to the record’s mobile, logs it, puts it on the timeline, asks for delivery reports', async () => {
      const result = await as().messaging.sendSms({
        entityType: 'lead',
        entityId: leadId,
        content: 'Hi Olivia, your quote is ready.',
      });
      expect(result).toMatchObject({
        status: 'sent',
        to: '+61412345678',
        segments: 1,
        deliveryReports: true,
      });
      const call = providers.calls.at(-1);
      expect(call?.headers.get('authorization')).toBe(
        `Basic ${Buffer.from('mm-key-12345:mm-secret-678').toString('base64')}`,
      );
      const message = (JSON.parse(call?.body ?? '{}') as { messages: Record<string, unknown>[] })
        .messages[0];
      expect(message).toMatchObject({
        destination_number: '+61412345678',
        content: 'Hi Olivia, your quote is ready.',
        source_number: 'MakeMySolar',
        source_number_type: 'ALPHANUMERIC',
        delivery_report: true,
        callback_url: `https://crm.makemysolar.com.au/webhooks/messagemedia/delivery?token=${webhookToken(SECRET, 'delivery')}`,
      });
      const [row] = await db.select().from(smsMessages);
      expect(row).toMatchObject({
        direction: 'outbound',
        status: 'sent',
        providerMessageId: 'mm-msg-1',
        encoding: 'GSM-7',
        sentByUserId: micky,
      });
      const [activity] = await db.select().from(activities).where(eq(activities.type, 'sms'));
      expect(activity).toMatchObject({
        entityId: leadId,
        direction: 'outbound',
        subject: 'SMS to 0412 345 678',
        body: 'Hi Olivia, your quote is ready.',
      });
      expect(activity?.metadata).toEqual({ smsMessageId: row?.id });
    });

    it('uses the person’s own sender, a ticket’s customer, and skips delivery reports on localhost', async () => {
      await db.update(users).set({ smsSenderId: '+61400000001' }).where(eq(users.id, micky));
      integrations = createIntegrations(
        { ...config, API_URL: 'http://localhost:3000' },
        providers.fetchImpl,
      );
      const { id: ticketId } = await as().tickets.create({
        contactId,
        title: 'Inverter alarm',
        priority: 'High',
      });
      const result = await as().messaging.sendSms({
        entityType: 'ticket',
        entityId: ticketId,
        content: 'Technician booked 👍',
      });
      expect(result).toMatchObject({ to: '+61423456789', deliveryReports: false });
      const message = (
        JSON.parse(providers.calls.at(-1)?.body ?? '{}') as { messages: Record<string, unknown>[] }
      ).messages[0];
      expect(message).toMatchObject({
        source_number: '+61400000001',
        source_number_type: 'INTERNATIONAL',
      });
      expect(message).not.toHaveProperty('callback_url');
      expect((await db.select().from(smsMessages))[0]).toMatchObject({
        encoding: 'UCS-2',
        contactId,
      });
    });

    it('a refused send is logged as failed and the error is shown', async () => {
      providers.on('POST https://api.messagemedia.com/v1/messages', () => ({
        status: 400,
        body: { message: 'Invalid destination number' },
      }));
      await expect(
        as().messaging.sendSms({ entityType: 'contact', entityId: contactId, content: 'Hi' }),
      ).rejects.toThrow('Invalid destination number');
      expect((await db.select().from(smsMessages))[0]).toMatchObject({
        status: 'failed',
        error: "MessageMedia couldn't send the SMS: Invalid destination number.",
      });
    });

    it('explains what is missing, and needs edit on the record', async () => {
      integrations = createIntegrations(
        { ...config, MESSAGEMEDIA_API_KEY: undefined, MESSAGEMEDIA_API_SECRET: undefined },
        providers.fetchImpl,
      );
      await expect(
        as().messaging.sendSms({ entityType: 'lead', entityId: leadId, content: 'Hi' }),
      ).rejects.toThrow('SMS isn’t connected');
      const { id: noMobile } = await as().leads.create({
        values: { firstName: 'Ava', email: 'ava@example.com' },
      });
      await expect(
        as().messaging.sendSms({ entityType: 'lead', entityId: noMobile, content: 'Hi' }),
      ).rejects.toThrow('no mobile number');
      const viewer = emptyPermissionMatrix();
      viewer.leads.view = true;
      await expect(
        as(viewer).messaging.sendSms({ entityType: 'lead', entityId: leadId, content: 'Hi' }),
      ).rejects.toThrow('does not allow');
    });
  });

  describe('MessageMedia webhooks', () => {
    let server: Server;
    let base = '';
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    beforeEach(async () => {
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
      server = app.listen(0);
      await new Promise<void>((resolve) => server.once('listening', resolve));
      base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      await as().messaging.sendSms({
        entityType: 'lead',
        entityId: leadId,
        content: 'Your quote is ready',
      });
    });
    afterEach(() => {
      server.close();
    });

    it('refuses callbacks without the right token', async () => {
      expect(
        (
          await post('/webhooks/messagemedia/delivery', {
            message_id: 'mm-msg-1',
            status: 'delivered',
          })
        ).status,
      ).toBe(401);
      expect(
        (await post(`/webhooks/messagemedia/delivery?token=${webhookToken(SECRET, 'inbound')}`, {}))
          .status,
      ).toBe(401);
      expect((await db.select().from(smsMessages))[0]?.status).toBe('sent');
    });

    it('delivery reports move the status on, never back', async () => {
      const url = `/webhooks/messagemedia/delivery?token=${webhookToken(SECRET, 'delivery')}`;
      const response = await post(url, {
        delivery_report_id: 'dr-1',
        message_id: 'mm-msg-1',
        status: 'delivered',
        submitted_date: '2026-11-04T05:00:00.000Z',
        source_number: '+61412345678',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ updated: 1 });
      await post(url, { delivery_report_id: 'dr-0', message_id: 'mm-msg-1', status: 'enroute' }); // late, out of order
      const [row] = await db.select().from(smsMessages);
      expect(row).toMatchObject({ status: 'delivered', error: null });
      expect(row?.statusAt?.toISOString()).toBe('2026-11-04T05:00:00.000Z');
      expect(
        await (await post(url, { message_id: 'someone-elses', status: 'delivered' })).json(),
      ).toEqual({ updated: 0 });
    });

    it('replies attach to the record the SMS came from; retries are ignored', async () => {
      const url = `/webhooks/messagemedia/inbound?token=${webhookToken(SECRET, 'inbound')}`;
      const reply = {
        reply_id: 'rp-1',
        message_id: 'mm-msg-1',
        source_number: '+61412345678',
        destination_number: 'MakeMySolar',
        content: 'Yes please, call me',
        date_received: '2026-11-04T06:00:00.000Z',
      };
      expect(await (await post(url, reply)).json()).toEqual({ stored: 1 });
      expect(await (await post(url, reply)).json()).toEqual({ stored: 0 });
      const inbound = await db
        .select()
        .from(smsMessages)
        .where(eq(smsMessages.direction, 'inbound'));
      expect(inbound).toHaveLength(1);
      expect(inbound[0]).toMatchObject({
        entityType: 'lead',
        entityId: leadId,
        status: 'received',
        fromNumber: '+61412345678',
      });
      const timeline = await db.select().from(activities).where(eq(activities.entityId, leadId));
      expect(timeline.find((a) => a.direction === 'inbound')).toMatchObject({
        type: 'sms',
        subject: 'SMS from 0412 345 678',
        body: 'Yes please, call me',
      });
    });

    it('unprompted SMS are matched to a contact by phone, or kept unmatched', async () => {
      const url = `/webhooks/messagemedia/inbound?token=${webhookToken(SECRET, 'inbound')}`;
      await post(url, {
        reply_id: 'rp-2',
        source_number: '0423 456 789',
        content: 'Is my install still Friday?',
      });
      await post(url, { reply_id: 'rp-3', source_number: '+61499999999', content: 'Who is this?' });
      const inbound = await db
        .select()
        .from(smsMessages)
        .where(eq(smsMessages.direction, 'inbound'));
      expect(inbound.find((m) => m.providerReplyId === 'rp-2')).toMatchObject({
        entityType: 'contact',
        entityId: contactId,
      });
      expect(inbound.find((m) => m.providerReplyId === 'rp-3')).toMatchObject({
        entityType: null,
        entityId: null,
        activityId: null,
      });
    });
  });

  describe('sending email', () => {
    async function connectGmail(status = 'connected') {
      await db.insert(integrationConnections).values({
        provider: 'gmail',
        userId: micky,
        accountId: 'micky@makemysolar.com.au',
        accountName: 'micky@makemysolar.com.au',
        secrets: encryptJson(KEY, {
          accessToken: 'g-access',
          refreshToken: 'g-refresh',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          scopes: [],
        }),
        status,
      });
    }

    it('sends from the person’s own mailbox to the record’s email, logged and on the timeline', async () => {
      await connectGmail();
      providers.on('POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send', () => ({
        status: 200,
        body: { id: 'gm-1', threadId: 'th-1', labelIds: ['SENT'] },
      }));
      const result = await as().messaging.sendEmail({
        entityType: 'lead',
        entityId: leadId,
        subject: 'Your solar quote — 6.6 kW',
        body: 'Hi Olivia,\n\nYour quote is attached.\n\nMicky',
      });
      expect(result).toMatchObject({ to: ['olivia@example.com'], threadId: 'th-1' });
      const call = providers.calls.at(-1);
      expect(call?.headers.get('authorization')).toBe('Bearer g-access');
      const mime = Buffer.from(
        (JSON.parse(call?.body ?? '{}') as { raw: string }).raw,
        'base64url',
      ).toString('utf8');
      expect(mime).toContain('From: Micky <micky@makemysolar.com.au>');
      expect(mime).toContain('To: olivia@example.com');
      expect(mime).toContain(
        `Subject: =?UTF-8?B?${Buffer.from('Your solar quote — 6.6 kW').toString('base64')}?=`,
      );
      expect(mime).toContain('Content-Type: text/html');
      const [row] = await db.select().from(emailMessages);
      expect(row).toMatchObject({
        status: 'sent',
        gmailMessageId: 'gm-1',
        gmailThreadId: 'th-1',
        fromAddress: 'micky@makemysolar.com.au',
        toAddresses: ['olivia@example.com'],
      });
      const [activity] = await db.select().from(activities).where(eq(activities.type, 'email'));
      expect(activity).toMatchObject({ entityId: leadId, subject: 'Your solar quote — 6.6 kW' });
      const list = await as().messaging.emails({ entityType: 'lead', entityId: leadId });
      expect(list[0]).toMatchObject({
        subject: 'Your solar quote — 6.6 kW',
        status: 'sent',
        senderName: 'Micky',
      });
    });

    it('needs a connected mailbox; a revoked one is marked expired and the failure logged', async () => {
      await expect(
        as().messaging.sendEmail({
          entityType: 'contact',
          entityId: contactId,
          subject: 'Hi',
          body: 'Hi',
        }),
      ).rejects.toThrow('Connect your Gmail first');
      await connectGmail();
      providers.on('POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send', () => ({
        status: 401,
        body: { error: { message: 'Invalid Credentials' } },
      }));
      await expect(
        as().messaging.sendEmail({
          entityType: 'contact',
          entityId: contactId,
          subject: 'Hi',
          body: 'Hi',
        }),
      ).rejects.toThrow('refused the credentials');
      expect((await db.select().from(integrationConnections))[0]?.status).toBe('expired');
      expect((await db.select().from(emailMessages))[0]).toMatchObject({
        status: 'failed',
        activityId: null,
      });
      await expect(
        as().messaging.sendEmail({
          entityType: 'contact',
          entityId: contactId,
          subject: 'Hi',
          body: 'Hi',
        }),
      ).rejects.toThrow('has expired. Reconnect');
    });
  });
});
