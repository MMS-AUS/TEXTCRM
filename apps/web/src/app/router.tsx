import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Navigate,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { CompaniesPage } from '../pages/companies/CompaniesPage.tsx';
import { CompanyDetailPage } from '../pages/companies/CompanyDetailPage.tsx';
import { ContactDetailPage } from '../pages/contacts/ContactDetailPage.tsx';
import { ContactsPage } from '../pages/contacts/ContactsPage.tsx';
import { DashboardPage } from '../pages/DashboardPage.tsx';
import { ErrorPage } from '../pages/ErrorPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import { LeadDetailPage } from '../pages/leads/LeadDetailPage.tsx';
import { LeadsPage } from '../pages/leads/LeadsPage.tsx';
import {
  companiesSearchSchema,
  contactsSearchSchema,
  leadsSearchSchema,
  projectsSearchSchema,
} from '../pages/list-search.ts';
import { FeatureGate, PlaceholderPage } from '../pages/PlaceholderPage.tsx';
import { ProjectDetailPage } from '../pages/projects/ProjectDetailPage.tsx';
import { ProjectsPage } from '../pages/projects/ProjectsPage.tsx';
import { ImportPage } from '../pages/settings/imports/ImportPage.tsx';
import { ImportsPage } from '../pages/settings/imports/ImportsPage.tsx';
import { JobsPage } from '../pages/settings/JobsPage.tsx';
import { SettingsPage } from '../pages/settings/SettingsPage.tsx';
import { Toaster } from '../ui/index.ts';
import { SETTINGS_FEATURES } from './nav.ts';
import { ProtectedLayout, type AppServices } from './ProtectedLayout.tsx';

export type RouterContext = {
  /** null when the Firebase web config is missing from .env. */
  services: AppServices | null;
  missingConfig: string[];
};

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: function Root() {
    return (
      <>
        <Outlet />
        <Toaster />
      </>
    );
  },
});

// Public: a static component gallery with no data, so no sign-in or Firebase config needed.
const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design',
  component: lazyRouteComponent(() => import('../pages/design/DesignPage.tsx'), 'DesignPage'),
});

// Everything else sits behind the sign-in gate, inside the app shell.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: function AppLayout() {
    const { services, missingConfig } = rootRoute.useRouteContext();
    return <ProtectedLayout services={services} missingConfig={missingConfig} />;
  },
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: () => <Navigate to="/dashboard" replace />,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/dashboard',
  component: DashboardPage,
});

const leadsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/leads',
  validateSearch: leadsSearchSchema,
  component: () => (
    <FeatureGate title="Leads" features={['leads']}>
      <LeadsPage />
    </FeatureGate>
  ),
});

const leadDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/leads/$leadId',
  component: () => (
    <FeatureGate title="Leads" features={['leads']}>
      <LeadDetailPage />
    </FeatureGate>
  ),
});

const contactsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contacts',
  validateSearch: contactsSearchSchema,
  component: () => (
    <FeatureGate title="Contacts" features={['contacts']}>
      <ContactsPage />
    </FeatureGate>
  ),
});

const contactDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contacts/$contactId',
  component: () => (
    <FeatureGate title="Contacts" features={['contacts']}>
      <ContactDetailPage />
    </FeatureGate>
  ),
});

const companiesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/companies',
  validateSearch: companiesSearchSchema,
  component: () => (
    <FeatureGate title="Companies" features={['companies']}>
      <CompaniesPage />
    </FeatureGate>
  ),
});

const companyDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/companies/$companyId',
  component: () => (
    <FeatureGate title="Companies" features={['companies']}>
      <CompanyDetailPage />
    </FeatureGate>
  ),
});

const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects',
  validateSearch: projectsSearchSchema,
  component: () => (
    <FeatureGate title="Projects" features={['projects']}>
      <ProjectsPage />
    </FeatureGate>
  ),
});

const projectDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$projectId',
  component: () => (
    <FeatureGate title="Projects" features={['projects']}>
      <ProjectDetailPage />
    </FeatureGate>
  ),
});

const ticketsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tickets',
  component: () => (
    <PlaceholderPage
      title="Tickets"
      description="After-sales service and warranty claims."
      step="Step 2.8"
      features={['tickets']}
    />
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: () => (
    <FeatureGate title="Settings" features={[...SETTINGS_FEATURES, 'leads', 'contacts']}>
      <SettingsPage />
    </FeatureGate>
  ),
});

const jobsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/jobs',
  component: () => (
    <FeatureGate title="Background jobs" features={['integrations']}>
      <JobsPage />
    </FeatureGate>
  ),
});

const importsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/imports',
  component: () => (
    <FeatureGate title="Import" features={['leads', 'contacts']}>
      <ImportsPage />
    </FeatureGate>
  ),
});

const importRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/imports/$importId',
  component: () => (
    <FeatureGate title="Import" features={['leads', 'contacts']}>
      <ImportPage />
    </FeatureGate>
  ),
});

export const routeTree = rootRoute.addChildren([
  designRoute,
  appRoute.addChildren([
    indexRoute,
    dashboardRoute,
    leadsRoute,
    leadDetailRoute,
    contactsRoute,
    contactDetailRoute,
    companiesRoute,
    companyDetailRoute,
    projectsRoute,
    projectDetailRoute,
    ticketsRoute,
    settingsRoute,
    jobsRoute,
    importsRoute,
    importRoute,
  ]),
]);

export function createAppRouter(context: RouterContext, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context,
    ...(history ? { history } : {}),
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: ErrorPage,
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
