import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAuth, fullAccessProfile, renderPage, type TrpcCall } from '../test/render.tsx';
import { FilesPanel } from './FilesPanel.tsx';

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });
const leadId = '11111111-1111-4111-8111-111111111111';

const stored = {
  id: '22222222-2222-4222-8222-222222222222',
  category: 'bill',
  fileName: 'October bill.pdf',
  contentType: 'application/pdf',
  sizeBytes: 182_000,
  createdAt: '2026-11-02T03:00:00.000Z',
  uploadedByUserId: 'someone-else',
  uploaderName: 'Simon',
  canOpenInBrowser: true,
  thumbnailUrl: null,
};

/** Records PUTs to storage instead of sending them. */
class FakeXhr {
  static puts: { url: string; contentType: string | null; size: number }[] = [];
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
  send(body: Blob) {
    FakeXhr.puts.push({ url: this.url, contentType: this.contentType, size: body.size });
    this.status = 200;
    queueMicrotask(() => this.onload?.());
  }
}

describe('FilesPanel', () => {
  beforeEach(() => {
    FakeXhr.puts = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists files with their category, size and uploader', async () => {
    renderPage(<FilesPanel entityType="lead" entityId={leadId} />, {
      path: '/leads',
      auth: signedIn(),
      responses: { 'files.list': [stored] },
    });
    const list = await screen.findByRole('list', { name: 'Files' });
    expect(within(list).getByText('October bill.pdf')).toBeDefined();
    expect(within(list).getByText('Electricity bill')).toBeDefined();
    expect(within(list).getByText(/178 KB · 2 Nov 2026 · Simon/)).toBeDefined();
  });

  it('asks for an upload URL, sends the bytes to storage, then confirms', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<FilesPanel entityType="lead" entityId={leadId} />, {
      path: '/leads',
      auth: signedIn(),
      calls,
      responses: {
        'files.list': [],
        'files.createUpload': {
          id: stored.id,
          contentType: 'application/pdf',
          uploadUrl: 'http://storage.test/presigned-put',
          thumbnailUploadUrl: null,
        },
        'files.completeUpload': { id: stored.id },
      },
    });
    const pdf = new File(['%PDF-1.4 hello'], 'bill.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Choose files to upload'), {
      target: { files: [pdf] },
    });

    await waitFor(() => {
      expect(calls.some((c) => c.path === 'files.completeUpload')).toBe(true);
    });
    expect(calls.find((c) => c.path === 'files.createUpload')?.input).toMatchObject({
      entityType: 'lead',
      entityId: leadId,
      category: 'bill',
      fileName: 'bill.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.size,
    });
    expect(FakeXhr.puts).toEqual([
      { url: 'http://storage.test/presigned-put', contentType: 'application/pdf', size: pdf.size },
    ]);
  });

  it('refuses file types that are not accepted before contacting the server', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<FilesPanel entityType="lead" entityId={leadId} />, {
      path: '/leads',
      auth: signedIn(),
      calls,
      responses: { 'files.list': [] },
    });
    fireEvent.change(await screen.findByLabelText('Choose files to upload'), {
      target: { files: [new File(['x'], 'setup.exe', { type: 'application/x-msdownload' })] },
    });
    expect(await screen.findByText(/type of file is not accepted/)).toBeDefined();
    expect(calls.some((c) => c.path === 'files.createUpload')).toBe(false);
  });
});
