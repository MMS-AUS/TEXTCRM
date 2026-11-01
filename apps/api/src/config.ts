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
