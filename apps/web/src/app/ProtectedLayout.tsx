import { Outlet } from '@tanstack/react-router';
import type { Auth } from 'firebase/auth';
import { AuthProvider } from '../auth/AuthProvider.tsx';
import { RequireAuth } from '../auth/RequireAuth.tsx';
import type { ApiClient } from '../lib/trpc.ts';
import { ConfigErrorPage } from '../pages/ConfigErrorPage.tsx';
import { QueryLayer } from '../providers/QueryLayer.tsx';
import { AppShell } from './shell/AppShell.tsx';

export type AppServices = {
  firebaseAuth: Auth;
  apiClient: ApiClient;
  allowedDomain: string;
};

/**
 * Every signed-in page renders inside this: Firebase auth, the API client, the sign-in gate
 * (login screen at the same URL when signed out) and the app shell.
 */
export function ProtectedLayout({
  services,
  missingConfig,
}: {
  services: AppServices | null;
  missingConfig: string[];
}) {
  if (!services) return <ConfigErrorPage missing={missingConfig} />;
  return (
    <AuthProvider
      auth={services.firebaseAuth}
      apiClient={services.apiClient}
      allowedDomain={services.allowedDomain}
    >
      <QueryLayer apiClient={services.apiClient}>
        <RequireAuth>
          <AppShell>
            <Outlet />
          </AppShell>
        </RequireAuth>
      </QueryLayer>
    </AuthProvider>
  );
}
