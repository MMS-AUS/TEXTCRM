import { Router, type RequestHandler } from 'express';
import type { Db } from '../db/client.ts';
import type { Logger } from '../logger.ts';
import { completeOAuth, type Integrations } from './service.ts';

// The OAuth callbacks (Phase 5): the provider redirects the browser here with ?code&state.
// They are plain routes (not tRPC) because the browser arrives without the CRM's bearer
// token — the single-use state, bound to the user who started, is what authenticates them.

/** The path part of a configured redirect URI, or the default. */
export function callbackPath(redirectUri: string | undefined, fallback: string) {
  if (!redirectUri) return fallback;
  try {
    return new URL(redirectUri).pathname;
  } catch {
    return fallback;
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

export function oauthCallbacks(deps: {
  db: Db;
  integrations: Integrations;
  logger: Logger;
}): Router {
  const routes = Router();
  const handler =
    (provider: 'gmail' | 'xero'): RequestHandler =>
    (req, res, next) => {
      completeOAuth(
        deps.db,
        deps.integrations,
        provider,
        { state: text(req.query.state), code: text(req.query.code), error: text(req.query.error) },
        deps.logger,
      )
        .then((location) => {
          res.redirect(302, location);
        })
        .catch(next);
    };
  routes.get(
    callbackPath(deps.integrations.gmail?.redirectUri, '/api/integrations/gmail/callback'),
    handler('gmail'),
  );
  routes.get(
    callbackPath(deps.integrations.xero?.redirectUri, '/api/integrations/xero/callback'),
    handler('xero'),
  );
  return routes;
}
