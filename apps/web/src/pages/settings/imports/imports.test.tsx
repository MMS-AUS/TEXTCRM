import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { IMPORT_FIELDS } from '@mms/shared';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { fakeAuth, fullAccessProfile, renderPage, type TrpcCall } from '../../../test/render.tsx';
import { ImportPage } from './ImportPage.tsx';
import { ImportsPage } from './ImportsPage.tsx';

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });
const id = '33333333-3333-4333-8333-333333333333';

class FakeXhr {
  static puts: { url: string; contentType: string | null }[] = [];
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  private url = '';
  private contentType: string | null = null;
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    if (name.toLowerCase() === 'content-type') this.contentType = value;
  }
  send() {
    FakeXhr.puts.push({ url: this.url, contentType: this.contentType });
    this.status = 200;
    queueMicrotask(() => this.onload?.());
  }
}

const job = (overrides: object = {}) => ({
  id,
  target: 'leads',
  sourceType: 'upload',
  sourceName: 'history.csv',
  sheetTab: null,
  status: 'ready',
  totalRows: 5,
  processedRows: 0,
  counts: { create: 0, update: 0, skip: 0, error: 0 },
  error: null,
  createdByName: 'Micky',
  createdAt: '2026-11-04T01:00:00.000Z',
  finishedAt: null,
  mapping: null,
  ...overrides,
});

const source = (mapping: Record<string, string>) => ({
  tabs: [],
  tab: null,
  headers: ['Lead ID', 'Name', 'Phone'],
  rowCount: 5,
  sampleRows: [['101', 'Olivia Nguyen', '0412 345 678']],
  mapping,
});

const fullMapping = { sheetLeadId: 'Lead ID', firstName: 'Name', mobile: 'Phone' };

