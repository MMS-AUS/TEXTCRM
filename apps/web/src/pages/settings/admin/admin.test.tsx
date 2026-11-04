import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix } from '@mms/shared';
import { fakeAuth, fullAccessProfile, renderPage, type TrpcCall } from '../../../test/render.tsx';
import { RolesPage } from './RolesPage.tsx';
import { UsersPage } from './UsersPage.tsx';

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });
const salesRole = '88888888-8888-4888-8888-888888888888';

const users = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'micky@makemysolar.com.au',
    name: 'Micky',
    phone: null,
    department: null,
    roleId: 'admin-role',
    roleName: 'Admin',
    roleKey: 'admin',
    isActive: true,
    hasSignedIn: true,
    lastSignInAt: new Date().toISOString(),
    deactivatedAt: null,
    createdAt: new Date().toISOString(),
    isYou: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'simon@makemysolar.com.au',
    name: 'Simon',
    phone: null,
    department: null,
    roleId: salesRole,
    roleName: 'Sales',
    roleKey: 'sales',
    isActive: true,
    hasSignedIn: false,
    lastSignInAt: null,
    deactivatedAt: null,
    createdAt: new Date().toISOString(),
    isYou: false,
  },
];

describe('admin settings', () => {
  afterEach(cleanup);

  it('lists users with their status', async () => {
    renderPage(<UsersPage />, {
      path: '/settings/users',
      auth: signedIn(),
      responses: { 'admin.users.list': users, 'admin.users.roleOptions': [] },
    });
    const table = await screen.findByRole('table', { name: 'Users' });
    expect(within(table).getByText('(you)')).toBeDefined();
    expect(within(table).getByText('Invited')).toBeDefined();
    expect(within(table).getByText('Never')).toBeDefined();
  });

  it('adding a user checks the form before calling the API', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<UsersPage />, {
      path: '/settings/users',
      auth: signedIn(),
      calls,
      responses: {
        'admin.users.list': users,
        'admin.users.roleOptions': [{ id: salesRole, name: 'Sales', key: 'sales' }],
        'admin.users.invite': { id: 'new' },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Add user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a user' });
    fireEvent.change(within(dialog).getByLabelText(/Work email/), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect(await within(dialog).findByText('Enter their work email.')).toBeDefined();
    await waitFor(() => {
      expect(calls.some((c) => c.path === 'admin.users.invite')).toBe(false);
    });
  });

  it('shows the Admin role as locked with every permission', async () => {
    const all = emptyPermissionMatrix();
    for (const p of Object.values(all)) p.view = p.create = p.edit = p.delete = p.export = true;
    renderPage(<RolesPage />, {
      path: '/settings/roles',
      auth: signedIn(),
      responses: {
        'admin.roles.list': [
          {
            id: 'admin-role',
            key: 'admin',
            name: 'Admin',
            description: null,
            isSystem: true,
            locked: true,
            activeUsers: 1,
            permissions: all,
          },
        ],
      },
    });
    expect(await screen.findByText(/Admins always have every permission/)).toBeDefined();
    const box = screen.getByRole('checkbox', { name: 'Tickets: Delete' });
    expect(box.getAttribute('data-state')).toBe('checked');
    expect(box.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull();
  });
});
