import { pino, type Logger } from 'pino';
import type { Config } from './config.ts';

export type { Logger };

export function createLogger(config: Pick<Config, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    // Tokens and cookies never reach the logs.
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  });
}
