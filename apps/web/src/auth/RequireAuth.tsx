import type { ReactNode } from 'react';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { LoginPage } from '../pages/LoginPage.tsx';
import { useAuth } from './auth-context.ts';

/** Renders `children` only for a signed-in, allowlisted user; otherwise the login screen. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'loading') return <FullPageMessage>Checking your session…</FullPageMessage>;
  if (state.status === 'signedOut') return <LoginPage />;
  return children;
}
