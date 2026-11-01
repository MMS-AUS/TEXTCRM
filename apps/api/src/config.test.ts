import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const valid = {
  APP_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://crm:crm@localhost:5432/crm',
  ALLOWED_EMAIL_DOMAIN: 'MakeMySolar.com.au',
  FIREBASE_PROJECT_ID: 'mms-crm',
};

describe('loadConfig', () => {
  it('applies defaults and normalises values', () => {
    const config = loadConfig({ ...valid, FIREBASE_SERVICE_ACCOUNT_PATH: '' });
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      ALLOWED_EMAIL_DOMAIN: 'makemysolar.com.au',
      FIREBASE_SERVICE_ACCOUNT_PATH: undefined,
    });
  });

  it('fails fast listing every problem', () => {
    const load = () => loadConfig({ ...valid, FIREBASE_PROJECT_ID: '', APP_URL: 'nope' });
    expect(load).toThrow('FIREBASE_PROJECT_ID');
    expect(load).toThrow('APP_URL');
  });
});
