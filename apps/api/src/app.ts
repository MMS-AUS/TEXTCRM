import express from 'express';
import type { HealthResponse } from '@mms/shared';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok' };
    res.json(body);
  });

  return app;
}