describe('import wizard', () => {
  beforeEach(() => {
    FakeXhr.puts = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uploads the file to storage, checks it, then opens the import', async () => {
    const calls: TrpcCall[] = [];
    const router = renderPage(<ImportsPage />, {
      path: '/settings/imports/',
      url: '/settings/imports/',
      auth: signedIn(),
      calls,
      responses: {
        'imports.setup': {
          targets: ['leads', 'contacts'],
          uploadsEnabled: true,
          googleSheets: null,
          jobsEnabled: true,
        },
        'imports.list': [],
        'imports.createUpload': {
          id,
          contentType: 'text/csv',
          uploadUrl: 'http://storage.test/put',
        },
        'imports.completeUpload': { id },
      },
    });
    const file = new File(['Name,Phone\nOlivia,0412'], 'history.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Choose a spreadsheet to upload'), {
      target: { files: [file] },
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/settings/imports/${id}`);
    });
    expect(FakeXhr.puts).toEqual([{ url: 'http://storage.test/put', contentType: 'text/csv' }]);
    expect(calls.find((c) => c.path === 'imports.createUpload')?.input).toEqual({
      target: 'leads',
      fileName: 'history.csv',
      sizeBytes: file.size,
    });
  });

  it('downloads the Excel template for the chosen target', async () => {
    const calls: TrpcCall[] = [];
    const saved: Blob[] = [];
    // jsdom doesn't define these, so they are added for this test and removed afterwards.
    URL.createObjectURL = (blob: Blob) => {
      saved.push(blob);
      return 'blob:template';
    };
    URL.revokeObjectURL = () => undefined;
    onTestFinished(() => {
      Reflect.deleteProperty(URL, 'createObjectURL');
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage(<ImportsPage />, {
      path: '/settings/imports/',
      auth: signedIn(),
      calls,
      responses: {
        'imports.setup': {
          targets: ['leads'],
          uploadsEnabled: true,
          googleSheets: null,
          jobsEnabled: true,
        },
        'imports.list': [],
        'imports.template': { fileName: 'leads template.xlsx', base64: btoa('PK-bytes') },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Download template/ }));
    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(calls.find((c) => c.path === 'imports.template')?.input).toEqual({ target: 'leads' });
    expect(saved[0]?.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('skips column matching for a file made from the template', async () => {
    const mapping = Object.fromEntries(
      IMPORT_FIELDS.leads.map((field) => [field.key, field.label]),
    );
    renderPage(<ImportPage />, {
      path: '/settings/imports/$importId',
      url: `/settings/imports/${id}`,
      auth: signedIn(),
      responses: {
        'imports.get': job({
          status: 'previewed',
          mapping,
          counts: { create: 1, update: 0, skip: 0, error: 0 },
        }),
        'imports.rows': { total: 0, rows: [] },
      },
    });
    expect(await screen.findByText('1 · Columns matched')).toBeDefined();
    expect(screen.queryByText('1 · Match the columns')).toBeNull();
    expect(screen.getByRole('button', { name: 'Import 1 row' })).toBeDefined();
  });

  it('refuses other file types before uploading', async () => {
    renderPage(<ImportsPage />, {
      path: '/settings/imports/',
      auth: signedIn(),
      responses: {
        'imports.setup': {
          targets: ['leads'],
          uploadsEnabled: true,
          googleSheets: null,
          jobsEnabled: true,
        },
        'imports.list': [],
      },
    });
    fireEvent.change(await screen.findByLabelText('Choose a spreadsheet to upload'), {
      target: { files: [new File(['x'], 'old.xls')] },
    });
    expect(await screen.findByText(/save it as .xlsx first/)).toBeDefined();
    expect(FakeXhr.puts).toHaveLength(0);
  });

  it('shows the suggested mapping and blocks preview until a name and contact are mapped', async () => {
    renderPage(<ImportPage />, {
      path: '/settings/imports/$importId',
      url: `/settings/imports/${id}`,
      auth: signedIn(),
      responses: { 'imports.get': job(), 'imports.source': source({ firstName: 'Name' }) },
    });
    expect(await screen.findByText('1 · Match the columns')).toBeDefined();
    expect(screen.getByText('Olivia Nguyen')).toBeDefined();
    expect(screen.getByText(/Map a mobile or an email column/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Preview' }).hasAttribute('disabled')).toBe(true);
  });

  it('previews with the chosen mapping', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<ImportPage />, {
      path: '/settings/imports/$importId',
      url: `/settings/imports/${id}`,
      auth: signedIn(),
      calls,
      responses: {
        'imports.get': job(),
        'imports.source': source(fullMapping),
        'imports.preview': { counts: { create: 5, update: 0, skip: 0, error: 0 }, totalRows: 5 },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === 'imports.preview')?.input).toEqual({
        id,
        mapping: fullMapping,
      });
    });
  });

  it('shows what each row will do and imports on confirmation', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<ImportPage />, {
      path: '/settings/imports/$importId',
      url: `/settings/imports/${id}`,
      auth: signedIn(),
      calls,
      responses: {
        'imports.get': job({
          status: 'previewed',
          mapping: fullMapping,
          counts: { create: 2, update: 1, skip: 1, error: 1 },
        }),
        'imports.source': source(fullMapping),
        'imports.rows': {
          total: 2,
          rows: [
            {
              rowNumber: 2,
              data: { firstName: 'Olivia Nguyen', mobile: '0412 345 678' },
              action: 'create',
              message: null,
              recordId: null,
              applied: false,
            },
            {
              rowNumber: 3,
              data: { firstName: 'Jack' },
              action: 'error',
              message: 'Lead date "31/2/2026" isn\'t a date (use day/month/year).',
              recordId: null,
              applied: false,
            },
          ],
        },
        'imports.start': { id },
      },
    });
    expect(await screen.findByText(/isn't a date/)).toBeDefined();
    expect(screen.getAllByText('Will create').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Rows not imported/ })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 rows' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path === 'imports.start')).toBe(true);
    });
  });

  it('follows a running import', async () => {
    renderPage(<ImportPage />, {
      path: '/settings/imports/$importId',
      url: `/settings/imports/${id}`,
      auth: signedIn(),
      responses: { 'imports.get': job({ status: 'running', totalRows: 200, processedRows: 50 }) },
    });
    expect(await screen.findByText('50 of 200 rows')).toBeDefined();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
  });
});
