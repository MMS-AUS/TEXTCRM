import type { Job } from 'pg-boss';
import { BUSINESS_TIME_ZONE } from '@mms/shared';
import { loadConfig, type Config } from './config.ts';
import { createDb } from './db/client.ts';
import { cleanupPendingUploads } from './jobs/cleanup.ts';
import { createBoss, ensureQueues, QUEUES, type QueueName } from './jobs/queue.ts';
import { createLogger } from './logger.ts';
import { createSheetsReader, type SheetsReader } from './modules/imports/google-sheets.ts';
import { runImport } from './modules/imports/service.ts';
import { syncCron, syncEnabledSources, syncSheetSource } from './modules/sheet-sync/sync.ts';
import { createStorage } from './storage/storage.ts';

// The background worker (Step 3.1): a separate process from the API, so a long import or sync
// never slows down the app. `npm run dev` starts it alongside the API and web app.

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = createLogger(config).child({ process: 'worker' });
const db = createDb(config.DATABASE_URL);
const storage = createStorage(config);
const boss = createBoss(config.DATABASE_URL, 'worker');
boss.on('error', (error) => {
  logger.error({ err: error }, 'Job queue error');
});

/** Runs each job on its own; a thrown error fails that job, and pg-boss retries it. */
async function handle<T extends object>(
  name: QueueName,
  run: (data: T, job: Job<T>) => Promise<object | undefined>,
) {
  await boss.work<T>(name, async (jobs) => {
    let output: object | undefined;
    for (const job of jobs) {
      const log = logger.child({ queue: name, jobId: job.id, attempt: job.retryCount + 1 });
      try {
        output = await run(job.data, job);
        if (name !== QUEUES.heartbeat) log.info({ output }, 'Job completed');
      } catch (error) {
        log.error({ err: error }, 'Job failed');
        throw error;
      }
    }
    return output;
  });
}

let sheets: SheetsReader | null = null;

async function start() {
  try {
    sheets = await createSheetsReader(config.GOOGLE_SERVICE_ACCOUNT_PATH);
  } catch (error) {
    logger.error(
      { err: error },
      'Could not read the Google service-account key — sheet sync is off.',
    );
  }
  await boss.start();
  await ensureQueues(boss);

  await handle(QUEUES.heartbeat, () => Promise.resolve({ at: new Date().toISOString() }));
  await handle(QUEUES.cleanupUploads, async () => ({
    removed: await cleanupPendingUploads(db, storage),
  }));
  await handle<{ importId: string }>(QUEUES.runImport, (data) =>
    runImport(db, data.importId, logger.child({ queue: QUEUES.runImport })),
  );
  // Live leads sync (Step 3.3): the schedule syncs every enabled sheet; "Sync now" sends one.
  await handle<{ sourceId?: string }>(QUEUES.syncSheets, async (data) => {
    const log = logger.child({ queue: QUEUES.syncSheets });
    if (!data.sourceId) return syncEnabledSources(db, sheets, log);
    if (!sheets) throw new Error('GOOGLE_SERVICE_ACCOUNT_PATH is not set');
    return (await syncSheetSource(db, sheets, data.sourceId, 'manual', log)) ?? undefined;
  });
  // Jobs that failed every retry: logged loudly; the original stays listed as failed.
  await handle<object>(QUEUES.deadLetter, (data, job) => {
    logger.error({ jobId: job.id, data }, 'A job failed after every retry');
    return Promise.resolve(undefined);
  });

  await boss.schedule(QUEUES.heartbeat, '* * * * *', null, { tz: BUSINESS_TIME_ZONE });
  await boss.schedule(
    QUEUES.syncSheets,
    syncCron(config.SHEETS_SYNC_INTERVAL_MINUTES),
    {},
    {
      tz: BUSINESS_TIME_ZONE,
    },
  );
  await boss.schedule(QUEUES.cleanupUploads, '17 * * * *', null, { tz: BUSINESS_TIME_ZONE });

  logger.info('Worker started');
}

start().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Worker could not start — is the database running?');
  process.exit(1);
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutting down');
  void boss
    .stop({ graceful: true, timeout: 20_000 })
    .then(() => db.$client.end())
    .then(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
