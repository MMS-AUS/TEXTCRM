import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.ts';
import {
  activities,
  emailMessages,
  gmailSyncState,
  integrationConnections,
  users,
} from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { encryptJson } from '../../integrations/crypto.ts';
import type { Fetch } from '../../integrations/http.ts';
import { pushVerifier } from '../../integrations/pubsub.ts';
import { createIntegrations, type Integrations } from '../../integrations/service.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser, silentLogger } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';
import { syncAllMailboxes, syncMailbox } from './inbox.ts';

const createCaller = createCallerFactory(appRouter);
const KEY = randomBytes(32);
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const AUDIENCE = 'https://crm.makemysolar.com.au/webhooks/gmail';
const PUSH_ACCOUNT = 'gmail-push@mms-crm.iam.gserviceaccount.com';

type Call = { method: string; url: string; body: string };
type Reply = (call: Call) => { status: number; body?: unknown };

function fakeGoogle() {
  const calls: Call[] = [];
  const replies = new Map<string, Reply>();
  const fetchImpl: Fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call = {
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? init.body : '',
    };
    calls.push(call);
    // The longest matching key wins, so "…/messages/m1" beats "…/messages".
    const match = [...replies.entries()]
      .filter(([key]) => `${call.method} ${url}`.startsWith(key))
      .sort((a, b) => b[0].length - a[0].length)[0];
    const reply = match ? match[1](call) : { status: 599, body: { error: 'no fake' } };
    return Promise.resolve(
      new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status,
      }),
    );
  };
  return { fetchImpl, calls, on: (key: string, reply: Reply) => replies.set(key, reply) };
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

function gmailMessage(
  id: string,
  options: {
    from: string;
    subject?: string;
    threadId?: string;
    html?: string;
    text?: string;
    inReplyTo?: string;
    labels?: string[];
    to?: string;
    cc?: string;
    bcc?: string;
    /** The Message-ID header (defaults to one made from the id). */
    messageId?: string;
  },
) {
  return {
    id,
    threadId: options.threadId ?? `th-${id}`,
    labelIds: options.labels ?? ['INBOX', 'UNREAD'],
    internalDate: String(Date.now() + 1000),
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: options.from },
        { name: 'To', value: options.to ?? 'Micky <micky@makemysolar.com.au>' },
        ...(options.cc ? [{ name: 'Cc', value: options.cc }] : []),
        ...(options.bcc ? [{ name: 'Bcc', value: options.bcc }] : []),
        { name: 'Subject', value: options.subject ?? 'Re: Your solar quote' },
        { name: 'Message-ID', value: options.messageId ?? `<${id}@mail.gmail.com>` },
        ...(options.inReplyTo ? [{ name: 'In-Reply-To', value: options.inReplyTo }] : []),
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            ...(options.text !== undefined
              ? [{ mimeType: 'text/plain', body: { data: b64(options.text) } }]
              : []),
            ...(options.html !== undefined
              ? [
                  {
                    mimeType: 'text/html',
                    headers: [{ name: 'Content-Type', value: 'text/html; charset="UTF-8"' }],
                    body: { data: b64(options.html) },
                  },
                ]
              : []),
          ],
        },
        { mimeType: 'application/pdf', filename: 'bill.pdf', body: { attachmentId: 'a1' } },
      ],
    },
  };
}

