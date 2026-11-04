import { createHash, randomBytes } from 'node:crypto';

// OAuth helpers shared by Gmail and Xero: random state, PKCE (RFC 7636, S256), token expiry.

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function pkce() {
  const verifier = randomToken(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** ISO time the access token stops working. */
  expiresAt: string;
  scopes: string[];
};

export const expiresIn = (seconds: unknown, now = Date.now()) =>
  new Date(
    now + (typeof seconds === 'number' && seconds > 0 ? seconds : 1800) * 1000,
  ).toISOString();

/** Refresh a couple of minutes early so a token never expires mid-request. */
export const needsRefresh = (tokens: OAuthTokens, now = Date.now()) =>
  Date.parse(tokens.expiresAt) - now < 120_000;

/** The claims of a JWT, without verifying it — only for tokens received directly over TLS. */
export function jwtClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}
