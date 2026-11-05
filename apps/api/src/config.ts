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
  /**
   * Google Sheets (Steps 3.2/3.3): path to the service-account JSON key, kept outside the repo.
   * Optional: without it, uploads still import and the Google options explain what's missing.
   */
  GOOGLE_SERVICE_ACCOUNT_PATH: optionalString,
  SHEETS_SYNC_INTERVAL_MINUTES: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).max(60).default(5),
  ),
  /**
   * Integrations (Phase 5). All optional: a provider without its settings reports
   * "not configured" instead of failing. TOKEN_ENCRYPTION_KEY (32 random bytes, base64)
   * encrypts every stored token and API secret; without a valid one nothing can connect.
   */
  TOKEN_ENCRYPTION_KEY: optionalString,
  GOOGLE_OAUTH_CLIENT_ID: optionalString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalString,
  GOOGLE_OAUTH_REDIRECT_URI: optionalString,
  /** Gmail inbox push (§2.2): projects/<project>/topics/<topic>. Without it the inbox is polled. */
  GMAIL_PUBSUB_TOPIC: optionalString,
  /** The audience on the Pub/Sub push subscription's token; push is refused without it. */
  GMAIL_PUSH_AUDIENCE: optionalString,
  /** The push subscription's service account email; when set, only its tokens are accepted. */
  GMAIL_PUSH_SERVICE_ACCOUNT: optionalString,
  XERO_CLIENT_ID: optionalString,
  XERO_CLIENT_SECRET: optionalString,
  XERO_REDIRECT_URI: optionalString,
  MESSAGEMEDIA_API_KEY: optionalString,
  MESSAGEMEDIA_API_SECRET: optionalString,
  MESSAGEMEDIA_DEFAULT_SENDER: optionalString,
  /** Signs MessageMedia webhook URLs (any long random string; we generate it). */
  MESSAGEMEDIA_WEBHOOK_SECRET: optionalString,
  /**
   * The API's public address, for callbacks providers make (e.g. SMS delivery reports).
   * A localhost address can't be reached from the internet, so those callbacks are skipped.
   */
  API_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
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
