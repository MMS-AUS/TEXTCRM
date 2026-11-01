import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Config } from '../config.ts';
import type { VerifyIdToken } from './types.ts';

/**
 * Verifying ID tokens only needs the project ID (Google's public keys are fetched automatically).
 * With a service account we also check for revoked sessions on every request.
 */
export function createFirebaseVerifier(
  config: Pick<Config, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_PATH'>,
): VerifyIdToken {
  const serviceAccountPath = config.FIREBASE_SERVICE_ACCOUNT_PATH;
  const app = initializeApp({
    projectId: config.FIREBASE_PROJECT_ID,
    ...(serviceAccountPath ? { credential: cert(serviceAccountPath) } : {}),
  });
  const auth = getAuth(app);
  const checkRevoked = serviceAccountPath !== undefined;

  return async (idToken) => {
    const decoded = await auth.verifyIdToken(idToken, checkRevoked);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: decoded.email_verified === true,
      signInProvider: decoded.firebase.sign_in_provider,
    };
  };
}
