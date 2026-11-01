import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// npm runs workspace scripts from apps/api, so the repo-root .env is two levels up.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
