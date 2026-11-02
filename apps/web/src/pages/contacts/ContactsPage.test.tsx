import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAuth, fullAccessProfile, renderPage, type TrpcCall } from '../../test/render.tsx';
import { ContactFormDialog } from './ContactFormDialog.tsx';
import { ContactsPage } from './ContactsPage.tsx';

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });

const responses = {
  'optionLists.options': {
    contactTypes: [
      { value: 'Residential', label: 'Residential' },
      { value: 'Commercial', label: 'Commercial' },
    ],
  },
  'companies.search': [],
  'contacts.list': {
    total: 1,
    rows: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        firstName: 'Olivia',
        lastName: 'Nguyen',
        email: 'olivia@example.com',
        mobile: '+61412345678',
        type: 'Residential',
        companyId: null,
        companyName: null,
        suburb: 'Parramatta',
        state: 'NSW',
        updatedAt: new Date().toISOString(),
        archivedAt: null,
      },
    ],
  },
  'contacts.create': { id: '22222222-2222-4222-8222-222222222222' },
};

describe('ContactsPage', () => {
  afterEach(cleanup);

  it('lists contacts from the API with formatted details and a link to each', async () => {
    renderPage(<ContactsPage />, { path: '/contacts', auth: signedIn(), responses });
    const table = await screen.findByRole('table', { name: 'Contacts' });
    const link = await within(table).findByRole('link', { name: 'Olivia Nguyen' });
    expect(link.getAttribute('href')).toBe('/contacts/11111111-1111-4111-8111-111111111111');
    expect(within(table).getByText('0412 345 678')).toBeDefined();
    expect(within(table).getByText('Parramatta, NSW')).toBeDefined();
  });

  it('puts the search, sort and page in the URL and asks the API for exactly that', async () => {
    const calls: TrpcCall[] = [];
    const router = renderPage(<ContactsPage />, {
      path: '/contacts',
      url: '/contacts?page=2&sort=name&desc=false',
      auth: signedIn(),
      responses,
      calls,
    });
    await screen.findByRole('table', { name: 'Contacts' });
    await waitFor(() => {
      expect(calls.find((call) => call.path === 'contacts.list')?.input).toMatchObject({
        page: 2,
        sort: { id: 'name', desc: false },
      });
    });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search contacts' }), {
      target: { value: 'olivia' },
    });
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ q: 'olivia', page: 0 });
    });
    await waitFor(() => {
      expect(calls.at(-1)).toMatchObject({
        path: 'contacts.list',
        input: { search: 'olivia', page: 0 },
      });
    });
  });
});

describe('ContactFormDialog', () => {
  afterEach(cleanup);

  it('explains what is missing before anything is sent', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<ContactFormDialog open onOpenChange={() => undefined} />, {
      path: '/contacts',
      auth: signedIn(),
      responses,
      calls,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Add contact' }));
    expect(await screen.findByText('Enter a first name.')).toBeDefined();
    expect(
      screen.getByText('Enter a mobile or an email so the contact can be reached.'),
    ).toBeDefined();
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '0412 34' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    expect(await screen.findByText('Enter a valid phone number, e.g. 0412 345 678.')).toBeDefined();
    expect(calls.some((call) => call.path === 'contacts.create')).toBe(false);
  });

  it('sends normalised values to the API', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<ContactFormDialog open onOpenChange={() => undefined} />, {
      path: '/contacts',
      auth: signedIn(),
      responses,
      calls,
    });
    fireEvent.change(await screen.findByLabelText(/First name/), { target: { value: ' Jack ' } });
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '0412 345 678' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'Jack@Example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    await waitFor(() => {
      expect(calls.find((call) => call.path === 'contacts.create')?.input).toMatchObject({
        firstName: 'Jack',
        mobile: '+61412345678',
        email: 'jack@example.com',
        type: 'Residential',
      });
    });
  });
});