describe('Gmail inbox sync (Step 5.2)', () => {
  const db = createTestDb();
  let micky = '';
  let leadId = '';
  let contactId = '';
  let connectionId = '';
  let google = fakeGoogle();
  let integrations: Integrations;
  let inbox: Record<string, ReturnType<typeof gmailMessage>> = {};
  let history: { messageIds: string[]; historyId: string } | 'expired' = {
    messageIds: [],
    historyId: '200',
  };

  const config = {
    APP_URL: 'http://localhost:5173',
    TOKEN_ENCRYPTION_KEY: KEY.toString('base64'),
    GOOGLE_OAUTH_CLIENT_ID: 'g',
    GOOGLE_OAUTH_CLIENT_SECRET: 'g',
    GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/integrations/gmail/callback',
    GMAIL_PUBSUB_TOPIC: 'projects/mms-crm/topics/gmail-crm',
    GMAIL_PUSH_AUDIENCE: AUDIENCE,
    GMAIL_PUSH_SERVICE_ACCOUNT: PUSH_ACCOUNT,
  };

  const as = () =>
    createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({
            id: micky,
            name: 'Micky',
            email: 'micky@makemysolar.com.au',
            permissions: allPermissions(),
          }),
          firebaseUid: 'uid',
        },
        { db, integrations },
      ),
    );

  const emails = () => db.select().from(emailMessages);
  const state = async () =>
    (
      await db.select().from(gmailSyncState).where(eq(gmailSyncState.connectionId, connectionId))
    )[0];

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: micky } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
    await upsertUser(
      db,
      { email: 'sam@makemysolar.com.au', name: 'Sam', roleKey: 'admin' },
      'makemysolar.com.au',
    );
    google = fakeGoogle();
    integrations = createIntegrations(config, google.fetchImpl);
    ({ id: contactId } = await as().contacts.create({
      firstName: 'Jack',
      email: 'jack@example.com',
      type: 'Residential',
    }));
    ({ id: leadId } = await as().leads.create({
      values: { firstName: 'Olivia', email: 'olivia@example.com' },
    }));
    const [connection] = await db
      .insert(integrationConnections)
      .values({
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
      })
      .returning();
    connectionId = connection?.id ?? '';
    inbox = {};
    history = { messageIds: [], historyId: '200' };
    google.on(`POST ${GMAIL}/watch`, () => ({
      status: 200,
      body: { historyId: '100', expiration: String(Date.now() + 7 * 86_400_000) },
    }));
    google.on(`GET ${GMAIL}/profile`, () => ({
      status: 200,
      body: { emailAddress: 'micky@makemysolar.com.au', messagesTotal: 5, historyId: '300' },
    }));
    google.on(`GET ${GMAIL}/history`, () =>
      history === 'expired'
        ? { status: 404, body: { error: { message: 'Requested entity was not found.' } } }
        : {
            status: 200,
            body: {
              historyId: history.historyId,
              history: history.messageIds.map((id) => ({ messagesAdded: [{ message: { id } }] })),
            },
          },
    );
    google.on(`GET ${GMAIL}/messages?`, () => ({
      status: 200,
      body: { messages: Object.keys(inbox).map((id) => ({ id })) },
    }));
    google.on(`GET ${GMAIL}/messages/`, (call) => {
      const id = decodeURIComponent(/messages\/([^?]+)/.exec(call.url)?.[1] ?? '');
      const message = inbox[id];
      return message ? { status: 200, body: message } : { status: 404 };
    });
  });
  afterAll(() => db.$client.end());

  /** Puts messages in the fake inbox and in the history since the last run. */
  function arrive(...messages: ReturnType<typeof gmailMessage>[]) {
    for (const m of messages) inbox[m.id] = m;
    history = { messageIds: messages.map((m) => m.id), historyId: '250' };
  }

  it('first run starts the Pub/Sub watch and begins from now', async () => {
    const result = await syncMailbox(db, integrations, connectionId);
    expect(result.stored).toBe(0);
    const watch = google.calls.find((c) => c.url === `${GMAIL}/watch`);
    expect(JSON.parse(watch?.body ?? '{}')).toEqual({
      topicName: 'projects/mms-crm/topics/gmail-crm',
      labelIds: ['INBOX'],
      labelFilterBehavior: 'include',
    });
    // The watch's history ID is the starting point; nothing older is imported.
    expect(google.calls.find((c) => c.url.includes('/history?'))?.url).toContain(
      'startHistoryId=100',
    );
    expect(await state()).toMatchObject({ historyId: '200', lastSyncError: null });
    expect((await state())?.watchExpiresAt).not.toBeNull();
    // Not renewed again on the next run (it lasts 7 days).
    google.calls.length = 0;
    await syncMailbox(db, integrations, connectionId);
    expect(google.calls.some((c) => c.url.endsWith('/watch'))).toBe(false);
  });

  it('stores customers’ emails on their record and timeline; ignores everyone else', async () => {
    await syncMailbox(db, integrations, connectionId);
    arrive(
      gmailMessage('m1', {
        from: 'Jack Smith <Jack@Example.com>',
        html: '<div dir="ltr">Thanks — <b>Friday</b> works.<img src="https://track.example/p.gif"><script>steal()</script><a href="javascript:alert(1)">x</a></div><div class="gmail_quote"><div class="gmail_attr">On Tue, Micky wrote:</div><blockquote>Old quoted text</blockquote></div>',
        text: 'Thanks — Friday works.\n\nOn Tue, Micky wrote:\n> Old quoted text',
      }),
      gmailMessage('m2', {
        from: 'olivia@example.com',
        subject: 'Battery question',
        text: 'Can I add a battery later?\n\nOlivia',
      }),
      gmailMessage('m3', { from: 'newsletter@shop.example', text: 'Big sale!' }),
      gmailMessage('m4', { from: 'Sam <sam@makemysolar.com.au>', text: 'Lunch?' }),
      gmailMessage('m5', { from: 'jack@example.com', text: 'Draft', labels: ['DRAFT'] }),
    );
    const result = await syncMailbox(db, integrations, connectionId);
    expect(result).toMatchObject({ stored: 2, checked: 5 });
    const rows = await emails();
    expect(rows).toHaveLength(2);
    const jack = rows.find((r) => r.gmailMessageId === 'm1');
    expect(jack).toMatchObject({
      direction: 'inbound',
      status: 'received',
      entityType: 'contact',
      entityId: contactId,
      contactId,
      fromAddress: 'jack@example.com',
      toAddresses: ['micky@makemysolar.com.au'],
      subject: 'Re: Your solar quote',
      bodyText: 'Thanks — Friday works.x',
      messageIdHeader: '<m1@mail.gmail.com>',
      attachmentCount: 1,
      mailboxUserId: micky,
    });
    // Formatting kept; scripts, tracking images, javascript: links and the quoted history gone.
    expect(jack?.bodyHtml).toBe(
      '<div>Thanks — <b>Friday</b> works.<a target="_blank" rel="noopener noreferrer nofollow">x</a></div>',
    );
    expect(rows.find((r) => r.gmailMessageId === 'm2')).toMatchObject({
      entityType: 'lead',
      entityId: leadId,
      bodyText: 'Can I add a battery later?\n\nOlivia',
      bodyHtml: '<p>Can I add a battery later?</p><p>Olivia</p>',
    });
    const timeline = await db.select().from(activities).where(eq(activities.type, 'email'));
    expect(timeline.map((a) => [a.entityId, a.direction, a.subject]).sort()).toEqual(
      [
        [contactId, 'inbound', 'Re: Your solar quote'],
        [leadId, 'inbound', 'Battery question'],
      ].sort(),
    );
    expect(await state()).toMatchObject({ historyId: '250', lastStored: 2 });

    // A repeated push (same history) stores nothing twice.
    history = { messageIds: ['m1', 'm2'], historyId: '260' };
    expect((await syncMailbox(db, integrations, connectionId)).stored).toBe(0);
    expect(await emails()).toHaveLength(2);
  });

  it('a reply in a thread started from the CRM goes to that record, whoever sends it', async () => {
    await db.insert(emailMessages).values({
      direction: 'outbound',
      entityType: 'lead',
      entityId: leadId,
      mailboxUserId: micky,
      fromAddress: 'micky@makemysolar.com.au',
      toAddresses: ['olivia@example.com'],
      subject: 'Your solar quote',
      bodyText: 'Quote attached',
      status: 'sent',
      gmailMessageId: 'sent-1',
      gmailThreadId: 'th-quote',
    });
    await syncMailbox(db, integrations, connectionId);
    arrive(
      gmailMessage('m6', {
        from: 'Olivia (work) <o.nguyen@bigco.example>',
        threadId: 'th-quote',
        text: 'Replying from work — yes please!',
      }),
    );
    expect((await syncMailbox(db, integrations, connectionId)).stored).toBe(1);
    const reply = (await emails()).find((r) => r.gmailMessageId === 'm6');
    expect(reply).toMatchObject({ entityType: 'lead', entityId: leadId });

    const history_ = await as().messaging.history({ entityType: 'lead', entityId: leadId });
    expect(history_.map((m) => [m.direction, m.from])).toEqual([
      ['inbound', 'o.nguyen@bigco.example'],
      ['outbound', 'micky@makemysolar.com.au'],
    ]);
    expect(history_[0]).toMatchObject({
      kind: 'email',
      status: 'received',
      html: '<p>Replying from work — yes please!</p>',
      attachments: 1,
    });
  });

  it('when the history is too old, catches up from the recent inbox', async () => {
    await syncMailbox(db, integrations, connectionId);
    inbox.m7 = gmailMessage('m7', { from: 'jack@example.com', text: 'Still there?' });
    history = 'expired';
    expect((await syncMailbox(db, integrations, connectionId)).stored).toBe(1);
    expect(await state()).toMatchObject({ historyId: '300' });
  });

  it('a revoked mailbox is marked expired and the reason kept; others still sync', async () => {
    await syncMailbox(db, integrations, connectionId);
    google.on(`GET ${GMAIL}/history`, () => ({
      status: 401,
      body: { error: { message: 'Invalid Credentials' } },
    }));
    const result = await syncAllMailboxes(db, integrations);
    expect(result).toEqual({ mailboxes: 1, stored: 0 });
    expect((await db.select().from(integrationConnections))[0]?.status).toBe('expired');
    expect((await state())?.lastSyncError).toMatch(/credentials/i);
    // Expired mailboxes are skipped by the catch-up run.
    expect(await syncAllMailboxes(db, integrations)).toEqual({ mailboxes: 0, stored: 0 });
  });

  describe('colleagues on customer emails', () => {
    let sam = '';
    beforeEach(async () => {
      sam =
        (await db.select().from(users).where(eq(users.email, 'sam@makemysolar.com.au')))[0]?.id ??
        '';
      await syncMailbox(db, integrations, connectionId);
    });

    it('keeps a colleague’s reply-all when a customer is in To, CC or BCC; drops internal mail', async () => {
      arrive(
        gmailMessage('s1', {
          from: 'Sam <sam@makemysolar.com.au>',
          to: 'Micky <micky@makemysolar.com.au>',
          cc: 'Jack <jack@example.com>',
          text: 'Jack — I’ll bring the panels Friday.',
        }),
        gmailMessage('s2', {
          from: 'sam@makemysolar.com.au',
          to: 'micky@makemysolar.com.au',
          bcc: 'olivia@example.com',
          text: 'Copying Olivia quietly.',
        }),
        gmailMessage('s3', {
          from: 'sam@makemysolar.com.au',
          to: 'micky@makemysolar.com.au',
          cc: 'someone@unknown.example',
          text: 'Internal only (plus a stranger).',
        }),
      );
      expect((await syncMailbox(db, integrations, connectionId)).stored).toBe(2);
      const rows = await emails();
      expect(rows.find((r) => r.gmailMessageId === 's1')).toMatchObject({
        direction: 'inbound',
        entityType: 'contact',
        entityId: contactId,
        fromAddress: 'sam@makemysolar.com.au',
        ccAddresses: ['jack@example.com'],
        sentByUserId: sam,
      });
      expect(rows.find((r) => r.gmailMessageId === 's2')).toMatchObject({
        entityType: 'lead',
        entityId: leadId,
      });
      expect(rows.some((r) => r.gmailMessageId === 's3')).toBe(false);

      const history = await as().messaging.history({ entityType: 'contact', entityId: contactId });
      expect(history[0]).toMatchObject({
        direction: 'inbound',
        from: 'sam@makemysolar.com.au',
        senderName: 'Sam',
        fromStaff: true,
      });
    });

    it('a colleague’s reply in a CRM conversation stays on that record', async () => {
      await db.insert(emailMessages).values({
        direction: 'outbound',
        entityType: 'lead',
        entityId: leadId,
        mailboxUserId: micky,
        fromAddress: 'micky@makemysolar.com.au',
        toAddresses: ['olivia@example.com'],
        ccAddresses: ['sam@makemysolar.com.au'],
        subject: 'Your quote',
        bodyText: 'Quote',
        status: 'sent',
        gmailMessageId: 'sent-q',
        gmailThreadId: 'th-q',
        messageIdHeader: '<CAquote@mail.gmail.com>',
      });
      arrive(
        // Sam's reply-all (Jack is a contact too, but the conversation is Olivia's lead).
        gmailMessage('s4', {
          from: 'sam@makemysolar.com.au',
          to: 'olivia@example.com, micky@makemysolar.com.au',
          cc: 'jack@example.com',
          threadId: 'th-q',
          inReplyTo: '<CAquote@mail.gmail.com>',
          text: 'Adding: install is Friday.',
        }),
        // The copy of the CRM's own email that reached this inbox: the same email, not new.
        gmailMessage('s5', {
          from: 'micky@makemysolar.com.au',
          to: 'olivia@example.com',
          threadId: 'th-q',
          messageId: '<CAquote@mail.gmail.com>',
          text: 'Quote',
        }),
      );
      expect((await syncMailbox(db, integrations, connectionId)).stored).toBe(1);
      const reply = (await emails()).find((r) => r.gmailMessageId === 's4');
      expect(reply).toMatchObject({ entityType: 'lead', entityId: leadId, sentByUserId: sam });
      expect(reply?.inReplyToId).not.toBeNull();
    });

    it('an email that reached two colleagues’ mailboxes is stored once', async () => {
      arrive(
        gmailMessage('copy-a', {
          from: 'jack@example.com',
          cc: 'sam@makemysolar.com.au',
          messageId: '<CAjack@mail.example.com>',
          text: 'To you both.',
        }),
        // Sam's mailbox gives the same email a different Gmail id.
        gmailMessage('copy-b', {
          from: 'jack@example.com',
          cc: 'sam@makemysolar.com.au',
          messageId: '<CAjack@mail.example.com>',
          text: 'To you both.',
        }),
      );
      expect((await syncMailbox(db, integrations, connectionId)).stored).toBe(1);
      expect(await emails()).toHaveLength(1);
      const timeline = await db.select().from(activities).where(eq(activities.type, 'email'));
      expect(timeline).toHaveLength(1);
    });
  });

  describe('replying', () => {
    beforeEach(async () => {
      await syncMailbox(db, integrations, connectionId);
      arrive(
        gmailMessage('m8', {
          from: 'jack@example.com',
          threadId: 'th-jack',
          text: 'When is install?',
        }),
      );
      await syncMailbox(db, integrations, connectionId);
      google.on(`POST ${GMAIL}/messages/send`, () => ({
        status: 200,
        body: { id: 'sent-2', threadId: 'th-jack' },
      }));
    });

    it('threads the reply in Gmail and links it to the email it answers', async () => {
      const [original] = await emails();
      await as().messaging.sendEmail({
        entityType: 'contact',
        entityId: contactId,
        subject: 'Re: Your solar quote',
        html: '<p>Next <u>Friday</u>.</p>',
        replyToId: original?.id,
      });
      const send = google.calls.find((c) => c.url.endsWith('/messages/send'));
      const body = JSON.parse(send?.body ?? '{}') as { raw: string; threadId?: string };
      expect(body.threadId).toBe('th-jack');
      const mime = Buffer.from(body.raw, 'base64url').toString('utf8');
      expect(mime).toContain('In-Reply-To: <m8@mail.gmail.com>');
      expect(mime).toContain('References: <m8@mail.gmail.com>');
      const sent = (await emails()).find((r) => r.gmailMessageId === 'sent-2');
      expect(sent).toMatchObject({ inReplyToId: original?.id, bodyText: 'Next Friday.' });
    });

    it('refuses a reply to another customer’s email', async () => {
      const [original] = await emails();
      await expect(
        as().messaging.sendEmail({
          entityType: 'lead',
          entityId: leadId,
          subject: 'Re: x',
          html: '<p>Hi</p>',
          replyToId: original?.id,
        }),
      ).rejects.toThrow('isn’t part of this record');
    });

    it('refuses an email with no text', async () => {
      await expect(
        as().messaging.sendEmail({
          entityType: 'contact',
          entityId: contactId,
          subject: 'Empty',
          html: '<p><br></p><script>x</script>',
        }),
      ).rejects.toThrow('Write the email.');
    });
  });

  describe('push webhook', () => {
    let server: Server;
    let base = '';
    let privateKey: CryptoKey;
    let jwk: JWK;

    beforeAll(async () => {
      const pair = await generateKeyPair('RS256');
      privateKey = pair.privateKey;
      jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
    });

    const token = (claims: Record<string, unknown> = {}, audience = AUDIENCE) =>
      new SignJWT({ email: PUSH_ACCOUNT, email_verified: true, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://accounts.google.com')
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);

    const push = (authorization: string | null, emailAddress = 'micky@makemysolar.com.au') =>
      fetch(`${base}/webhooks/gmail`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({
          message: {
            data: Buffer.from(JSON.stringify({ emailAddress, historyId: 250 })).toString('base64'),
            messageId: '1',
          },
          subscription: 'projects/mms-crm/subscriptions/gmail-crm-push',
        }),
      });

    async function start(int: Integrations) {
      const app = createApp({
        config: { APP_URL: 'http://localhost:5173', ALLOWED_EMAIL_DOMAIN: 'makemysolar.com.au' },
        db,
        logger: silentLogger,
        verifyIdToken: () => Promise.reject(new Error('unused')),
        storage: null,
        jobs: null,
        sheets: null,
        integrations: int,
        gmailPushVerifier: pushVerifier(int.gmailPush, createLocalJWKSet({ keys: [jwk] })),
      });
      server = app.listen(0);
      await new Promise<void>((resolve) => server.once('listening', resolve));
      base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    }
    afterEach(() => {
      server.close();
    });

    it('refuses pushes without a valid Google token for our audience and account', async () => {
      await start(integrations);
      expect((await push(null)).status).toBe(401);
      expect((await push('Bearer not-a-jwt')).status).toBe(401);
      expect((await push(`Bearer ${await token({}, 'https://evil.example')}`)).status).toBe(401);
      expect(
        (await push(`Bearer ${await token({ email: 'someone@evil.iam.gserviceaccount.com' })}`))
          .status,
      ).toBe(401);
      // Signed by another key: refused.
      const other = await generateKeyPair('RS256');
      const forged = await new SignJWT({ email: PUSH_ACCOUNT, email_verified: true })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://accounts.google.com')
        .setAudience(AUDIENCE)
        .setExpirationTime('5m')
        .sign(other.privateKey);
      expect((await push(`Bearer ${forged}`)).status).toBe(401);
      expect(await emails()).toHaveLength(0);
    });

    it('is off (503) until GMAIL_PUSH_AUDIENCE is set', async () => {
      await start(
        createIntegrations({ ...config, GMAIL_PUSH_AUDIENCE: undefined }, google.fetchImpl),
      );
      expect((await push(`Bearer ${await token()}`)).status).toBe(503);
    });

    it('a valid push syncs that mailbox; unknown mailboxes are acknowledged and ignored', async () => {
      await start(integrations);
      await syncMailbox(db, integrations, connectionId);
      arrive(gmailMessage('m9', { from: 'jack@example.com', text: 'Pushed!' }));
      expect((await push(`Bearer ${await token()}`)).status).toBe(204);
      expect((await emails()).map((r) => r.bodyText)).toEqual(['Pushed!']);
      expect((await state())?.lastPushAt).not.toBeNull();
      expect((await push(`Bearer ${await token()}`, 'stranger@gmail.com')).status).toBe(204);
    });
  });
});
