import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { authRouter } from './routers/auth.ts';
import { healthRouter } from './routers/health.ts';
import { optionListsRouter } from './routers/option-lists.ts';
import { router } from './trpc.ts';

export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  optionLists: optionListsRouter,
});

/** Imported (type-only) by apps/web for end-to-end type safety. */
export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
