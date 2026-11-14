import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAuth, fullAccessProfile, renderPage, type TrpcCall } from '../../test/render.tsx';
import { LeadFormDrawer } from './LeadFormDrawer.tsx';
import { LeadsPage } from './LeadsPage.tsx';

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });

const lead = {
  id: '11111111-1111-4111-8111-111111111111',
  firstName: 'Olivia',
  lastName: 'Nguyen',
  email: 'olivia@example.com',
  mobile: '+61412345678',
  suburb: 'Parramatta',
  state: 'NSW',
  postcode: '2150',
  source: 'Meta',
  status: 'Proposal Sent',
  leadDate: '2026-11-01',
  ownerUserId: null,
  ownerName: null,
  contactId: null,
  updatedAt: new Date().toISOString(),
  deletedAt: null,
};

const responses = {
  'leads.list': { total: 1, rows: [lead] },
  'leads.statusCounts': { New: 4, 'Proposal Sent': 1 },
  'optionLists.options': {
    leadSources: [{ value: 'Meta', label: 'Meta' }],
    leadStatuses: [
      { value: 'New', label: 'New' },
      { value: 'Proposal Sent', label: 'Proposal Sent' },
    ],
  },
  'users.options': [{ id: '00000000-0000-4000-8000-000000000001', name: 'Sam' }],
  'savedViews.list': [],
  'leads.checkDuplicate': {
    duplicate: {
      id: lead.id,
      name: 'Olivia Nguyen',
      status: 'Proposal Sent',
      leadDate: '2026-11-01',
      suburb: 'Parramatta',
      phone: '0412 345 678',
      matchedOn: 'phone',
      reason: 'same phone number',
    },
    contact: null,
  },
};

describe('LeadsPage', () => {
  afterEach(cleanup);

  it('shows leads with status pills counted by the API', async () => {
    renderPage(<LeadsPage />, { path: '/leads', auth: signedIn(), responses });
    const table = await screen.findByRole('table', { name: 'Leads' });
    expect(await within(table).findByRole('link', { name: 'Olivia Nguyen' })).toBeDefined();
    expect(within(table).getByText('Unassigned')).toBeDefined();
    const pills = screen.getByRole('group', { name: 'Status' });
    expect(
      within(pills)
        .getByRole('button', { name: /All\s*5/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(pills).getByRole('button', { name: /New\s*4/ })).toBeDefined();
  });

  it('filters by status pill and quick filter through the URL and the API', async () => {
    const calls: TrpcCall[] = [];
    const router = renderPage(<LeadsPage />, {
      path: '/leads',
      auth: signedIn(),
      responses,
      calls,
    });
    const pills = await screen.findByRole('group', { name: 'Status' });
    fireEvent.click(within(pills).getByRole('button', { name: /Proposal Sent/ }));
    fireEvent.click(screen.getByRole('button', { name: 'My leads' }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        status: ['Proposal Sent'],
        owner: 'me',
        page: 0,
      });
    });
    await waitFor(() => {
      expect(calls.filter((c) => c.path === 'leads.list').at(-1)?.input).toMatchObject({
        statuses: ['Proposal Sent'],
        owner: 'me',
      });
    });
  });
});

describe('LeadFormDrawer', () => {
  afterEach(cleanup);

  it('warns about an existing lead while typing, with a link to it', async () => {
    renderPage(<LeadFormDrawer open onOpenChange={() => undefined} />, {
      path: '/leads',
      auth: signedIn(),
      responses,
    });
    fireEvent.change(await screen.findByLabelText(/First name/), { target: { value: 'Liv' } });
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '0412 345 678' } });
    expect(await screen.findByText('This lead already exists')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Olivia Nguyen' }).getAttribute('href')).toBe(
      `/leads/${lead.id}`,
    );
  });
});
