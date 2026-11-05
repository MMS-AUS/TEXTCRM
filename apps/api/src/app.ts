import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { HealthResponse } from '@mms/shared';
import type { SessionRevoker, VerifyIdToken } from './auth/types.ts';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import type { Logger } from './logger.ts';
import type { JobQueue } from './jobs/queue.ts';
import { oauthCallbacks } from './integrations/routes.ts';
import type { PushVerifier } from './integrations/pubsub.ts';
import { providerWebhooks } from './integrations/webhooks.ts';
import { createIntegrations, type Integrations } from './integrations/service.ts';
import type { SheetsReader } from './modules/imports/google-sheets.ts';
import type { Storage } from './storage/storage.ts';
import { createContextFactory } from './trpc/context.ts';
import { appRouter } from './trpc/router.ts';

export interface AppDeps {
  config: Pick<Config, 'APP_URL' | 'ALLOWED_EMAIL_DOMAIN'> &
    Partial<Pick<Config, 'SHEETS_SYNC_INTERVAL_MINUTES'>>;
  db: Db;
  logger: Logger;
  verifyIdToken: VerifyIdToken;
  /** Null when file storage isn't configured. */
  storage: Storage | null;
  jobs: JobQueue | null;
  /** Null when the Google service account isn't configured. */
  sheets: SheetsReader | null;
  /** Null without the Firebase service account. */
  sessions?: SessionRevoker | null;
  /** Defaults to nothing configured (tests). */
  integrations?: Integrations;
  /** Checks Gmail push tokens; defaults to Google's signing keys (a local key set in tests). */
  gmailPushVerifier?: PushVerifier;
}

const REQUEST_ID_PATTERN = /^[\w-]{1,128}$/;

export function createApp(appDeps: AppDeps) {
  const deps = {
    ...appDeps,
    integrations: appDeps.integrations ?? createIntegrations({ APP_URL: appDeps.config.APP_URL }),
  };
  const app = express();
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger: deps.logger,
      // Reuse a caller-supplied request ID (e.g. from the reverse proxy) or mint one; echo it back.
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
            ? incoming
            : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: deps.config.APP_URL }));

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok' };
    res.json(body);
  });

  // Stricter limit on sign-in attempts; a general ceiling on everything else.
  app.use(/^\/api\/trpc\/.*auth\.signIn/, limiter(20));
  app.use(
    '/api/trpc',
    limiter(600),
    express.json({ limit: '1mb' }),
    createExpressMiddleware({
      router: appRouter,
      createContext: createContextFactory(deps),
      onError: ({ error, path, ctx }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          (ctx?.log ?? deps.logger).error({ err: error, path }, 'tRPC procedure failed');
        }
      },
    }),
  );

  // OAuth callbacks for Gmail and Xero (Phase 5), at the paths in the redirect URIs.
  app.use(/^\/api\/integrations\/.*\/callback/, limiter(30));
  app.use(oauthCallbacks({ db: deps.db, integrations: deps.integrations, logger: deps.logger }));

  // Reserved for third-party callbacks (Phase 5). Each route there must verify its signature/secret.
  app.use(
    '/webhooks',
    limiter(300),
    providerWebhooks({
      db: deps.db,
      integrations: deps.integrations,
      logger: deps.logger,
      jobs: deps.jobs,
      gmailPushVerifier: deps.gmailPushVerifier,
    }),
  );
  app.use('/oauth', limiter(30), express.Router());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/** Requests per minute per IP. */
function limiter(limitPerMinute: number): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: limitPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
}

const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: 'Not Found', requestId: req.id });
};

// Last stop for errors outside tRPC (e.g. oversized or malformed JSON). No stack traces to clients.
const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const status =
    typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
      ? err.status
      : 500;
  if (status >= 500) req.log.error({ err }, 'Unhandled error');
  res.status(status).json({ error: STATUS_CODES[status] ?? 'Error', requestId: req.id });
};
