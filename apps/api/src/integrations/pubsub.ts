import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

// Gmail push notifications (Step 5.2, §2.2). Pub/Sub calls /webhooks/gmail with a Google-signed
// OIDC token in `Authorization: Bearer …`. It is accepted only if Google signed it, it is for our
// audience (GMAIL_PUSH_AUDIENCE) and — when set — it came from the push subscription's service
// account (GMAIL_PUSH_SERVICE_ACCOUNT). Anything else is refused.

const GOOGLE_CERTS = new URL('https://www.googleapis.com/oauth2/v3/certs');
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export type GmailPushConfig = {
  /** projects/<project>/topics/<topic> — what Gmail publishes to. */
  topic: string | null;
  /** The audience set on the push subscription; tokens for anything else are refused. */
  audience: string | null;
  /** The push subscription's service account email (recommended). */
  serviceAccount: string | null;
};

export type PushVerifier = (authorization: string | undefined) => Promise<boolean>;

let googleKeys: JWTVerifyGetKey | null = null;

/** Checks a push request's bearer token. `keys` is Google's key set (a local one in tests). */
export function pushVerifier(
  config: GmailPushConfig,
  keys: JWTVerifyGetKey = (googleKeys ??= createRemoteJWKSet(GOOGLE_CERTS)),
): PushVerifier {
  return async (authorization) => {
    if (!config.audience) return false;
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    if (!token) return false;
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: GOOGLE_ISSUERS,
        audience: config.audience,
        algorithms: ['RS256'],
        clockTolerance: 60,
      });
      if (config.serviceAccount) {
        return payload.email === config.serviceAccount && payload.email_verified === true;
      }
      return true;
    } catch {
      return false;
    }
  };
}

/** The notification inside a push body: which mailbox changed and up to which history ID. */
export function parsePush(body: unknown): { emailAddress: string; historyId: string } | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;
  const message = body.message as { data?: unknown } | null;
  if (typeof message?.data !== 'string') return null;
  try {
    const data = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8')) as {
      emailAddress?: unknown;
      historyId?: unknown;
    };
    if (typeof data.emailAddress !== 'string') return null;
    return {
      emailAddress: data.emailAddress.toLowerCase(),
      historyId:
        typeof data.historyId === 'string' || typeof data.historyId === 'number'
          ? String(data.historyId)
          : '',
    };
  } catch {
    return null;
  }
}
