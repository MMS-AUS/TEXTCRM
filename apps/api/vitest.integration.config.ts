import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('../../.env')) process.loadEnvFile('../../.env');

// Integration tests run against the crm_test database (DATABASE_URL_TEST), one file at a time
// because they share it. Requires `npm run db:up`.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
