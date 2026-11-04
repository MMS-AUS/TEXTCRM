import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAuth, fullAccessProfile, renderPage, type TrpcCall } from '../../../test/render.tsx';
import { NewSheetSourcePage, SheetSourcePage } from './SheetSourcePage.tsx';
import { SheetSyncPage } from './SheetSyncPage.tsx';

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });
const sourceId = '44444444-4444-4444-8444-444444444444';
const runId = '55555555-5555-4555-8555-555555555555';
const SHEET_ID = '1mkYuqi8cuit0N2dPlraGi87OYwYFNK0Z55M3zlibu-c';
const setup = {
  serviceAccountEmail: 'crm-sync@mms.iam.gserviceaccount.com',
  intervalMinutes: 5,
  jobsEnabled: true,
};
const run = {
  id: runId,
  trigger: 'schedule',
  status: 'completed',
  startedAt: '2026-11-04T01:00:00.000Z',
  finishedAt: '2026-11-04T01:00:03.000Z',
  rowsRead: 8,
  created: 2,
  updated: 1,
  linked: 0,
  skipped: 1,
  errors: 0,
  error: null,
};

describe('live sheet sync settings', () => {
  afterEach(cleanup);

  it('lists synced sheets with their last run, and Sync now queues a run', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<SheetSyncPage />, {
      path: '/settings/sheet-sync/',
      auth: signedIn(),
      calls,
      responses: {
        'sheetSync.setup': setup,
        'sheetSync.list': [
          {
            id: sourceId,
            name: 'Website leads',
            spreadsheetTitle: 'Lead Management',
            sheetTab: 'Sheet1',
            url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
            enabled: true,
            leads: 7,
            lastRun: run,
          },
        ],
        'sheetSync.syncNow': { id: sourceId },
      },
    });
    expect(await screen.findByText('Website leads')).toBeDefined();
    expect(screen.getByText('2 new · 1 updated · 1 skipped')).toBeDefined();
    expect(screen.getByText(/every 5 minutes/)).toBeDefined();
    expect(screen.getByText('crm-sync@mms.iam.gserviceaccount.com')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === 'sheetSync.syncNow')?.input).toEqual({ id: sourceId });
    });
  });

  it('adding a sheet: reads it, warns when there is no Lead ID column and blocks saving', async () => {
    renderPage(<NewSheetSourcePage />, {
      path: '/settings/sheet-sync/new',
      auth: signedIn(),
      responses: {
        'sheetSync.setup': setup,
        'sheetSync.inspect': {
          spreadsheetId: SHEET_ID,
          title: 'Lead Management',
          tabs: ['Sheet1'],
        },
        'sheetSync.columns': {
          headers: ['Lead Date', 'First Name', 'Primary Mobile'],
          rowCount: 7,
          sampleRows: [['3/11/2026', 'Olivia', '0412 345 678']],
          mapping: { leadDate: 'Lead Date', firstName: 'First Name', mobile: 'Primary Mobile' },
        },
      },
    });
    fireEvent.change(await screen.findByLabelText('Google Sheet link'), {
      target: { value: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read sheet' }));
    expect(await screen.findByText('This tab has no Lead ID column')).toBeDefined();
    expect(screen.getByText(/Map the Lead ID column/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add sheet' }).hasAttribute('disabled')).toBe(true);
  });

  it('adding a sheet with a Lead ID column saves the suggested mapping', async () => {
    const calls: TrpcCall[] = [];
    const mapping = { sheetLeadId: 'Lead ID', firstName: 'First Name', mobile: 'Primary Mobile' };
    const router = renderPage(<NewSheetSourcePage />, {
      path: '/settings/sheet-sync/new',
      auth: signedIn(),
      calls,
      responses: {
        'sheetSync.setup': setup,
        'sheetSync.inspect': {
          spreadsheetId: SHEET_ID,
          title: 'Lead Management',
          tabs: ['Sheet1'],
        },
        'sheetSync.columns': {
          headers: ['Lead ID', 'First Name', 'Primary Mobile'],
          rowCount: 7,
          sampleRows: [['1', 'Olivia', '0412 345 678']],
          mapping,
        },
        'sheetSync.save': { id: sourceId },
      },
    });
    fireEvent.change(await screen.findByLabelText('Google Sheet link'), {
      target: { value: SHEET_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read sheet' }));
    const add = await screen.findByRole('button', { name: 'Add sheet' });
    await waitFor(() => {
      expect(add.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(add);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/settings/sheet-sync/${sourceId}`);
    });
    expect(calls.find((c) => c.path === 'sheetSync.save')?.input).toEqual({
      name: 'Lead Management',
      spreadsheetId: SHEET_ID,
      tab: 'Sheet1',
      mapping,
      enabled: true,
    });
  });

  it('shows the history and a run’s row messages', async () => {
    renderPage(<SheetSourcePage />, {
      path: '/settings/sheet-sync/$sourceId',
      url: `/settings/sheet-sync/${sourceId}`,
      auth: signedIn(),
      responses: {
        'sheetSync.setup': setup,
        'sheetSync.get': {
          id: sourceId,
          name: 'Website leads',
          spreadsheetId: SHEET_ID,
          spreadsheetTitle: 'Lead Management',
          sheetTab: 'Sheet1',
          url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
          mapping: { sheetLeadId: 'Lead ID', firstName: 'First Name', mobile: 'Primary Mobile' },
          enabled: true,
          updatedByName: 'Micky',
          updatedAt: '2026-11-04T00:00:00.000Z',
        },
        'sheetSync.columns': {
          headers: ['Lead ID', 'First Name', 'Primary Mobile'],
          rowCount: 1,
          sampleRows: [],
          mapping: {},
        },
        'sheetSync.runs': { total: 1, runs: [run] },
        'sheetSync.runErrors': [
          {
            rowNumber: 9,
            sheetLeadId: null,
            message: 'No Lead ID — skipped. Give the row a Lead ID and it is picked up next run.',
          },
        ],
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Show row messages' }));
    expect(await screen.findByText(/No Lead ID — skipped/)).toBeDefined();
    expect(screen.getByText('Row 9')).toBeDefined();
  });
});
