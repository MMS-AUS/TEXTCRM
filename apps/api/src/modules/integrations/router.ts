import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  hasPermission,
  INTEGRATION_INFO,
  integrationProviderSchema,
  messageMediaCredentialsSchema,
  xeroTenantSchema,
  type IntegrationProvider,
} from '@mms/shared';
import type { AuthUser } from '../../auth/types.ts';
import { ProviderError } from '../../integrations/http.ts';
import {
  disconnect,
  IntegrationUserError,
  integrationStatus,
  saveMessageMedia,
  selectXeroTenant,
  startOAuth,
  testConnection,
} from '../../integrations/service.ts';
import { permissionProcedure, protectedProcedure, router } from '../../trpc/trpc.ts';

// Integrations API (Phase 5, backend only). Gmail is each person's own mailbox; Xero and
// MessageMedia belong to the business and need the integrations permission.

/** Organisation integrations need integrations:edit to change; your own mailbox doesn't. */
function assertMayManage(user: AuthUser, provider: IntegrationProvider) {
  if (
    INTEGRATION_INFO[provider].owner === 'organisation' &&
    !hasPermission(user.permissions, 'integrations', 'edit')
  ) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your role does not allow this action.' });
  }
}

/** Provider and configuration problems reach the user as clear 400s. */
async function friendly<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof IntegrationUserError || error instanceof ProviderError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    }
    throw error;
  }
}

const actorOf = (ctx: {
  user: { id: string };
  meta: { requestId: string; ipAddress: string | null; userAgent: string | null };
}) => ({
  userId: ctx.user.id,
  meta: ctx.meta,
});

export const integrationsRouter = router({
  /** Every integration this user can see: set up?, connected?, account, last check. */
  status: protectedProcedure.query(({ ctx }) =>
    integrationStatus(
      ctx.db,
      ctx.integrations,
      ctx.user,
      hasPermission(ctx.user.permissions, 'integrations', 'view'),
    ),
  ),

  /** Starts OAuth: returns the provider's sign-in URL for the browser to open. */
  connect: protectedProcedure
    .input(z.object({ provider: z.enum(['gmail', 'xero']) }))
    .mutation(async ({ ctx, input }) => {
      assertMayManage(ctx.user, input.provider);
      return {
        url: await friendly(() => startOAuth(ctx.db, ctx.integrations, input.provider, ctx.user)),
      };
    }),

  /** A real read-only call to the provider; the result is also saved on the connection. */
  test: protectedProcedure.input(integrationProviderSchema).mutation(({ ctx, input }) => {
    assertMayManage(ctx.user, input.provider);
    return friendly(() => testConnection(ctx.db, ctx.integrations, input.provider, ctx.user));
  }),

  disconnect: protectedProcedure.input(integrationProviderSchema).mutation(({ ctx, input }) => {
    assertMayManage(ctx.user, input.provider);
    return friendly(() =>
      disconnect(ctx.db, ctx.integrations, input.provider, ctx.user, actorOf(ctx)),
    );
  }),

  /** MessageMedia has no OAuth: the API key and secret are checked, then stored encrypted. */
  saveMessageMediaCredentials: permissionProcedure('integrations', 'edit')
    .input(messageMediaCredentialsSchema)
    .mutation(async ({ ctx, input }) => {
      await friendly(() => saveMessageMedia(ctx.db, ctx.integrations, input, actorOf(ctx)));
      return { saved: true };
    }),

  /** When Xero offered several organisations, which one the CRM uses. */
  selectXeroTenant: permissionProcedure('integrations', 'edit')
    .input(xeroTenantSchema)
    .mutation(({ ctx, input }) =>
      friendly(() => selectXeroTenant(ctx.db, ctx.integrations, input.tenantId, actorOf(ctx))),
    ),
});
