import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { activitiesRouter } from '../modules/activities/router.ts';
import { companiesRouter } from '../modules/companies/router.ts';
import { contactsRouter } from '../modules/contacts/router.ts';
import { leadsRouter } from '../modules/leads/router.ts';
import { savedViewsRouter } from '../modules/saved-views/router.ts';
import { usersRouter } from '../modules/users/router.ts';
import { authRouter } from './routers/auth.ts';
import { healthRouter } from './routers/health.ts';
import { optionListsRouter } from './routers/option-lists.ts';
import { router } from './trpc.ts';

export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  optionLists: optionListsRouter,
  users: usersRouter,
  contacts: contactsRouter,
  companies: companiesRouter,
  leads: leadsRouter,
  activities: activitiesRouter,
  savedViews: savedViewsRouter,
});

/** Imported (type-only) by apps/web for end-to-end type safety. */
export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
