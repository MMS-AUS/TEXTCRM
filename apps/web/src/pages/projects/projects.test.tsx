import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAuth, fullAccessProfile, renderPage, type TrpcCall } from '../../test/render.tsx';
import { ConvertToProjectButton } from '../leads/ConvertToProject.tsx';
import { ProjectBoard } from './ProjectBoard.tsx';

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });
const leadId = '11111111-1111-4111-8111-111111111111';

const preview = {
  problems: [],
  contact: { mode: 'new', id: null, name: 'Olivia Nguyen' },
  project: {
    title: '10.56 kW solar + battery',
    address: '12 Church St, Parramatta, NSW, 2150',
    stage: 'Engineering & DNSP Approval',
    salesPerson: 'Micky',
    system: ['24 × Jinko Tiger Neo'],
    systemSizeKw: '10.56',
    sellingPriceAud: '14990.00',
    depositAud: '2000.00',
  },
};

describe('Convert to project', () => {
  afterEach(cleanup);

  it('shows exactly what will be created, then converts', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<ConvertToProjectButton leadId={leadId} />, {
      path: '/leads',
      auth: signedIn(),
      calls,
      responses: {
        'projects.conversionPreview': preview,
        'projects.convertLead': {
          id: '22222222-2222-4222-8222-222222222222',
          projectNumber: 'MMS-2026-0001',
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to project' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/A new contact/)).toBeDefined();
    expect(within(dialog).getByText('12 Church St, Parramatta, NSW, 2150')).toBeDefined();
    expect(within(dialog).getByText('$14,990.00')).toBeDefined();

    fireEvent.click(within(dialog).getByRole('button', { name: /Convert to project/ }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === 'projects.convertLead')?.input).toEqual({ leadId });
    });
  });

  it('explains why a lead cannot be converted and disables the button', async () => {
    renderPage(<ConvertToProjectButton leadId={leadId} />, {
      path: '/leads',
      auth: signedIn(),
      responses: {
        'projects.conversionPreview': {
          ...preview,
          problems: [
            'Add the full property address (street, suburb, state and postcode) — the job needs a site.',
          ],
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to project' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Add the full property address/)).toBeDefined();
    expect(
      within(dialog)
        .getByRole('button', { name: /Convert to project/ })
        .hasAttribute('disabled'),
    ).toBe(true);
  });
});

const card = (id: string, stage: string, customerName: string) => ({
  id,
  projectNumber: `MMS-2026-${id.slice(0, 4)}`,
  title: null,
  contactId: id,
  customerName,
  suburb: 'Parramatta',
  state: 'NSW',
  stage,
  status: 'Active',
  salesUserId: null,
  salesName: 'Micky',
  saleDate: '2026-11-02',
  systemSizeKw: '6.6',
  batteryCount: null,
  sellingPriceAud: null,
  updatedAt: new Date().toISOString(),
});

describe('ProjectBoard', () => {
  afterEach(cleanup);

  const board = {
    truncated: false,
    rows: [
      card('1000aaaa-0000-4000-8000-000000000000', 'Engineering & DNSP Approval', 'Olivia Nguyen'),
      card('2000aaaa-0000-4000-8000-000000000000', 'Install Scheduled', 'Jack Patel'),
    ],
  };

  it('shows every stage as a column with its jobs and counts', () => {
    renderPage(<ProjectBoard board={board} queryKey={['board']} />, {
      path: '/projects',
      auth: signedIn(),
    });
    return screen.findByRole('list', { name: 'Project stages' }).then((columns) => {
      expect(within(columns).getAllByRole('listitem', { name: /jobs$/ })).toHaveLength(9);
      const install = within(columns).getByRole('listitem', { name: 'Install Scheduled: 1 jobs' });
      expect(within(install).getByText('Jack Patel')).toBeDefined();
      expect(within(install).getByText(/6.6 kW/)).toBeDefined();
    });
  });

  it('moves a job when its card is dropped on another stage', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<ProjectBoard board={board} queryKey={['board']} />, {
      path: '/projects',
      auth: signedIn(),
      calls,
      responses: { 'projects.setStage': { id: board.rows[0]?.id }, 'projects.board': board },
    });
    const columns = await screen.findByRole('list', { name: 'Project stages' });
    const store = new Map<string, string>();
    const dataTransfer = {
      types: ['application/x-mms-project'],
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
      effectAllowed: 'move',
    };
    const olivia = within(columns).getByText('Olivia Nguyen').closest('li');
    if (!olivia) throw new Error('card not found');
    fireEvent.dragStart(olivia, { dataTransfer });
    const target = within(columns).getByRole('listitem', { name: /^Installation in Progress/ });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => {
      expect(calls.find((c) => c.path === 'projects.setStage')?.input).toEqual({
        id: board.rows[0]?.id,
        stage: 'Installation in Progress',
      });
    });
  });
});
