import { z } from 'zod';

const webEnvSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string().trim().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().trim().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().trim().min(1),
  VITE_FIREBASE_APP_ID: z.string().trim().min(1),
  VITE_ALLOWED_EMAIL_DOMAIN: z.string().trim().toLowerCase().min(3),
  /**
   * Optional. Empty/unset = same-origin `/api` (dev proxy, or a host rewrite/reverse proxy).
   * Set to the API's origin (e.g. https://api.example.com) when the API is on another domain;
   * the API's APP_URL must then be this site's origin so CORS allows it.
   */
  VITE_API_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.url().optional(),
  ),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export type WebEnvResult = { ok: true; env: WebEnv } | { ok: false; missing: string[] };

/** VITE_* values come from the repo-root .env (public Firebase web config — not secrets). */
export function parseWebEnv(source: Record<string, unknown>): WebEnvResult {
  const result = webEnvSchema.safeParse(source);
  if (result.success) return { ok: true, env: result.data };
  return { ok: false, missing: [...new Set(result.error.issues.map((i) => String(i.path[0])))] };
}
