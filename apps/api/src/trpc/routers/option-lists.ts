import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { optionLists, options } from '../../db/schema/index.ts';
import { activeOptions } from '../../modules/options.ts';
import { permissionProcedure, protectedProcedure, router } from '../trpc.ts';

export const optionListsRouter = router({
  /** Every option list with its number of active (non-archived) options. */
  list: permissionProcedure('option_lists', 'view').query(({ ctx }) =>
    ctx.db
      .select({
        key: optionLists.key,
        name: optionLists.name,
        activeOptions: count(options.id),
      })
      .from(optionLists)
      .leftJoin(options, and(eq(options.listId, optionLists.id), isNull(options.archivedAt)))
      .groupBy(optionLists.id)
      .orderBy(asc(optionLists.name)),
  ),

  /**
   * Active options for form pickers. Any signed-in user may read them — the lists aren't
   * sensitive, and every form needs them. Managing lists needs option_lists permissions.
   */
  options: protectedProcedure
    .input(z.object({ keys: z.array(z.string().min(1).max(100)).min(1).max(20) }))
    .query(({ ctx, input }) => activeOptions(ctx.db, input.keys)),
});
