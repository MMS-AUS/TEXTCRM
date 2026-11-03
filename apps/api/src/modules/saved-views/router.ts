import { TRPCError } from '@trpc/server';
import { and, asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { savedViews } from '../../db/schema/index.ts';
import { protectedProcedure, router } from '../../trpc/trpc.ts';

const PAGES = ['leads', 'projects'] as const;
const MAX_VIEWS_PER_PAGE = 30;

/** Each person's own named filter sets per list page. Nobody sees anyone else's. */
export const savedViewsRouter = router({
  list: protectedProcedure.input(z.object({ page: z.enum(PAGES) })).query(({ ctx, input }) =>
    ctx.db
      .select({ id: savedViews.id, name: savedViews.name, search: savedViews.search })
      .from(savedViews)
      .where(and(eq(savedViews.userId, ctx.user.id), eq(savedViews.page, input.page)))
      .orderBy(asc(savedViews.name)),
  ),

  create: protectedProcedure
    .input(
      z.object({
        page: z.enum(PAGES),
        name: z.string().trim().min(1, 'Name the view.').max(60),
        // The list's URL search params; small and validated again by the page when applied.
        search: z.record(z.string(), z.unknown()).refine((s) => JSON.stringify(s).length < 2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [{ total } = { total: 0 }] = await ctx.db
        .select({ total: count() })
        .from(savedViews)
        .where(and(eq(savedViews.userId, ctx.user.id), eq(savedViews.page, input.page)));
      if (total >= MAX_VIEWS_PER_PAGE) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `You can keep up to ${String(MAX_VIEWS_PER_PAGE)} views. Delete one first.`,
        });
      }
      const [created] = await ctx.db
        .insert(savedViews)
        .values({ userId: ctx.user.id, page: input.page, name: input.name, search: input.search })
        .returning({ id: savedViews.id });
      if (!created) throw new Error('Insert returned no row');
      return created;
    }),

  remove: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.db
      .delete(savedViews)
      .where(and(eq(savedViews.id, input.id), eq(savedViews.userId, ctx.user.id)));
    return { id: input.id };
  }),
});
