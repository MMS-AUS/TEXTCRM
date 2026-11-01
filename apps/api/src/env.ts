import { z } from 'zod';

// Minimal for now; the full fail-fast config loader (every §2.3 variable) arrives in Step 0.6.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

export function requireDatabaseUrl(name: 'DATABASE_URL' | 'DATABASE_URL_TEST'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env in the repo root.`);
  }
  return value;
}
