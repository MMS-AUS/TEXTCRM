// req.log and req.id come from pino-http; load its type augmentation wherever this file is compiled
// (apps/web type-checks it too, via the AppRouter import).
/// <reference types="pino-http" />
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { authenticate } from '../auth/authenticate.ts';
import type { AuthState, SessionRevoker, VerifyIdToken } from '../auth/types.ts';
import { findUserForAuth, type RequestMeta } from '../auth/users-repo.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import type { Logger } from '../logger.ts';
import type { JobQueue } from '../jobs/queue.ts';
import type { Integrations } from '../integrations/service.ts';
import type { SheetsReader } from '../modules/imports/google-sheets.ts';
import type { Storage } from '../storage/storage.ts';

export interface Context {
  db: Db;
  log: Logger;
  auth: AuthState;
  meta: RequestMeta;
  /** Null when file storage isn't configured. */
  storage: Storage | null;
  /** Null when the job queue couldn't start (jobs are then refused with a clear message). */
  jobs: JobQueue | null;
  /** Null when GOOGLE_SERVICE_ACCOUNT_PATH isn't set. */
  sheets: SheetsReader | null;
  /** How often the live sheet sync runs (SHEETS_SYNC_INTERVAL_MINUTES). */
  syncIntervalMinutes: number;
  /** Revokes Firebase sessions on deactivation; null without the service account. */
  sessions: SessionRevoker | null;
  /** Only this Google Workspace domain can be invited (ALLOWED_EMAIL_DOMAIN). */
  allowedEmailDomain: string;
  /** Gmail, Xero, MessageMedia clients and their settings (Phase 5). */
  integrations: Integrations;
}

export interface ContextDeps {
  config: Pick<Config, 'ALLOWED_EMAIL_DOMAIN'> &
    Partial<Pick<Config, 'SHEETS_SYNC_INTERVAL_MINUTES'>>;
  db: Db;
  verifyIdToken: VerifyIdToken;
  storage: Storage | null;
  jobs: JobQueue | null;
  sheets: SheetsReader | null;
  sessions?: SessionRevoker | null;
  integrations: Integrations;
}

export function createContextFactory(deps: ContextDeps) {
  const authDeps = {
    verifyIdToken: deps.verifyIdToken,
    findUserByEmail: (email: string) => findUserForAuth(deps.db, email),
    allowedEmailDomain: deps.config.ALLOWED_EMAIL_DOMAIN,
  };

  return async ({ req }: CreateExpressContextOptions): Promise<Context> => ({
    db: deps.db,
    storage: deps.storage,
    jobs: deps.jobs,
    sheets: deps.sheets,
    sessions: deps.sessions ?? null,
    allowedEmailDomain: deps.config.ALLOWED_EMAIL_DOMAIN,
    integrations: deps.integrations,
    syncIntervalMinutes: deps.config.SHEETS_SYNC_INTERVAL_MINUTES ?? 5,
    log: req.log,
    auth: await authenticate(req.headers.authorization, authDeps),
    meta: {
      // Always a string: app.ts's genReqId mints or validates it.
      requestId: typeof req.id === 'string' ? req.id : 'unknown',
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    },
  });
}
