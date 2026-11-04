import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAuth, fullAccessProfile, renderPage, type TrpcCall } from '../../test/render.tsx';
import { TicketDetailPage } from './TicketDetailPage.tsx';
import { TicketsPage } from './TicketsPage.tsx';

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });
const id = '66666666-6666-4666-8666-666666666666';
const contactId = '77777777-7777-4777-8777-777777777777';

const row = {
  id,
  ticketNumber: 'TKT-2026-0001',
  title: 'Inverter red alarm',
  category: 'Inverter Fault / Error Code',
  priority: 'Urgent',
  resolutionStatus: 'Warranty Claim Logged with Brand',
  contactId,
  customerName: 'Olivia Nguyen',
  suburb: 'Parramatta',
  projectId: null,
  projectNumber: 'MMS-2026-0001',
  assignedUserId: null,
  assignedName: 'Neivedha',
  createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
  closedAt: null,
  updatedAt: new Date().toISOString(),
};

const options = {
  ticketCategories: [
    { value: 'Inverter Fault / Error Code', label: 'Inverter Fault / Error Code' },
  ],
  ticketIssueResolutionStatuses: [
    { value: 'Under Investigation', label: 'Under Investigation' },
    { value: 'Warranty Claim Logged with Brand', label: 'Warranty Claim Logged with Brand' },
    { value: 'Resolved - Complete Handover', label: 'Resolved - Complete Handover' },
  ],
};

describe('tickets', () => {
  afterEach(cleanup);

  it('lists open tickets (the default) with priority, status and age', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<TicketsPage />, {
      path: '/tickets',
      auth: signedIn(),
      calls,
      responses: {
        'tickets.list': { rows: [row], total: 1 },
        'users.options': [],
        'optionLists.options': options,
        'savedViews.list': [],
      },
    });
    const table = await screen.findByRole('table', { name: 'Tickets' });
    expect(await within(table).findByText('TKT-2026-0001')).toBeDefined();
    expect(within(table).getByText('Urgent')).toBeDefined();
    expect(within(table).getByText('40 days')).toBeDefined();
    expect(calls.find((c) => c.path === 'tickets.list')?.input).toMatchObject({ state: 'open' });
  });

  it('shows the triage flow, hardware serials and the warranty claim on the ticket page', async () => {
    renderPage(<TicketDetailPage />, {
      path: '/tickets/$ticketId',
      url: `/tickets/${id}`,
      auth: signedIn(),
      responses: {
        'tickets.get': {
          ...row,
          description: null,
          issueRecorded: 'Inverter Fault / Red Alarm Light',
          initialCheck: 'Remote Portal Telemetry Verification',
          workRequired: null,
          serviceIssueNotes: null,
          resolvedDate: null,
          serviceChargeAud: null,
          createdByUserId: null,
          updatedByUserId: null,
          createdByName: 'Micky',
          contact: {
            id: contactId,
            firstName: 'Olivia',
            lastName: 'Nguyen',
            email: null,
            mobile: '+61412345678',
          },
          project: null,
          hardware: [
            {
              id: 'h1',
              ticketId: id,
              role: 'existing',
              kind: 'inverter',
              quantity: 1,
              brand: 'SolaX',
              model: 'X1-BOOST',
              size: '5 kW',
              serialNumbers: ['SX5K123456'],
              notes: null,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            },
          ],
          claims: [
            {
              id: 'c1',
              ticketId: id,
              claimDate: '2026-11-01',
              claimReference: 'RMA-1001',
              status: 'Submitted to Manufacturer',
              invoiceNumber: null,
              invoiceAmountAud: null,
              invoiceStatus: null,
              brandNotes: null,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            },
          ],
          visits: [],
        },
        'activities.list': { items: [], nextCursor: null },
        'files.list': [],
        'users.options': [],
        'optionLists.options': options,
      },
    });
    expect(await screen.findByRole('heading', { name: 'Inverter red alarm' })).toBeDefined();
    const steps = screen.getByRole('list', { name: 'Triage steps' });
    expect(within(steps).getByText('Inverter Fault / Red Alarm Light')).toBeDefined();
    expect(within(steps).getByText('Not yet')).toBeDefined();
    expect(screen.getByText('SX5K123456')).toBeDefined();
    expect(screen.getByText('RMA-1001')).toBeDefined();
    expect(screen.getByText('Submitted to Manufacturer')).toBeDefined();
    expect(screen.getByText('No visit recorded.')).toBeDefined();
  });

  it('opening a ticket sends the customer and problem', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<TicketsPage />, {
      path: '/tickets',
      auth: signedIn(),
      calls,
      responses: {
        'tickets.list': { rows: [], total: 0 },
        'users.options': [],
        'optionLists.options': options,
        'savedViews.list': [],
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'New ticket' }));
    expect(await screen.findByRole('dialog', { name: 'New service ticket' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Open ticket' }));
    expect(await screen.findByText('Choose the customer.')).toBeDefined();
    await waitFor(() => {
      expect(calls.some((c) => c.path === 'tickets.create')).toBe(false);
    });
  });
});
