import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../auth/auth-context.ts';
import { TRPCProvider, trpcErrorCode, type ApiClient } from '../lib/trpc.ts';

const DO_NOT_RETRY = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'BAD_REQUEST', 'NOT_FOUND']);

/**
 * TanStack Query + tRPC. The cache is rebuilt whenever the signed-in user changes, so one
 * person's data can never show for the next. Any UNAUTHORIZED response ends the session.
 */
export function QueryLayer({ apiClient, children }: { apiClient: ApiClient; children: ReactNode }) {
  const { state, expireSession } = useAuth();
  const userKey = state.status === 'signedIn' ? state.profile.id : 'anonymous';
  return (
    <UserQueryScope key={userKey} apiClient={apiClient} onUnauthorized={expireSession}>
      {children}
    </UserQueryScope>
  );
}

function UserQueryScope({
  apiClient,
  onUnauthorized,
  children,
}: {
  apiClient: ApiClient;
  onUnauthorized: (message?: string) => Promise<void>;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => {
    const onError = (error: unknown) => {
      if (trpcErrorCode(error) === 'UNAUTHORIZED') {
        void onUnauthorized(error instanceof Error ? error.message : undefined);
      }
    };
    return new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: {
          retry: (failureCount, error) =>
            !DO_NOT_RETRY.has(trpcErrorCode(error) ?? '') && failureCount < 2,
        },
      },
    });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={apiClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
