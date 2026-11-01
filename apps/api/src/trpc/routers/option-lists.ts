import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { optionLists, options } from '../../db/schema/index.ts';
import { permissionProcedure, router } from '../trpc.ts';

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
});
