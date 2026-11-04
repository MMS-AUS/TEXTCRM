import { createApp } from './app.ts';
import { createFirebaseAuth } from './auth/firebase.ts';
import { loadConfig, type Config } from './config.ts';
import { createDb } from './db/client.ts';
import { createBoss, jobQueue, type JobQueue } from './jobs/queue.ts';
import { createLogger } from './logger.ts';
import { createSheetsReader, type SheetsReader } from './modules/imports/google-sheets.ts';
import { createStorage, prepareDevBucket } from './storage/storage.ts';

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = createLogger(config);
const db = createDb(config.DATABASE_URL);
const storage = createStorage(config);
if (!storage) logger.warn('File storage is not configured (S3_* in .env) — file uploads are off.');
if (storage && config.NODE_ENV === 'development') {
  // Local S3 container: create the bucket and allow browser uploads on first run.
  prepareDevBucket(config, config.APP_URL).catch((error: unknown) => {
    logger.warn(
      { err: error },
      'Could not prepare the local file bucket — is "npm run db:up" running?',
    );
  });
}
// The API only sends jobs; the worker process creates the queues and runs them.
const boss = createBoss(config.DATABASE_URL, 'api');
boss.on('error', (error) => {
  logger.error({ err: error }, 'Job queue error');
});
let jobs: JobQueue | null = null;
try {
  await boss.start();
  jobs = jobQueue(boss);
} catch (error) {
  logger.warn({ err: error }, 'Job queue unavailable — imports and syncs are off until restart.');
}

let sheets: SheetsReader | null = null;
try {
  sheets = await createSheetsReader(config.GOOGLE_SERVICE_ACCOUNT_PATH);
  if (!sheets)
    logger.warn(
      'Google Sheets is not configured (GOOGLE_SERVICE_ACCOUNT_PATH) — sheet imports are off.',
    );
} catch (error) {
  logger.error(
    { err: error },
    'Could not read the Google service-account key — sheet imports are off.',
  );
}

const firebase = createFirebaseAuth(config);
if (!firebase.sessions) {
  logger.warn(
    'FIREBASE_SERVICE_ACCOUNT_PATH is not set — deactivating a user takes effect on their next request instead of revoking sessions immediately.',
  );
}

const app = createApp({
  config,
  db,
  logger,
  verifyIdToken: firebase.verifyIdToken,
  sessions: firebase.sessions,
  storage,
  jobs,
  sheets,
});

const server = app.listen(config.PORT, (error) => {
  if (error) throw error;
  logger.info(`API listening on http://localhost:${config.PORT}`);
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    void boss
      .stop({ graceful: true, timeout: 10_000 })
      .catch(() => undefined)
      .then(() => db.$client.end())
      .then(() => process.exit(0));
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
