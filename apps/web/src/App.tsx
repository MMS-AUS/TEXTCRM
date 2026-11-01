import type { Auth } from 'firebase/auth';
import { AuthProvider } from './auth/AuthProvider.tsx';
import { RequireAuth } from './auth/RequireAuth.tsx';
import type { ApiClient } from './lib/trpc.ts';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { QueryLayer } from './providers/QueryLayer.tsx';

// Routing (TanStack Router, 404/error pages) arrives with the app shell in Step 1.3.
export function App({
  firebaseAuth,
  apiClient,
  allowedDomain,
}: {
  firebaseAuth: Auth;
  apiClient: ApiClient;
  allowedDomain: string;
}) {
  return (
    <AuthProvider auth={firebaseAuth} apiClient={apiClient} allowedDomain={allowedDomain}>
      <QueryLayer apiClient={apiClient}>
        <RequireAuth>
          <DashboardPage />
        </RequireAuth>
      </QueryLayer>
    </AuthProvider>
  );
}
