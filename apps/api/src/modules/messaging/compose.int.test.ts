import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix } from '@mms/shared';
import {
  activities,
  companyProfile,
  emailAttachments,
  emailDrafts,
  emailMessages,
  integrationConnections,
} from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { encryptJson } from '../../integrations/crypto.ts';
import type { Fetch } from '../../integrations/http.ts';
import { createIntegrations, type Integrations } from '../../integrations/service.ts';
import type { Storage } from '../../storage/storage.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';
import { cleanupAbandonedAttachments } from './compose.ts';

const createCaller = createCallerFactory(appRouter);
const KEY = randomBytes(32);
const UPLOAD_SEND = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send';

/** Object storage in memory: a "presigned URL" is memory://key; put() is the browser's PUT. */
function memoryStorage() {
  const objects = new Map<string, { bytes: Buffer; type: string | null }>();
  const declared = new Map<string, string>();
  const storage: Storage = {
    presignUpload: (key, contentType) => {
      declared.set(key, contentType);
      return Promise.resolve(`memory://${key}`);
    },
    presignDownload: (key) => Promise.resolve(`memory-download://${key}`),
    presignPreview: (key) => Promise.resolve(`memory-preview://${key}`),
    head: (key) => {
      const o = objects.get(key);
      return Promise.resolve(o ? { sizeBytes: o.bytes.length, contentType: o.type } : null);
    },
    read: (key) => {
      const o = objects.get(key);
      return o ? Promise.resolve(o.bytes) : Promise.reject(new Error('missing'));
    },
    remove: (keys) => {
      for (const key of keys) objects.delete(key);
      return Promise.resolve();
    },
  };
  const put = (url: string, bytes: Buffer) => {
    const key = url.replace('memory://', '');
    objects.set(key, { bytes, type: declared.get(key) ?? null });
  };
  return { storage, objects, put };
}

type Call = { url: string; body: string; headers: Headers };

