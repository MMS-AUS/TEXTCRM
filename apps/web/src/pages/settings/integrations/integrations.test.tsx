import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '../../../ui/index.ts';
import { fakeAuth, fullAccessProfile, renderPage, type TrpcCall } from '../../../test/render.tsx';
import { IntegrationsPage } from './IntegrationsPage.tsx';

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });
const now = new Date().toISOString();

const status = {
  providers: [
    {
      provider: 'gmail',
      label: 'Gmail',
      owner: 'user',
      purpose: 'Each person connects their own mailbox.',
      problem: null,
      connection: {
        status: 'connected',
        account: 'sam@makemysolar.com.au',
        lastCheckedAt: now,
        lastError: null,
        connectedAt: now,
      },
      credentialsFrom: null,
      xeroChoices: [],
    },
    {
      provider: 'xero',
      label: 'Xero',
      owner: 'organisation',
      purpose: 'The business Xero organisation.',
      problem: null,
      connection: {
        status: 'needs_tenant',
        account: null,
        lastCheckedAt: now,
        lastError: null,
        connectedAt: now,
      },
      credentialsFrom: null,
      xeroChoices: [
        { tenantId: '11111111-1111-4111-8111-111111111111', name: 'Demo Company (AU)' },
        { tenantId: '22222222-2222-4222-8222-222222222222', name: 'Make My Solar' },
      ],
    },
    {
      provider: 'messagemedia',
      label: 'MessageMedia SMS',
      owner: 'organisation',
      purpose: 'SMS through the business account.',
      problem: null,
      connection: null,
      credentialsFrom: null,
      xeroChoices: [],
    },
  ],
  mailboxes: [{ user: 'Sam', account: 'sam@makemysolar.com.au', status: 'connected' }],
};

const card = (name: string) => {
  const title = screen.getByText(name, { selector: '[data-slot="card"] *' });
  const found = title.closest('[data-slot="card"]');
  if (!(found instanceof HTMLElement)) throw new Error(`no card for ${name}`);
  return within(found);
};

describe('Settings → Integrations', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows each integration’s state, the Xero organisation choice and the MessageMedia form', async () => {
    renderPage(<IntegrationsPage />, {
      path: '/settings/integrations',
      auth: signedIn(),
      responses: { 'integrations.status': status },
    });
    expect(await screen.findByText('sam@makemysolar.com.au', { selector: 'dd' })).toBeDefined();
    expect(card('Gmail').getByText('Connected')).toBeDefined();
    expect(card('Gmail').getByRole('button', { name: 'Reconnect' })).toBeDefined();
    expect(card('Gmail').getByRole('button', { name: 'Disconnect' })).toBeDefined();
    expect(card('Xero').getByText('Choose an organisation')).toBeDefined();
    expect(card('Xero').getByRole('button', { name: 'Use this organisation' })).toBeDefined();
    expect(card('MessageMedia SMS').getByLabelText(/API key/)).toBeDefined();
    expect(
      card('MessageMedia SMS')
        .getByRole('button', { name: 'Test connection' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByRole('table', { name: 'Connected mailboxes' })).toBeDefined();
  });

  it('Test connection shows what the provider said', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<IntegrationsPage />, {
      path: '/settings/integrations',
      auth: signedIn(),
      calls,
      responses: {
        'integrations.status': status,
        'integrations.test': {
          ok: true,
          status: 'connected',
          message: 'Gmail is working for sam@makemysolar.com.au (1,234 messages).',
          account: 'sam@makemysolar.com.au',
        },
      },
    });
    await screen.findByText('sam@makemysolar.com.au', { selector: 'dd' });
    fireEvent.click(card('Gmail').getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/1,234 messages/)).toBeDefined();
    expect(calls.find((c) => c.path === 'integrations.test')?.input).toEqual({ provider: 'gmail' });
  });

  it('Connect opens the provider in a popup', async () => {
    const popup = { closed: false, close: vi.fn(), location: { href: '' } };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    renderPage(<IntegrationsPage />, {
      path: '/settings/integrations',
      auth: signedIn(),
      responses: {
        'integrations.status': status,
        'integrations.connect': { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc' },
      },
    });
    await screen.findByText('sam@makemysolar.com.au', { selector: 'dd' });
    fireEvent.click(card('Gmail').getByRole('button', { name: 'Reconnect' }));
    expect(open).toHaveBeenCalledWith('', 'mms-oauth', expect.stringContaining('popup'));
    await waitFor(() => {
      expect(popup.location.href).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=abc');
    });
  });

  it('coming back from the provider in the same tab shows the result', async () => {
    renderPage(
      <>
        <IntegrationsPage />
        <Toaster />
      </>,
      {
        path: '/settings/integrations',
        url: '/settings/integrations?provider=xero&result=error&message=The%20connection%20was%20cancelled.',
        auth: signedIn(),
        responses: { 'integrations.status': status },
      },
    );
    expect(await screen.findByText("Xero wasn't connected")).toBeDefined();
    expect(screen.getByText('The connection was cancelled.')).toBeDefined();
  });
});
