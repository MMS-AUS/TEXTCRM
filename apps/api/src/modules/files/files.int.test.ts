import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix, type PermissionMatrix } from '@mms/shared';
import { loadConfig } from '../../config.ts';
import { auditLog, files } from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createStorage, prepareDevBucket, type Storage } from '../../storage/storage.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';

const createCaller = createCallerFactory(appRouter);
const APP_URL = 'http://localhost:5173';

// Uses the real local storage container (npm run db:up) with its own test bucket.
const storageConfig = { ...loadConfig(), S3_BUCKET: process.env.S3_BUCKET_TEST };
const configured = Boolean(storageConfig.S3_ENDPOINT && storageConfig.S3_BUCKET);

describe.skipIf(!configured)('files (against the local storage container)', () => {
  const db = createTestDb();
  let storage: Storage;
  let userId = '';
  let leadId = '';

  beforeAll(async () => {
    await prepareDevBucket(storageConfig, APP_URL);
    const created = createStorage(storageConfig);
    if (!created) throw new Error('storage not configured');
    storage = created;
  });

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: userId } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
    ({ id: leadId } = await as().leads.create({
      values: { firstName: 'Olivia', email: 'o@x.com' },
    }));
  });
  afterAll(() => db.$client.end());

  function as(permissions: PermissionMatrix = allPermissions()) {
    return createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id: userId, permissions }),
          firebaseUid: 'uid',
        },
        { db, storage },
      ),
    );
  }

  const bill = new TextEncoder().encode('%PDF-1.4 fake electricity bill');

  async function upload(
    bytes: Uint8Array,
    declared = bytes.length,
    fileName = 'Bill Oct 2026.pdf',
  ) {
    const ticket = await as().files.createUpload({
      entityType: 'lead',
      entityId: leadId,
      category: 'bill',
      fileName,
      contentType: 'application/pdf',
      sizeBytes: declared,
    });
    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': ticket.contentType },
      body: bytes,
    }).catch(() => null);
    return { ticket, put };
  }

  it('uploads through a presigned URL, lists the file and downloads it with a short-lived link', async () => {
    const { ticket, put } = await upload(bill);
    expect(put?.ok).toBe(true);
    // R2/S3 reject uploads whose URL carries the SDK's empty-body checksum.
    expect(ticket.uploadUrl).not.toMatch(/checksum/i);
    // Not visible until confirmed.
    expect(await as().files.list({ entityType: 'lead', entityId: leadId })).toEqual([]);

    await as().files.completeUpload({ id: ticket.id });
    const [listed] = await as().files.list({ entityType: 'lead', entityId: leadId });
    expect(listed).toMatchObject({
      fileName: 'Bill Oct 2026.pdf',
      category: 'bill',
      sizeBytes: bill.length,
      uploaderName: 'Micky',
      canOpenInBrowser: true,
    });

    const { url } = await as().files.downloadUrl({ id: ticket.id });
    const download = await fetch(url);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bill);
    expect(download.headers.get('content-disposition')).toMatch(
      /^attachment;.*Bill%20Oct%202026\.pdf/,
    );

    // Without a signature the bucket refuses access.
    const unsigned = await fetch(url.split('?')[0] ?? '');
    expect(unsigned.status).toBe(403);

    const timeline = await as().activities.list({ entityType: 'lead', entityId: leadId });
    expect(timeline[0]?.subject).toBe('Uploaded electricity bill: Bill Oct 2026.pdf');
  });

  it('lets the browser upload from the web app (CORS)', async () => {
    const ticket = await as().files.createUpload({
      entityType: 'lead',
      entityId: leadId,
      category: 'photo',
      fileName: 'roof.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 10,
    });
    const preflight = await fetch(ticket.uploadUrl, {
      method: 'OPTIONS',
      headers: {
        origin: APP_URL,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBe(APP_URL);
  });

  it('refuses an upload that never arrived or does not match what was declared', async () => {
    const missing = await as().files.createUpload({
      entityType: 'lead',
      entityId: leadId,
      category: 'bill',
      fileName: 'never.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
    });
    await expect(as().files.completeUpload({ id: missing.id })).rejects.toThrow(/didn't finish/);

    const { ticket, put } = await upload(bill, bill.length + 50);
    expect(put?.ok ?? false).toBe(false); // the signed length doesn't match
    await expect(as().files.completeUpload({ id: ticket.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await db.select().from(files)).toEqual([]);
  });

  it('accepts only safe file types and respects permissions', async () => {
    await expect(
      as().files.createUpload({
        entityType: 'lead',
        entityId: leadId,
        category: 'other',
        fileName: 'invoice.exe',
        contentType: 'application/x-msdownload',
        sizeBytes: 10,
      }),
    ).rejects.toThrow(/not accepted/);
    await expect(
      as().files.createUpload({
        entityType: 'lead',
        entityId: leadId,
        category: 'other',
        fileName: 'drawing.svg',
        contentType: 'image/svg+xml',
        sizeBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const viewOnly = emptyPermissionMatrix();
    viewOnly.leads = { ...viewOnly.leads, view: true };
    await expect(
      as(viewOnly).files.createUpload({
        entityType: 'lead',
        entityId: leadId,
        category: 'bill',
        fileName: 'bill.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      as(emptyPermissionMatrix()).files.list({ entityType: 'lead', entityId: leadId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('removes the stored bytes and keeps an audit record', async () => {
    const { ticket } = await upload(bill);
    await as().files.completeUpload({ id: ticket.id });
    const [row] = await db.select().from(files).where(eq(files.id, ticket.id));
    if (!row) throw new Error('missing row');

    await as().files.remove({ id: ticket.id });
    expect(await storage.head(row.storageKey)).toBeNull();
    expect(await as().files.list({ entityType: 'lead', entityId: leadId })).toEqual([]);
    await expect(as().files.downloadUrl({ id: ticket.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const removals = await db.select().from(auditLog).where(eq(auditLog.action, 'file_remove'));
    expect(removals).toHaveLength(1);
  });

  it('works for companies (which have no timeline)', async () => {
    const company = await as().companies.create({ name: 'Bright Solar' });
    const ticket = await as().files.createUpload({
      entityType: 'company',
      entityId: company.id,
      category: 'contract',
      fileName: 'agreement.pdf',
      contentType: 'application/pdf',
      sizeBytes: bill.length,
    });
    await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      body: bill,
    });
    await as().files.completeUpload({ id: ticket.id });
    expect(await as().files.list({ entityType: 'company', entityId: company.id })).toHaveLength(1);
  });
});
