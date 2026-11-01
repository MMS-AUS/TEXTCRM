import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { emptyPermissionMatrix } from '@mms/shared';
import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
  type Profile,
} from '../auth/auth-context.ts';
import { createApiClient, TRPCProvider } from '../lib/trpc.ts';

/** A fetch that answers tRPC batch requests from a map of procedure path → data. */
export function fakeTrpcFetch(responses: Record<string, unknown>): typeof fetch {
  return (input) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, 'http://localhost');
    const paths = decodeURIComponent(url.pathname.replace('/api/trpc/', '')).split(',');
    const body = paths.map((path) =>
      path in responses
        ? { result: { data: responses[path] } }
        : {
            error: {
              message: `No fake for ${path}`,
              code: -32603,
              data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
            },
          },
    );
    return Promise.resolve(Response.json(body));
  };
}

export const fakeProfile: Profile = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'sam@makemysolar.com.au',
  name: 'Sam',
  role: { key: 'admin', name: 'Admin' },
  permissions: emptyPermissionMatrix(),
};

export function fakeAuth(state: AuthState): AuthContextValue {
  return {
    state,
    signInWithGoogle: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
    expireSession: vi.fn(() => Promise.resolve()),
  };
}

export function renderWithProviders(
  ui: ReactElement,
  { auth, responses = {} }: { auth: AuthContextValue; responses?: Record<string, unknown> },
) {
  const apiClient = createApiClient(() => Promise.resolve(null), fakeTrpcFetch(responses));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthContext.Provider value={auth}>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={apiClient} queryClient={queryClient}>
          {ui}
        </TRPCProvider>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}
