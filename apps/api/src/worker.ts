import type { Job } from 'pg-boss';
import { BUSINESS_TIME_ZONE } from '@mms/shared';
import { loadConfig, type Config } from './config.ts';
import { createDb } from './db/client.ts';
import { cleanupPendingUploads } from './jobs/cleanup.ts';
import { createBoss, ensureQueues, QUEUES, type QueueName } from './jobs/queue.ts';
import { createLogger } from './logger.ts';
import { runImport } from './modules/imports/service.ts';
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

async function start() {
  await boss.start();
  await ensureQueues(boss);

  await handle(QUEUES.heartbeat, () => Promise.resolve({ at: new Date().toISOString() }));
  await handle(QUEUES.cleanupUploads, async () => ({
    removed: await cleanupPendingUploads(db, storage),
  }));
  await handle<{ importId: string }>(QUEUES.runImport, (data) =>
    runImport(db, data.importId, logger.child({ queue: QUEUES.runImport })),
  );
  // Jobs that failed every retry: logged loudly; the original stays listed as failed.
  await handle<object>(QUEUES.deadLetter, (data, job) => {
    logger.error({ jobId: job.id, data }, 'A job failed after every retry');
    return Promise.resolve(undefined);
  });

  await boss.schedule(QUEUES.heartbeat, '* * * * *', null, { tz: BUSINESS_TIME_ZONE });
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
