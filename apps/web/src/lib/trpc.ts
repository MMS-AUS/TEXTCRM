import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import type { AppRouter } from '@mms/api/trpc';

export type { RouterOutputs } from '@mms/api/trpc';

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

/** Every request carries the current Firebase ID token (refreshed by Firebase when near expiry). */
export function createApiClient(
  getIdToken: () => Promise<string | null>,
  fetchImpl?: typeof fetch,
  apiUrl?: string,
) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${apiUrl?.replace(/\/+$/, '') ?? ''}/api/trpc`,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
        async headers() {
          const token = await getIdToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The tRPC error code (e.g. 'UNAUTHORIZED') of a failed call, if it reached the API. */
export function trpcErrorCode(error: unknown): string | undefined {
  if (!(error instanceof TRPCClientError)) return undefined;
  const data: unknown = error.data;
  if (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    typeof data.code === 'string'
  ) {
    return data.code;
  }
  return undefined;
}
