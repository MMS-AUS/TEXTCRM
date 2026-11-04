import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { activitiesRouter } from '../modules/activities/router.ts';
import { companiesRouter } from '../modules/companies/router.ts';
import { contactsRouter } from '../modules/contacts/router.ts';
import { dashboardRouter } from '../modules/dashboard/router.ts';
import { filesRouter } from '../modules/files/router.ts';
import { hardwareRouter } from '../modules/hardware/router.ts';
import { importsRouter } from '../modules/imports/router.ts';
import { jobsRouter } from '../modules/jobs/router.ts';
import { leadsRouter } from '../modules/leads/router.ts';
import { projectsRouter } from '../modules/projects/router.ts';
import { sheetSyncRouter } from '../modules/sheet-sync/router.ts';
import { savedViewsRouter } from '../modules/saved-views/router.ts';
import { ticketsRouter } from '../modules/tickets/router.ts';
import { usersRouter } from '../modules/users/router.ts';
import { authRouter } from './routers/auth.ts';
import { healthRouter } from './routers/health.ts';
import { optionListsRouter } from './routers/option-lists.ts';
import { router } from './trpc.ts';

export const appRouter = router({
  health: healthRouter,
  dashboard: dashboardRouter,
  auth: authRouter,
  optionLists: optionListsRouter,
  users: usersRouter,
  contacts: contactsRouter,
  companies: companiesRouter,
  leads: leadsRouter,
  projects: projectsRouter,
  tickets: ticketsRouter,
  activities: activitiesRouter,
  savedViews: savedViewsRouter,
  hardware: hardwareRouter,
  files: filesRouter,
  jobs: jobsRouter,
  imports: importsRouter,
  sheetSync: sheetSyncRouter,
});

/** Imported (type-only) by apps/web for end-to-end type safety. */
export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
