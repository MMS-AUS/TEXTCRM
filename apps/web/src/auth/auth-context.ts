import { createContext, useContext } from 'react';
import type { RouterOutputs } from '../lib/trpc.ts';

export type Profile = RouterOutputs['auth']['signIn'];

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; message?: string }
  | { status: 'signedIn'; profile: Profile };

export interface AuthContextValue {
  state: AuthState;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Called when the API rejects the session; signs out and shows `message` on the login screen. */
  expireSession: (message?: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** The signed-in user's profile. Only for components rendered inside <RequireAuth>. */
export function useProfile(): Profile {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useProfile must be used inside <RequireAuth>');
  return state.profile;
}
