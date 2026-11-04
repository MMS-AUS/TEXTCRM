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
  integrationsSearchSchema,
  ticketsSearchSchema,
} from '../pages/list-search.ts';
import { FeatureGate } from '../pages/PlaceholderPage.tsx';
import { ProjectDetailPage } from '../pages/projects/ProjectDetailPage.tsx';
import { ProjectsPage } from '../pages/projects/ProjectsPage.tsx';
import { ImportPage } from '../pages/settings/imports/ImportPage.tsx';
import { ImportsPage } from '../pages/settings/imports/ImportsPage.tsx';
import { TicketDetailPage } from '../pages/tickets/TicketDetailPage.tsx';
import { TicketsPage } from '../pages/tickets/TicketsPage.tsx';
import { UsersPage } from '../pages/settings/admin/UsersPage.tsx';
import { RolesPage } from '../pages/settings/admin/RolesPage.tsx';
import { OptionListsPage } from '../pages/settings/admin/OptionListsPage.tsx';
import { HardwarePage } from '../pages/settings/admin/HardwarePage.tsx';
import { CompanyPage } from '../pages/settings/admin/CompanyPage.tsx';
import { IntegrationsPage } from '../pages/settings/integrations/IntegrationsPage.tsx';
import { JobsPage } from '../pages/settings/JobsPage.tsx';
import {
  NewSheetSourcePage,
  SheetSourcePage,
} from '../pages/settings/sheet-sync/SheetSourcePage.tsx';
import { SheetSyncPage } from '../pages/settings/sheet-sync/SheetSyncPage.tsx';
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
  validateSearch: ticketsSearchSchema,
  component: () => (
    <FeatureGate title="Tickets" features={['tickets']}>
      <TicketsPage />
    </FeatureGate>
  ),
});

const ticketDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tickets/$ticketId',
  component: () => (
    <FeatureGate title="Tickets" features={['tickets']}>
      <TicketDetailPage />
    </FeatureGate>
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

const sheetSyncRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/sheet-sync',
  component: () => (
    <FeatureGate title="Live sheet sync" features={['integrations']}>
      <SheetSyncPage />
    </FeatureGate>
  ),
});

const newSheetSourceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/sheet-sync/new',
  component: () => (
    <FeatureGate title="Live sheet sync" features={['integrations']}>
      <NewSheetSourcePage />
    </FeatureGate>
  ),
});

const sheetSourceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/sheet-sync/$sourceId',
  component: () => (
    <FeatureGate title="Live sheet sync" features={['integrations']}>
      <SheetSourcePage />
    </FeatureGate>
  ),
});

const usersSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/users',
  component: () => (
    <FeatureGate title="Users" features={['users']}>
      <UsersPage />
    </FeatureGate>
  ),
});

const rolesSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/roles',
  component: () => (
    <FeatureGate title="Roles & permissions" features={['roles']}>
      <RolesPage />
    </FeatureGate>
  ),
});

const optionListsSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/option-lists',
  component: () => (
    <FeatureGate title="Option lists" features={['option_lists']}>
      <OptionListsPage />
    </FeatureGate>
  ),
});

const hardwareSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/hardware',
  component: () => (
    <FeatureGate title="Hardware catalogue" features={['hardware']}>
      <HardwarePage />
    </FeatureGate>
  ),
});

const companySettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/company',
  component: () => (
    <FeatureGate title="Company profile" features={['users']}>
      <CompanyPage />
    </FeatureGate>
  ),
});

// Everyone may open it: Gmail is each person's own; the organisation cards need integrations.
const integrationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/integrations',
  validateSearch: integrationsSearchSchema,
  component: IntegrationsPage,
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
    ticketDetailRoute,
    settingsRoute,
    jobsRoute,
    importsRoute,
    importRoute,
    sheetSyncRoute,
    newSheetSourceRoute,
    sheetSourceRoute,
    usersSettingsRoute,
    rolesSettingsRoute,
    optionListsSettingsRoute,
    hardwareSettingsRoute,
    companySettingsRoute,
    integrationsRoute,
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
