import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { HealthResponse } from '@mms/shared';
import type { VerifyIdToken } from './auth/types.ts';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import type { Logger } from './logger.ts';
import type { JobQueue } from './jobs/queue.ts';
import type { SheetsReader } from './modules/imports/google-sheets.ts';
import type { Storage } from './storage/storage.ts';
import { createContextFactory } from './trpc/context.ts';
import { appRouter } from './trpc/router.ts';

export interface AppDeps {
  config: Pick<Config, 'APP_URL' | 'ALLOWED_EMAIL_DOMAIN'>;
  db: Db;
  logger: Logger;
  verifyIdToken: VerifyIdToken;
  /** Null when file storage isn't configured. */
  storage: Storage | null;
  jobs: JobQueue | null;
  /** Null when the Google service account isn't configured. */
  sheets: SheetsReader | null;
}

const REQUEST_ID_PATTERN = /^[\w-]{1,128}$/;

export function createApp(deps: AppDeps) {
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

  // Reserved for third-party callbacks (Phase 5). Each route there must verify its signature/secret.
  app.use('/webhooks', limiter(300), express.Router());
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
