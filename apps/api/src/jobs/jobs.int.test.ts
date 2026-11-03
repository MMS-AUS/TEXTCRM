import { eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix } from '@mms/shared';
import { files } from '../db/schema/index.ts';
import { requireDatabaseUrl } from '../env.ts';
import { createTestDb, truncateAll } from '../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../test/fakes.ts';
import { appRouter } from '../trpc/router.ts';
import { createCallerFactory } from '../trpc/trpc.ts';
import { cleanupPendingUploads } from './cleanup.ts';
import { createBoss, ensureQueues, jobQueue, QUEUES } from './queue.ts';

const createCaller = createCallerFactory(appRouter);

describe('background jobs (pg-boss)', () => {
  const db = createTestDb();
  let boss: PgBoss;

  beforeAll(async () => {
    boss = createBoss(requireDatabaseUrl('DATABASE_URL_TEST'), 'worker');
    boss.on('error', () => undefined);
    await boss.start();
    await ensureQueues(boss);
  });
  beforeEach(async () => {
    await truncateAll(db);
    await boss.deleteAllJobs();
  });
  afterAll(async () => {
    await boss.stop({ graceful: false, close: true });
    await db.$client.end();
  });

  const api = (permissions = allPermissions()) =>
    createCaller(
      fakeContext(
        { status: 'authenticated', user: fakeUser({ permissions }), firebaseUid: 'uid' },
        { db, jobs: jobQueue(boss) },
      ),
    );

  const state = async (queue: string, id: string | null) =>
    (await boss.findJobs(queue, { id: id ?? '' }))[0]?.state;

  async function until(check: () => Promise<boolean>, timeoutMs = 15_000) {
    const start = Date.now();
    while (!(await check())) {
      if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the job');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  it('creating the queues twice is safe', async () => {
    await ensureQueues(boss);
    expect((await boss.getQueue(QUEUES.syncSheets))?.policy).toBe('singleton');
    expect((await boss.getQueue(QUEUES.runImport))?.deadLetter).toBe(QUEUES.deadLetter);
  });

  it('runs a job, and a job that fails every attempt is listed as failed and dead-lettered', async () => {
    await boss.work(QUEUES.cleanupUploads, { pollingIntervalSeconds: 0.5 }, () =>
      Promise.resolve({ removed: 2 }),
    );
    await boss.work(QUEUES.runImport, { pollingIntervalSeconds: 0.5 }, () =>
      Promise.reject(new Error('Sheet not shared with the service account')),
    );
    const ok = await boss.send(QUEUES.cleanupUploads, {});
    const bad = await boss.send(QUEUES.runImport, { importId: 'x' }, { retryLimit: 0 });

    await until(async () => (await state(QUEUES.runImport, bad)) === 'failed');
    await until(async () => (await state(QUEUES.cleanupUploads, ok)) === 'completed');
    await until(async () => (await boss.findJobs(QUEUES.deadLetter)).length === 1);

    const overview = await api().jobs.overview({ failedOnly: false });
    if (!overview.installed) throw new Error('pg-boss schema missing');
    const failed = overview.jobs.find((job) => job.id === bad);
    expect(failed).toMatchObject({
      queue: QUEUES.runImport,
      state: 'failed',
      outcome: 'Sheet not shared with the service account',
    });
    expect(overview.jobs.find((job) => job.id === ok)?.outcome).toBe('{"removed":2}');
    expect(overview.queues.find((q) => q.name === QUEUES.runImport)?.failed).toBe(1);

    const onlyFailed = await api().jobs.overview({ failedOnly: true });
    expect(onlyFailed.installed && onlyFailed.jobs.every((job) => job.state === 'failed')).toBe(
      true,
    );

    // Retry puts it back in the queue.
    await boss.offWork(QUEUES.runImport);
    await api().jobs.retry({ queue: QUEUES.runImport, id: bad ?? '' });
    expect(await state(QUEUES.runImport, bad)).toBe('retry');
  });

  it('needs the integrations permission', async () => {
    await expect(
      api(emptyPermissionMatrix()).jobs.overview({ failedOnly: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('upload clean-up removes only pending uploads older than a day', async () => {
    const entityId = '11111111-1111-4111-8111-111111111111';
    const row = (key: string, status: 'pending' | 'ready', hoursAgo: number) => ({
      entityType: 'lead' as const,
      entityId,
      category: 'bill' as const,
      fileName: `${key}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 10,
      storageKey: key,
      status,
      createdAt: new Date(Date.now() - hoursAgo * 3600_000),
    });
    await db
      .insert(files)
      .values([
        row('old-pending', 'pending', 30),
        row('new-pending', 'pending', 2),
        row('old-ready', 'ready', 30),
      ]);
    const removedKeys: string[] = [];
    const removed = await cleanupPendingUploads(db, {
      remove: (keys) => {
        removedKeys.push(...keys);
        return Promise.resolve();
      },
      presignUpload: () => Promise.reject(new Error('unused')),
      presignDownload: () => Promise.reject(new Error('unused')),
      presignPreview: () => Promise.reject(new Error('unused')),
      head: () => Promise.resolve(null),
      read: () => Promise.reject(new Error('unused')),
    });
    expect(removed).toBe(1);
    expect(removedKeys).toEqual(['old-pending']);
    const left = await db.select({ key: files.storageKey }).from(files);
    expect(left.map((f) => f.key).sort()).toEqual(['new-pending', 'old-ready']);
    expect(await db.select().from(files).where(eq(files.storageKey, 'old-pending'))).toHaveLength(
      0,
    );
  });
});
