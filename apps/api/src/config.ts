import { z } from 'zod';

/** Treats `KEY=` (empty) in .env the same as an unset variable. */
const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().optional(),
);

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_URL: z.url(),
  DATABASE_URL: z.url(),
  ALLOWED_EMAIL_DOMAIN: z.string().trim().toLowerCase().min(3),
  FIREBASE_PROJECT_ID: z.string().trim().min(1, 'required — see §2.2 Firebase console setup'),
  /** Optional for now: enables revoked-session checks. Required once users can be deactivated (Step 2.10). */
  FIREBASE_SERVICE_ACCOUNT_PATH: optionalString,
  /**
   * File storage (S3-compatible: Cloudflare R2 in production, the local container in
   * development). All optional: without them the app runs and file features explain what's missing.
   */
  S3_ENDPOINT: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  S3_REGION: optionalString,
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  /** true for local S3 servers (bucket in the path); false for R2. */
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false', ''])
    .optional()
    .transform((value) => value === 'true'),
});

export type Config = z.infer<typeof configSchema>;

/** Validates the environment once at startup and fails fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration in .env:\n${problems.join('\n')}`);
  }
  return result.data;
}