describe('email composer: attachments, signature, drafts (Step 5.2)', () => {
  const db = createTestDb();
  let micky = '';
  let leadId = '';
  let memory = memoryStorage();
  let integrations: Integrations;
  let sends: Call[] = [];

  const fetchImpl: Fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    sends.push({
      url,
      body: typeof init?.body === 'string' ? init.body : '',
      headers: new Headers(init?.headers),
    });
    return Promise.resolve(
      new Response(JSON.stringify({ id: `gm-${String(sends.length)}`, threadId: 'th-1' }), {
        status: 200,
      }),
    );
  };

  const as = (permissions = allPermissions()) =>
    createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({
            id: micky,
            name: 'Micky Singh',
            email: 'micky@makemysolar.com.au',
            permissions,
          }),
          firebaseUid: 'uid',
        },
        { db, integrations, storage: memory.storage },
      ),
    );

  /** Uploads a file the way the browser does: request, PUT, complete. */
  async function attach(fileName: string, contentType: string, bytes: Buffer) {
    const upload = await as().messaging.attachmentUpload({
      fileName,
      contentType,
      sizeBytes: bytes.length,
    });
    memory.put(upload.uploadUrl, bytes);
    await as().messaging.attachmentComplete({ id: upload.id });
    return upload.id;
  }

  /** The MIME message Gmail was given in the last send. */
  function lastMime() {
    const call = sends.findLast((c) => c.url.includes('/send'));
    if (call?.url.startsWith(UPLOAD_SEND)) return call.body;
    return Buffer.from(
      (JSON.parse(call?.body ?? '{}') as { raw: string }).raw,
      'base64url',
    ).toString('utf8');
  }

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: micky } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky Singh', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
    memory = memoryStorage();
    sends = [];
    integrations = createIntegrations(
      {
        APP_URL: 'http://localhost:5173',
        TOKEN_ENCRYPTION_KEY: KEY.toString('base64'),
        GOOGLE_OAUTH_CLIENT_ID: 'g',
        GOOGLE_OAUTH_CLIENT_SECRET: 'g',
        GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/integrations/gmail/callback',
      },
      fetchImpl,
    );
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
    });
    ({ id: leadId } = await as().leads.create({
      values: { firstName: 'Olivia', email: 'olivia@example.com' },
    }));
  });
  afterAll(() => db.$client.end());

  describe('attachments', () => {
    it('sends PDFs and images as attachments and keeps them with the email', async () => {
      const pdf = Buffer.from('%PDF-1.7 quote');
      const pdfId = await attach('Quote — 6.6 kW.pdf', 'application/pdf', pdf);
      const photoId = await attach('roof.JPG', '', Buffer.from('jpeg-bytes'));
      const result = await as().messaging.sendEmail({
        entityType: 'lead',
        entityId: leadId,
        subject: 'Your quote',
        html: '<p>Attached.</p>',
        attachmentIds: [pdfId, photoId],
      });
      expect(result.attachments).toBe(2);
      const mime = lastMime();
      expect(mime).toMatch(/Content-Type: multipart\/mixed; boundary="[^"]+"/);
      expect(mime).toContain('Content-Type: multipart/alternative');
      expect(mime).toContain(
        `Content-Disposition: attachment; filename="Quote _ 6.6 kW.pdf"; filename*=UTF-8''${encodeURIComponent('Quote — 6.6 kW.pdf')}`,
      );
      expect(mime).toContain(pdf.toString('base64'));
      expect(mime).toContain('Content-Type: image/jpeg; name="roof.JPG"');

      const [email] = await db.select().from(emailMessages);
      expect(email?.attachmentCount).toBe(2);
      const files = await db.select().from(emailAttachments);
      expect(files.every((f) => f.emailMessageId === email?.id)).toBe(true);
      const [activity] = await db.select().from(activities).where(eq(activities.type, 'email'));
      expect(activity?.body).toBe('Attached.\n\nAttached: Quote — 6.6 kW.pdf, roof.JPG');

      const history = await as().messaging.history({ entityType: 'lead', entityId: leadId });
      expect(history[0]?.files.map((f) => f.fileName).sort()).toEqual([
        'Quote — 6.6 kW.pdf',
        'roof.JPG',
      ]);
      expect((await as().messaging.attachmentDownload({ id: pdfId })).url).toContain(
        'memory-download://email/',
      );
      // Someone who can't view leads can't fetch it.
      const noLeads = emptyPermissionMatrix();
      noLeads.contacts.view = true;
      await expect(as(noLeads).messaging.attachmentDownload({ id: pdfId })).rejects.toThrow(
        'does not allow',
      );
      // A sent file can't be removed, or sent again.
      await expect(as().messaging.attachmentRemove({ id: pdfId })).rejects.toThrow('kept with it');
      await expect(
        as().messaging.sendEmail({
          entityType: 'lead',
          entityId: leadId,
          subject: 'Again',
          html: '<p>x</p>',
          attachmentIds: [pdfId],
        }),
      ).rejects.toThrow('missing or still uploading');
    });

    it('refuses other file types, unfinished uploads and too much in total', async () => {
      await expect(
        as().messaging.attachmentUpload({
          fileName: 'setup.exe',
          contentType: 'application/octet-stream',
          sizeBytes: 10,
        }),
      ).rejects.toThrow('PDF or an image');
      await expect(
        as().messaging.attachmentUpload({
          fileName: 'big.pdf',
          contentType: 'application/pdf',
          sizeBytes: 11 * 1024 * 1024,
        }),
      ).rejects.toThrow('up to 10 MB');
      const pending = await as().messaging.attachmentUpload({
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 5,
      });
      await expect(as().messaging.attachmentComplete({ id: pending.id })).rejects.toThrow(
        "didn't finish uploading",
      );
      const ids = [];
      for (const n of [1, 2]) {
        ids.push(
          await attach(`${String(n)}.pdf`, 'application/pdf', Buffer.alloc(9.5 * 1024 * 1024)),
        );
      }
      await expect(
        as().messaging.sendEmail({
          entityType: 'lead',
          entityId: leadId,
          subject: 'Big',
          html: '<p>x</p>',
          attachmentIds: ids,
        }),
      ).rejects.toThrow('18 MB');
      expect(sends).toHaveLength(0);
    });

    it('large emails go through Gmail’s upload endpoint, still threaded', async () => {
      const id = await attach('plans.pdf', 'application/pdf', Buffer.alloc(5 * 1024 * 1024, 7));
      await as().messaging.sendEmail({
        entityType: 'lead',
        entityId: leadId,
        subject: 'Plans',
        html: '<p>Plans</p>',
        attachmentIds: [id],
      });
      const call = sends.findLast((c) => c.url.includes('/send'));
      expect(call?.url).toBe(`${UPLOAD_SEND}?uploadType=multipart`);
      expect(call?.headers.get('content-type')).toMatch(/^multipart\/related; boundary=/);
      expect(call?.body).toContain('Content-Type: message/rfc822');
    });

    it('the clean-up removes abandoned uploads, not drafts’ or sent ones', async () => {
      const abandoned = await attach('old.pdf', 'application/pdf', Buffer.from('x'));
      const onDraft = await attach('draft.pdf', 'application/pdf', Buffer.from('y'));
      await as().messaging.draftSave({
        entityType: 'lead',
        entityId: leadId,
        subject: 'Later',
        html: '',
        attachmentIds: [onDraft],
      });
      const removed = await cleanupAbandonedAttachments(
        db,
        memory.storage,
        new Date(Date.now() + 25 * 3600_000),
      );
      expect(removed).toBe(1);
      const left = await db.select().from(emailAttachments);
      expect(left.map((f) => f.id)).toEqual([onDraft]);
      expect([...memory.objects.keys()].some((k) => k.includes(abandoned))).toBe(false);
    });
  });

  describe('signature', () => {
    it('starts from the user and company profile, and is added to the email', async () => {
      await db.insert(companyProfile).values({
        legalName: 'Make My Solar Pty Ltd',
        tradingName: 'Make My Solar',
        phone: '1300 000 000',
        website: 'makemysolar.com.au',
        streetAddress: '1 Sun St',
        suburb: 'Perth',
        state: 'WA',
        postcode: '6000',
      });
      const initial = await as().messaging.signature();
      expect(initial).toMatchObject({
        saved: false,
        fields: {
          enabled: true,
          fullName: 'Micky Singh',
          email: 'micky@makemysolar.com.au',
          companyName: 'Make My Solar',
          phone: '1300 000 000',
          address: '1 Sun St, Perth WA 6000',
          website: 'makemysolar.com.au',
        },
      });
      expect(initial.previewHtml).toContain('Micky Singh');

      await as().messaging.signatureSave({
        ...initial.fields,
        title: 'Sales <Manager>',
        mobile: '0412 345 678',
      });
      const logo = await as().messaging.signatureLogoUpload({
        fileName: 'logo.png',
        contentType: 'image/png',
        sizeBytes: 4,
      });
      memory.put(logo.uploadUrl, Buffer.from('PNG!'));
      await as().messaging.signatureLogoComplete();
      const saved = await as().messaging.signature();
      expect(saved).toMatchObject({ saved: true, hasLogo: true });
      expect(saved.previewHtml).toContain('Sales &lt;Manager&gt;'); // escaped
      expect(saved.previewHtml).toContain('src="memory-preview://signatures/');

      await as().messaging.sendEmail({
        entityType: 'lead',
        entityId: leadId,
        subject: 'Hello',
        html: '<p>Hi Olivia</p>',
        includeSignature: true,
      });
      const mime = lastMime();
      expect(mime).toContain('Content-Type: multipart/related');
      expect(mime).toContain('Content-ID: <mms-signature-logo>');
      expect(mime).toContain(Buffer.from('PNG!').toString('base64'));
      const html = Buffer.from(
        /Content-Type: text\/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/
          .exec(mime)?.[1]
          ?.replace(/\r\n/g, '') ?? '',
        'base64',
      ).toString('utf8');
      expect(html).toContain('src="cid:mms-signature-logo"');
      expect(html).toContain('<a href="tel:0412345678"');
      const [email] = await db.select().from(emailMessages);
      // The CRM copy has the signature without the logo, and the text has the "-- " lines.
      expect(email?.bodyHtml).toContain('Sales &lt;Manager&gt;');
      expect(email?.bodyHtml).not.toContain('cid:');
      expect(email?.bodyText).toContain('Hi Olivia\n\n-- \nMicky Singh\nSales <Manager>');
    });

    it('is left off when not asked for, and the logo can be removed', async () => {
      await as().messaging.sendEmail({
        entityType: 'lead',
        entityId: leadId,
        subject: 'Plain',
        html: '<p>No signature</p>',
      });
      expect(lastMime()).not.toContain('mms-signature');
      expect((await as().messaging.signatureLogoRemove()).removed).toBe(false);
    });
  });

  describe('drafts', () => {
    it('saves, updates, lists only your own, and sending removes the draft', async () => {
      const fileId = await attach('quote.pdf', 'application/pdf', Buffer.from('%PDF'));
      const first = await as().messaging.draftSave({
        entityType: 'lead',
        entityId: leadId,
        to: ['olivia@example.com'],
        subject: 'Quote',
        html: '<p style="text-align: center">Draft <script>x</script></p>',
        includeSignature: true,
        attachmentIds: [fileId],
      });
      await as().messaging.draftSave({
        id: first.id,
        entityType: 'lead',
        entityId: leadId,
        to: ['olivia@example.com'],
        subject: 'Quote v2',
        html: '<p>Better</p>',
        includeSignature: true,
      });
      const drafts = await as().messaging.drafts({ entityType: 'lead', entityId: leadId });
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        id: first.id,
        subject: 'Quote v2',
        html: '<p>Better</p>',
        includeSignature: true,
        attachments: [{ id: fileId, fileName: 'quote.pdf' }],
      });

      await as().messaging.sendEmail({
        entityType: 'lead',
        entityId: leadId,
        subject: 'Quote v2',
        html: '<p>Better</p>',
        attachmentIds: [fileId],
        draftId: first.id,
      });
      expect(await db.select().from(emailDrafts)).toHaveLength(0);
      expect((await db.select().from(emailAttachments))[0]?.emailMessageId).not.toBeNull();
    });

    it('deleting a draft removes its unsent files', async () => {
      const fileId = await attach('x.pdf', 'application/pdf', Buffer.from('%PDF'));
      const { id } = await as().messaging.draftSave({
        entityType: 'lead',
        entityId: leadId,
        subject: '',
        html: '',
        attachmentIds: [fileId],
      });
      expect((await as().messaging.draftDelete({ id })).deleted).toBe(true);
      expect(await db.select().from(emailAttachments)).toHaveLength(0);
      expect(memory.objects.size).toBe(0);
    });

    it('needs edit on the record', async () => {
      const viewer = emptyPermissionMatrix();
      viewer.leads.view = true;
      await expect(
        as(viewer).messaging.draftSave({
          entityType: 'lead',
          entityId: leadId,
          subject: '',
          html: '',
        }),
      ).rejects.toThrow('does not allow');
    });
  });

  it('keeps fonts, sizes, colours and alignment, and nothing unsafe', async () => {
    await as().messaging.sendEmail({
      entityType: 'lead',
      entityId: leadId,
      subject: 'Styled',
      html: '<p style="text-align: center"><span style="font-family: Georgia, Times New Roman, serif; font-size: 18px; color: #cc0000; background-color: #ffff00; position: fixed">Big red</span> <s>old</s></p><blockquote><p>Quoted</p></blockquote><hr><p style="text-align: evil">x</p><span style="background-image: url(https://t.example/p.gif)">y</span>',
    });
    const [email] = await db.select().from(emailMessages);
    expect(email?.bodyHtml).toBe(
      '<p style="text-align:center"><span style="font-family:Georgia, Times New Roman, serif;font-size:18px;color:#cc0000;background-color:#ffff00">Big red</span> <s>old</s></p><blockquote><p>Quoted</p></blockquote><hr /><p>x</p>y',
    );
    expect(email?.bodyText).toBe('Big red old\n\nQuoted\n\n——————————\n\nx\n\ny');
  });
});
