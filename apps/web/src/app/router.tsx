import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Navigate,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { DashboardPage } from '../pages/DashboardPage.tsx';
import { ErrorPage } from '../pages/ErrorPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import { PlaceholderPage } from '../pages/PlaceholderPage.tsx';
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
  component: () => (
    <PlaceholderPage
      title="Leads"
      description="Every enquiry from Meta, Google, the website and referrals."
      step="Step 2.2"
      features={['leads']}
    />
  ),
});

const contactsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contacts',
  component: () => (
    <PlaceholderPage
      title="Contacts"
      description="Customers and the companies they belong to."
      step="Step 2.1"
      features={['contacts']}
    />
  ),
});

const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects',
  component: () => (
    <PlaceholderPage
      title="Projects"
      description="Sold jobs, from deposit to completed installation."
      step="Step 2.6"
      features={['projects']}
    />
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
    <PlaceholderPage
      title="Settings"
      description="Users, roles, option lists, hardware catalogue and integrations."
      step="Step 2.10"
      features={SETTINGS_FEATURES}
    />
  ),
});

export const routeTree = rootRoute.addChildren([
  designRoute,
  appRoute.addChildren([
    indexRoute,
    dashboardRoute,
    leadsRoute,
    contactsRoute,
    projectsRoute,
    ticketsRoute,
    settingsRoute,
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
