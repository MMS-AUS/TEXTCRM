import type { PermissionMatrix } from '@mms/shared';

/** The parts of a verified Firebase ID token we rely on. */
export interface VerifiedToken {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  /** e.g. 'google.com'. */
  signInProvider: string;
}

/** Throws if the token is missing, malformed, expired, for another project, or revoked. */
export type VerifyIdToken = (idToken: string) => Promise<VerifiedToken>;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  role: { key: string; name: string };
  permissions: PermissionMatrix;
}

export type DenyReason =
  'not_google' | 'email_not_verified' | 'wrong_domain' | 'unknown_user' | 'inactive_user';

export type AuthState =
  /** No Authorization header. */
  | { status: 'anonymous' }
  /** A token was sent but failed verification (bad, expired, revoked). */
  | { status: 'invalid' }
  /** A genuine Google identity that is not allowed into the CRM. */
  | { status: 'denied'; reason: DenyReason; email: string | null; userId: string | null }
  | { status: 'authenticated'; user: AuthUser; firebaseUid: string };
