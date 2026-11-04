import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Secrets at rest (Phase 5): AES-256-GCM with TOKEN_ENCRYPTION_KEY. Each value gets its own
// random 12-byte IV; the auth tag makes any tampering fail loudly. Format:
//   v1.<iv base64url>.<tag base64url>.<ciphertext base64url>
// The version prefix leaves room for key rotation later.

export type EncryptionKey = { ok: true; key: Buffer } | { ok: false; problem: string };

export const KEY_HELP =
  "Generate one with: node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64'))\" and set TOKEN_ENCRYPTION_KEY in .env.";

/** Reads TOKEN_ENCRYPTION_KEY: 32 bytes in base64 (or base64url). */
export function parseEncryptionKey(value: string | undefined): EncryptionKey {
  if (!value) return { ok: false, problem: `TOKEN_ENCRYPTION_KEY is not set. ${KEY_HELP}` };
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== 32) {
    return {
      ok: false,
      problem: `TOKEN_ENCRYPTION_KEY must be 32 random bytes in base64 (it is ${String(key.length)} bytes). ${KEY_HELP}`,
    };
  }
  return { ok: true, key };
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    data.toString('base64url'),
  ].join('.');
}

export class DecryptError extends Error {}

export function decryptSecret(key: Buffer, payload: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) {
    throw new DecryptError('Stored secret is in an unknown format.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new DecryptError(
      "Stored secret can't be decrypted — TOKEN_ENCRYPTION_KEY has changed. Reconnect the integration.",
    );
  }
}

export const encryptJson = (key: Buffer, value: object) =>
  encryptSecret(key, JSON.stringify(value));
// T names the shape we encrypted ourselves with encryptJson; it isn't validated again.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export const decryptJson = <T>(key: Buffer, payload: string): T =>
  JSON.parse(decryptSecret(key, payload)) as T;
