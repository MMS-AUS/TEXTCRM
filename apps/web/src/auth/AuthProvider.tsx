import { FirebaseError } from 'firebase/app';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type Auth,
} from 'firebase/auth';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { workspaceGoogleProvider } from '../lib/firebase.ts';
import { trpcErrorCode, type ApiClient } from '../lib/trpc.ts';
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context.ts';

const SERVER_UNREACHABLE = 'Could not reach the CRM server. Check your connection and try again.';
const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';

/**
 * VITE_AUTH_MODE=popup uses the Google pop-up; anything else (including unset) uses a full-page
 * redirect, which works on hosts that send a Cross-Origin-Opener-Policy that blocks pop-ups.
 */
const AUTH_MODE: 'popup' | 'redirect' =
  String(import.meta.env.VITE_AUTH_MODE ?? '')
    .trim()
    .toLowerCase() === 'popup'
    ? 'popup'
    : 'redirect';

const POPUP_ERRORS: Record<string, string> = {
  'auth/popup-blocked':
    'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  'auth/unauthorized-domain':
    'This web address is not an authorised domain in Firebase (Authentication → Settings → Authorized domains).',
  'auth/admin-restricted-operation':
    'New sign-ins are blocked in Firebase (Authentication → Settings → User actions → Enable create).',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
};

/**
 * Firebase proves who the person is; the API decides whether they may use the CRM.
 * After every Firebase sign-in (or restored session) we call auth.signIn, which checks the
 * allowlist and audit-logs the attempt. A refusal signs the person straight back out.
 */
export function AuthProvider({
  auth,
  apiClient,
  children,
  allowedDomain,
}: {
  auth: Auth;
  apiClient: ApiClient;
  allowedDomain: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // Guards against calling auth.signIn twice for one Firebase user (e.g. StrictMode re-subscribe).
  const activeUid = useRef<string | null>(null);

  const endSession = useCallback(
    async (message?: string) => {
      activeUid.current = null;
      await firebaseSignOut(auth);
      setState(message ? { status: 'signedOut', message } : { status: 'signedOut' });
    },
    [auth],
  );

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        if (!user) {
          activeUid.current = null;
          setState((s) => (s.status === 'signedOut' ? s : { status: 'signedOut' }));
          return;
        }
        if (activeUid.current === user.uid) return;
        activeUid.current = user.uid;
        setState({ status: 'loading' });

        apiClient.auth.signIn.mutate().then(
          (profile) => {
            setState({ status: 'signedIn', profile });
          },
          (error: unknown) => {
            const refused = trpcErrorCode(error) === 'FORBIDDEN' && error instanceof Error;
            void endSession(refused ? error.message : SERVER_UNREACHABLE);
          },
        );
      }),
    [auth, apiClient, endSession],
  );

  // Back from Google after a redirect: onAuthStateChanged signs the person in; this only
  // surfaces a failed attempt (e.g. an unauthorised domain) that would otherwise be silent.
  useEffect(() => {
    if (AUTH_MODE !== 'redirect') return;
    getRedirectResult(auth).catch((error: unknown) => {
      const code = error instanceof FirebaseError ? error.code : '';
      console.error('Google sign-in failed', error);
      setState({
        status: 'signedOut',
        message: POPUP_ERRORS[code] ?? 'Sign-in failed. Please try again.',
      });
    });
  }, [auth]);

  const signInWithGoogle = useCallback(async () => {
    try {
      const provider = workspaceGoogleProvider(allowedDomain);
      if (AUTH_MODE === 'redirect') {
        await signInWithRedirect(auth, provider); // leaves the page; the result is read on return
        return;
      }
      await signInWithPopup(auth, provider);
    } catch (error) {
      const code = error instanceof FirebaseError ? error.code : '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      console.error('Google sign-in failed', error);
      setState({
        status: 'signedOut',
        message: POPUP_ERRORS[code] ?? 'Sign-in failed. Please try again.',
      });
    }
  }, [auth, allowedDomain]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signInWithGoogle,
      signOut: () => endSession(),
      expireSession: (message) => endSession(message ?? SESSION_EXPIRED),
    }),
    [state, signInWithGoogle, endSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
