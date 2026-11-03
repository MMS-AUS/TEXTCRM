import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RouterOutputs } from '../../lib/trpc.ts';
import { fakeAuth, fullAccessProfile, renderPage, type TrpcCall } from '../../test/render.tsx';
import { EbVerificationCard, GridApplicationCard, StcClaimCard } from './ProjectWorkflow.tsx';

type Project = RouterOutputs['projects']['get'];

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });
const id = '22222222-2222-4222-8222-222222222222';

/** Only the fields the workflow cards read; the rest of the page's data isn't needed here. */
function project(sections: Partial<Project>): Project {
  // A partial fixture: these cards never touch the fields left out.
  return { id, eb: null, ebChecks: [], grid: null, stc: null, ...sections } as Project;
}

const options = {
  'optionLists.options': {
    electricityDistributors: [{ value: 'Ausgrid', label: 'Ausgrid' }],
    gridApplicationStatuses: [{ value: 'Grid App Approved', label: 'Grid App Approved' }],
    energyRetailers: [],
  },
};

describe('project workflow cards', () => {
  afterEach(cleanup);

  it('EB verification shows each check, why it needs attention, and the score', async () => {
    renderPage(
      <EbVerificationCard
        editable
        project={project({
          ebChecks: [
            {
              key: 'customerNameMatch',
              label: 'Customer name matches the bill',
              answer: 'Yes',
              state: 'passed',
              note: null,
            },
            {
              key: 'meterPhase',
              label: 'Meter phase',
              answer: 'Single Phase',
              state: 'attention',
              note: 'The site is recorded as Three Phase.',
            },
            {
              key: 'meterMatch',
              label: 'Meter number matches',
              answer: null,
              state: 'unanswered',
              note: null,
            },
          ],
        })}
      />,
      { path: '/projects', auth: signedIn() },
    );
    const checks = await screen.findByRole('list', { name: 'Bill checks' });
    expect(within(checks).getAllByRole('listitem')).toHaveLength(3);
    expect(within(checks).getByText('The site is recorded as Three Phase.')).toBeDefined();
    expect(within(checks).getByLabelText('Needs attention')).toBeDefined();
    expect(screen.getByText('1 of 3 passed')).toBeDefined();
  });

  it('grid application: the form enforces the shared rules before saving', async () => {
    const calls: TrpcCall[] = [];
    renderPage(
      <GridApplicationCard
        editable
        project={project({
          grid: {
            electricityDistributor: 'Ausgrid',
            applicationRef: 'AG-1',
            status: 'Grid App Approved',
            appliedDate: '2026-10-01',
            approvalDate: null,
            rejectedDate: null,
            energyRetailer: null,
            retailerRef: null,
            timing: { days: 3, decided: false },
          },
        })}
      />,
      {
        path: '/projects',
        auth: signedIn(),
        calls,
        responses: { ...options, 'projects.updateGridApplication': { id } },
      },
    );
    expect(await screen.findByText('Waiting 3 days')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('When was it approved?')).toBeDefined();
    expect(calls.some((c) => c.path === 'projects.updateGridApplication')).toBe(false);

    fireEvent.change(within(dialog).getByLabelText('Approved'), {
      target: { value: '2026-10-15' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === 'projects.updateGridApplication')?.input).toMatchObject({
        id,
        values: { status: 'Grid App Approved', approvalDate: '2026-10-15', applicationRef: 'AG-1' },
      });
    });
  });

  it('STC claim shows the totals worked out by the server', async () => {
    renderPage(
      <StcClaimCard
        editable={false}
        project={project({
          stc: {
            portal: 'BridgeSelect',
            jobNumber: 'BS-1',
            status: 'Approved & Traded',
            submittedDate: '2026-10-20',
            solarStcs: 80,
            solarStcsAmountAud: '3040.00',
            solarStcsReceivedDate: '2026-10-30',
            batteryStcs: 50,
            batteryStcsAmountAud: '1900.00',
            batteryStcsReceivedDate: null,
            adminChargesAud: '50.00',
            customerStcRateAud: null,
            internalStcRateAud: null,
            bridgeselectSyncStatus: null,
            bridgeselectSyncedAt: null,
            bridgeselectError: null,
            totals: {
              totalStcs: 130,
              totalReceivedAud: '3040.00',
              outstandingAud: '1900.00',
              netReceivedAud: '2990.00',
              customerValueAud: null,
              internalValueAud: null,
            },
          },
        })}
      />,
      { path: '/projects', auth: signedIn() },
    );
    expect(await screen.findByText(/\$2,990\.00 after \$50\.00/)).toBeDefined();
    expect(screen.getByText('$1,900.00')).toBeDefined();
    expect(screen.getByText(/Not connected yet/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});
