import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { vi } from 'vitest';
import { emptyPermissionMatrix, FEATURES } from '@mms/shared';
import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
  type Profile,
} from '../auth/auth-context.ts';
import { createApiClient, TRPCProvider } from '../lib/trpc.ts';

export type TrpcCall = { path: string; input: unknown };

/**
 * A fetch that answers tRPC batch requests from a map of procedure path → data. Every call
 * (queries and mutations, with their input) is pushed to `calls` when given.
 */
export function fakeTrpcFetch(
  responses: Record<string, unknown>,
  calls?: TrpcCall[],
): typeof fetch {
  return (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, 'http://localhost');
    const paths = decodeURIComponent(url.pathname.replace('/api/trpc/', '')).split(',');
    const rawInputs =
      typeof init?.body === 'string' ? init.body : (url.searchParams.get('input') ?? '{}');
    const inputs = JSON.parse(rawInputs) as Record<string, unknown>;
    paths.forEach((path, index) => calls?.push({ path, input: inputs[String(index)] }));
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

/** A signed-in user allowed everything (for screens whose tests aren't about permissions). */
export function fullAccessProfile(): Profile {
  const permissions = emptyPermissionMatrix();
  for (const feature of FEATURES) {
    permissions[feature] = { view: true, create: true, edit: true, delete: true, export: true };
  }
  return { ...fakeProfile, permissions };
}

type ProviderOptions = {
  auth: AuthContextValue;
  responses?: Record<string, unknown>;
  calls?: TrpcCall[];
};

function Providers({
  auth,
  responses = {},
  calls,
  children,
}: ProviderOptions & { children: ReactNode }) {
  const [clients] = useState(() => ({
    apiClient: createApiClient(() => Promise.resolve(null), fakeTrpcFetch(responses, calls)),
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  }));
  return (
    <AuthContext.Provider value={auth}>
      <QueryClientProvider client={clients.queryClient}>
        <TRPCProvider trpcClient={clients.apiClient} queryClient={clients.queryClient}>
          {children}
        </TRPCProvider>
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

export function renderWithProviders(ui: ReactElement, options: ProviderOptions) {
  return render(<Providers {...options}>{ui}</Providers>);
}

/**
 * Renders `ui` at `path` inside a real router (so links, URL params and search params work).
 * Other app paths exist as stubs that print their path. Returns the router to inspect the URL.
 */
export function renderPage(
  ui: ReactElement,
  { path, url = path, ...options }: ProviderOptions & { path: string; url?: string },
) {
  const root = createRootRoute({
    component: () => (
      <Providers {...options}>
        <Outlet />
      </Providers>
    ),
  });
  const stubs = [
    '/contacts',
    '/contacts/$contactId',
    '/companies',
    '/companies/$companyId',
    '/leads/$leadId',
    '/settings',
    '/settings/imports',
    '/settings/imports/$importId',
    '/settings/sheet-sync',
    '/settings/sheet-sync/new',
    '/settings/sheet-sync/$sourceId',
  ]
    .filter((stub) => stub !== path)
    .map((stub) =>
      createRoute({ getParentRoute: () => root, path: stub, component: () => <p>at {stub}</p> }),
    );
  const page = createRoute({ getParentRoute: () => root, path, component: () => ui });
  const router = createRouter({
    routeTree: root.addChildren([page, ...stubs]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}
