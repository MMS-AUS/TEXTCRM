import type { AuthState, AuthUser, DenyReason, VerifyIdToken } from './types.ts';

export interface AuthenticateDeps {
  verifyIdToken: VerifyIdToken;
  findUserByEmail: (email: string) => Promise<AuthUser | null>;
  allowedEmailDomain: string;
}

/** Shown to the person who was refused. Deliberately does not reveal whether an email exists. */
export const DENY_MESSAGES: Record<DenyReason, string> = {
  not_google: 'Sign in with Google.',
  email_not_verified: 'Your Google account email is not verified.',
  wrong_domain: 'Use your Make My Solar Google Workspace account to sign in.',
  unknown_user: 'Your account does not have access to the CRM. Ask an admin to add you.',
  inactive_user: 'Your account does not have access to the CRM. Ask an admin to add you.',
};

export type BearerToken =
  { kind: 'none' } | { kind: 'malformed' } | { kind: 'token'; token: string };

export function parseBearerToken(header: string | undefined): BearerToken {
  if (header === undefined || header === '') return { kind: 'none' };
  const token = /^Bearer ([\w.-]+)$/.exec(header)?.[1];
  return token ? { kind: 'token', token } : { kind: 'malformed' };
}

/**
 * Turns an Authorization header into an AuthState. A request is authenticated only when the
 * Firebase token is valid AND it is a verified Google identity in the allowed Workspace domain
 * AND that email is an active row in `users` (the allowlist).
 */
export async function authenticate(
  authorizationHeader: string | undefined,
  deps: AuthenticateDeps,
): Promise<AuthState> {
  const bearer = parseBearerToken(authorizationHeader);
  if (bearer.kind === 'none') return { status: 'anonymous' };
  if (bearer.kind === 'malformed') return { status: 'invalid' };

  let verified;
  try {
    verified = await deps.verifyIdToken(bearer.token);
  } catch {
    return { status: 'invalid' };
  }

  const email = verified.email?.trim().toLowerCase() ?? null;
  const deny = (reason: DenyReason, userId: string | null = null): AuthState => ({
    status: 'denied',
    reason,
    email,
    userId,
  });

  if (verified.signInProvider !== 'google.com') return deny('not_google');
  if (!email || !verified.emailVerified) return deny('email_not_verified');
  if (!email.endsWith(`@${deps.allowedEmailDomain}`)) return deny('wrong_domain');

  const user = await deps.findUserByEmail(email);
  if (!user) return deny('unknown_user');
  if (!user.isActive) return deny('inactive_user', user.id);

  return { status: 'authenticated', user, firebaseUid: verified.uid };
}
