// req.log and req.id come from pino-http; load its type augmentation wherever this file is compiled
// (apps/web type-checks it too, via the AppRouter import).
/// <reference types="pino-http" />
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { authenticate } from '../auth/authenticate.ts';
import type { AuthState, VerifyIdToken } from '../auth/types.ts';
import { findUserForAuth, type RequestMeta } from '../auth/users-repo.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import type { Logger } from '../logger.ts';

export interface Context {
  db: Db;
  log: Logger;
  auth: AuthState;
  meta: RequestMeta;
}

export interface ContextDeps {
  config: Pick<Config, 'ALLOWED_EMAIL_DOMAIN'>;
  db: Db;
  verifyIdToken: VerifyIdToken;
}

export function createContextFactory(deps: ContextDeps) {
  const authDeps = {
    verifyIdToken: deps.verifyIdToken,
    findUserByEmail: (email: string) => findUserForAuth(deps.db, email),
    allowedEmailDomain: deps.config.ALLOWED_EMAIL_DOMAIN,
  };

  return async ({ req }: CreateExpressContextOptions): Promise<Context> => ({
    db: deps.db,
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
