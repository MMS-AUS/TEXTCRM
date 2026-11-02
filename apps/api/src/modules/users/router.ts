import { asc, eq } from 'drizzle-orm';
import { users } from '../../db/schema/index.ts';
import { protectedProcedure, router } from '../../trpc/trpc.ts';

export const usersRouter = router({
  /** Active staff, for "owner" and "assign to" pickers. Names only — no contact details. */
  options: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(asc(users.name)),
  ),
});
