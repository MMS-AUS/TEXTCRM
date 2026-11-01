import { initTRPC, TRPCError } from '@trpc/server';
import { z, ZodError } from 'zod';
import { hasPermission, type Feature, type PermissionAction } from '@mms/shared';
import { DENY_MESSAGES } from '../auth/authenticate.ts';
import type { Context } from './context.ts';

const isDev = process.env.NODE_ENV === 'development';

const t = initTRPC.context<Context>().create({
  isDev,
  errorFormatter({ shape, error }) {
    // Outside development, unexpected errors never leak internals (SQL, stack traces) to the client.
    const hideMessage = !isDev && error.code === 'INTERNAL_SERVER_ERROR';
    return {
      ...shape,
      message: hideMessage ? 'Something went wrong. Please try again.' : shape.message,
      data: {
        ...shape.data,
        zodError:
          error.code === 'BAD_REQUEST' && error.cause instanceof ZodError
            ? z.flattenError(error.cause)
            : null,
      },
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

/**
 * Requires a signed-in, allowlisted, active user. Every failure is UNAUTHORIZED so the web app
 * ends the session — including a user deactivated mid-session, who sees the reason on the login
 * screen. (auth.signIn uses FORBIDDEN for refusals at the moment of signing in.)
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  const { auth } = ctx;
  if (auth.status === 'authenticated') {
    return next({ ctx: { user: auth.user } });
  }
  const message =
    auth.status === 'denied'
      ? DENY_MESSAGES[auth.reason]
      : auth.status === 'invalid'
        ? 'Your session has expired. Please sign in again.'
        : 'Please sign in.';
  throw new TRPCError({ code: 'UNAUTHORIZED', message });
});

/** Requires the user's role to grant `action` on `feature` (§1.2 permission matrix). */
export function permissionProcedure(feature: Feature, action: PermissionAction) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!hasPermission(ctx.user.permissions, feature, action)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Your role does not allow this action.',
      });
    }
    return next();
  });
}
