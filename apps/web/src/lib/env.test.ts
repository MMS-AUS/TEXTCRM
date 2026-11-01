import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env.ts';

describe('parseWebEnv', () => {
  it('lists every missing or empty variable', () => {
    const result = parseWebEnv({ VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_APP_ID: '' });
    expect(result).toEqual({
      ok: false,
      missing: [
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_APP_ID',
        'VITE_ALLOWED_EMAIL_DOMAIN',
      ],
    });
  });

  it('accepts a complete config and lower-cases the domain', () => {
    const result = parseWebEnv({
      VITE_FIREBASE_API_KEY: 'k',
      VITE_FIREBASE_AUTH_DOMAIN: 'mms-crm.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'mms-crm',
      VITE_FIREBASE_APP_ID: '1:2:web:3',
      VITE_ALLOWED_EMAIL_DOMAIN: 'MakeMySolar.com.au',
    });
    expect(result.ok && result.env.VITE_ALLOWED_EMAIL_DOMAIN).toBe('makemysolar.com.au');
  });
});
