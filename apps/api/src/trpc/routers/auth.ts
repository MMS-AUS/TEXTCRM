import { TRPCError } from '@trpc/server';
import { DENY_MESSAGES } from '../../auth/authenticate.ts';
import type { AuthUser } from '../../auth/types.ts';
import { recordSignIn, recordSignInDenied } from '../../auth/users-repo.ts';
import { protectedProcedure, publicProcedure, router } from '../trpc.ts';

function toProfile(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: user.permissions,
  };
}

export const authRouter = router({
  /**
   * Called by the web app once Firebase has signed the person in (and on page load when a
   * Firebase session is restored). Records the sign-in — or the refusal — in the audit log.
   */
  signIn: publicProcedure.mutation(async ({ ctx }) => {
    const { auth } = ctx;
    if (auth.status === 'authenticated') {
      await recordSignIn(ctx.db, {
        userId: auth.user.id,
        firebaseUid: auth.firebaseUid,
        ...ctx.meta,
      });
      return toProfile(auth.user);
    }
    if (auth.status === 'denied') {
      await recordSignInDenied(ctx.db, {
        email: auth.email,
        userId: auth.userId,
        reason: auth.reason,
        ...ctx.meta,
      });
      ctx.log.warn({ reason: auth.reason }, 'Sign-in denied');
      throw new TRPCError({ code: 'FORBIDDEN', message: DENY_MESSAGES[auth.reason] });
    }
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Please sign in.' });
  }),

  me: protectedProcedure.query(({ ctx }) => toProfile(ctx.user)),
});
