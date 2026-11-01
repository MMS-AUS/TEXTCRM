import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import type { WebEnv } from './env.ts';

export function createFirebaseAuth(env: WebEnv): Auth {
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  return getAuth(app);
}

export function workspaceGoogleProvider(domain: string): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  // `hd` only narrows Google's account chooser to the Workspace domain. The API enforces the
  // domain and the users allowlist — this is a convenience, not a security control.
  provider.setCustomParameters({ hd: domain, prompt: 'select_account' });
  return provider;
}
