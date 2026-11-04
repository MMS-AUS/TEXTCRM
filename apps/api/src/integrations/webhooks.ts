import express, { Router, type RequestHandler } from 'express';
import type { Db } from '../db/client.ts';
import type { Logger } from '../logger.ts';
import {
  handleDeliveryReports,
  handleInboundSms,
  verifyWebhookToken,
  type WebhookKind,
} from '../modules/messaging/service.ts';
import type { Integrations } from './service.ts';

// Provider callbacks (Phase 5). MessageMedia calls the URL we registered; the `token` in it is
// an HMAC with MESSAGEMEDIA_WEBHOOK_SECRET, checked in constant time. Anything else is 401.
// A handled (or harmlessly ignored) callback answers 200 so MessageMedia stops retrying.

export function providerWebhooks(deps: {
  db: Db;
  integrations: Integrations;
  logger: Logger;
}): Router {
  const routes = Router();
  routes.use(express.json({ limit: '256kb' }));

  const messageMedia =
    (kind: WebhookKind): RequestHandler =>
    (req, res, next) => {
      if (!deps.integrations.webhookSecret) {
        res.status(503).json({ error: 'Webhooks are not configured' });
        return;
      }
      if (!verifyWebhookToken(deps.integrations.webhookSecret, kind, req.query.token)) {
        deps.logger.warn({ kind, ip: req.ip }, 'MessageMedia webhook with a bad token refused');
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const work =
        kind === 'delivery'
          ? handleDeliveryReports(deps.db, req.body, deps.logger)
          : handleInboundSms(deps.db, req.body, deps.logger);
      work
        .then((result) => {
          res.status(200).json(result);
        })
        // A real failure is a 500, so MessageMedia retries it later.
        .catch(next);
    };

  routes.post('/messagemedia/delivery', messageMedia('delivery'));
  routes.post('/messagemedia/inbound', messageMedia('inbound'));
  return routes;
}
