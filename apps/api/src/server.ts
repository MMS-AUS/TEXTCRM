import { createApp } from './app.ts';
import { createFirebaseVerifier } from './auth/firebase.ts';
import { loadConfig, type Config } from './config.ts';
import { createDb } from './db/client.ts';
import { createLogger } from './logger.ts';

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = createLogger(config);
const db = createDb(config.DATABASE_URL);
const app = createApp({ config, db, logger, verifyIdToken: createFirebaseVerifier(config) });

const server = app.listen(config.PORT, (error) => {
  if (error) throw error;
  logger.info(`API listening on http://localhost:${config.PORT}`);
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    void db.$client.end().then(() => process.exit(0));
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
