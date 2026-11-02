import { emptyPermissionMatrix, type Feature } from '@mms/shared';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthContext } from '../../auth/auth-context.ts';
import { fakeAuth, fakeProfile } from '../../test/render.tsx';
import { AppShell } from './AppShell.tsx';

const PATHS = ['/dashboard', '/leads', '/contacts', '/projects', '/tickets', '/settings'];

function permissionsFor(features: Feature[]) {
  const matrix = emptyPermissionMatrix();
  for (const feature of features) matrix[feature] = { ...matrix[feature], view: true };
  return matrix;
}

/** The real shell inside a small router whose pages just print their path. */
function renderShell(path: string, features: Feature[]) {
  const auth = fakeAuth({
    status: 'signedIn',
    profile: { ...fakeProfile, permissions: permissionsFor(features) },
  });
  const root = createRootRoute({
    component: () => (
      <AuthContext.Provider value={auth}>
        <AppShell>
          <Outlet />
        </AppShell>
      </AuthContext.Provider>
    ),
  });
  const pages = PATHS.map((to) =>
    createRoute({ getParentRoute: () => root, path: to, component: () => <p>page {to}</p> }),
  );
  const router = createRouter({
    routeTree: root.addChildren(pages),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return auth;
}

describe('AppShell', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('shows only the sections the role can view, and marks the current page', async () => {
    renderShell('/leads', ['dashboard', 'leads']);
    expect(await screen.findByText('page /leads')).toBeDefined();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeDefined();
    expect(within(nav).getByRole('link', { name: 'Leads' }).getAttribute('data-status')).toBe(
      'active',
    );
    expect(within(nav).queryByRole('link', { name: 'Tickets' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('shows Settings to anyone who can view an admin area', async () => {
    renderShell('/dashboard', ['dashboard', 'option_lists']);
    await screen.findByText('page /dashboard');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Settings' })).toBeDefined();
  });

  it('collapses the sidebar and remembers it', async () => {
    renderShell('/dashboard', ['dashboard']);
    await screen.findByText('page /dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeDefined();
    expect(localStorage.getItem('mms-sidebar-collapsed')).toBe('true');
    // Labels stay available to screen readers when collapsed.
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeDefined();
  });

  it('opens the palette with Ctrl+K and jumps to a page', async () => {
    renderShell('/dashboard', ['dashboard', 'leads', 'contacts']);
    await screen.findByText('page /dashboard');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const search = await screen.findByRole('combobox', { name: 'Search' });
    fireEvent.change(search, { target: { value: 'lea' } });
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Leads']);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(await screen.findByText('page /leads')).toBeDefined();
  });
});
