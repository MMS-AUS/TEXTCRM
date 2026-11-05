import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyPermissionMatrix } from '@mms/shared';
import {
  fakeAuth,
  fakeProfile,
  fullAccessProfile,
  renderPage,
  type TrpcCall,
} from '../../test/render.tsx';
import { ComposeButtons } from './ComposeDialogs.tsx';
import { MessagesPanel } from './MessagesPanel.tsx';

// TipTap can't be typed into under jsdom; a textarea stands in (the editor has its own test).
vi.mock('../../ui/RichTextEditor.tsx', () => ({
  RichTextEditor: ({
    label,
    onChange,
    footer,
  }: {
    label: string;
    onChange: (h: string, t: string) => void;
    footer?: ReactNode;
  }) => (
    <>
      <label>
        {label}
        <textarea
          onChange={(event) => {
            onChange(`<p>${event.target.value}</p>`, event.target.value);
          }}
        />
      </label>
      {footer}
    </>
  ),
}));

// Uploads go straight to storage from the browser; here they just succeed.
vi.mock('../../lib/upload.ts', () => ({
  putWithProgress: vi.fn(() => Promise.resolve()),
}));

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });
const leadId = '99999999-9999-4999-8999-999999999999';
const target = {
  entityType: 'lead' as const,
  entityId: leadId,
  phone: '+61412345678',
  email: 'olivia@example.com',
  name: 'Olivia Nguyen',
};

const status = (gmail: object | null) => ({
  providers: [
    {
      provider: 'gmail',
      label: 'Gmail',
      owner: 'user',
      purpose: '',
      problem: null,
      connection: gmail,
      credentialsFrom: null,
      xeroChoices: [],
    },
  ],
  mailboxes: [],
});

describe('compose SMS and email', () => {
  afterEach(cleanup);

  it('counts SMS characters and parts as you type, and sends to the record', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<ComposeButtons target={target} />, {
      path: '/leads/$leadId',
      url: `/leads/${leadId}`,
      auth: signedIn(),
      calls,
      responses: {
        'messaging.sendSms': {
          id: 'sms-1',
          status: 'sent',
          to: '+61412345678',
          segments: 1,
          deliveryReports: false,
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Send SMS' }));
    const dialog = await screen.findByRole('dialog', { name: 'SMS to Olivia Nguyen' });
    expect(within(dialog).getByLabelText<HTMLInputElement>(/To/).value).toBe('0412 345 678');
    const message = within(dialog).getByLabelText(/Message/);
    fireEvent.change(message, { target: { value: 'a'.repeat(161) } });
    expect(
      within(dialog).getByText(/161 characters · 2 SMS parts · 145 left in this part/),
    ).toBeDefined();
    fireEvent.change(message, { target: { value: 'Your quote is ready 👍' } });
    expect(within(dialog).getByText(/fits 70 characters instead of 160/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send SMS' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === 'messaging.sendSms')?.input).toEqual({
        entityType: 'lead',
        entityId: leadId,
        content: 'Your quote is ready 👍',
      });
    });
  });

  it('email asks you to connect Gmail first when it isn’t connected', async () => {
    renderPage(<ComposeButtons target={target} />, {
      path: '/leads/$leadId',
      url: `/leads/${leadId}`,
      auth: signedIn(),
      responses: { 'integrations.status': status(null) },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Send email' }));
    const dialog = await screen.findByRole('dialog', { name: 'Email to Olivia Nguyen' });
    expect(await within(dialog).findByText('Connect your Gmail first')).toBeDefined();
    expect(within(dialog).getByLabelText<HTMLInputElement>(/^To/).value).toBe('olivia@example.com');
    expect(within(dialog).getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('sends an email with To, CC, subject and body', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<ComposeButtons target={target} />, {
      path: '/leads/$leadId',
      url: `/leads/${leadId}`,
      auth: signedIn(),
      calls,
      responses: {
        'integrations.status': status({
          status: 'connected',
          account: 'sam@makemysolar.com.au',
          lastCheckedAt: null,
          lastError: null,
          connectedAt: new Date().toISOString(),
        }),
        'messaging.sendEmail': { id: 'e-1', to: ['olivia@example.com'], threadId: 't-1' },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Send email' }));
    const dialog = await screen.findByRole('dialog', { name: 'Email to Olivia Nguyen' });
    expect(await within(dialog).findByText('From sam@makemysolar.com.au')).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText(/^CC/), {
      target: { value: 'micky@makemysolar.com.au' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Subject/), { target: { value: 'Your quote' } });
    fireEvent.change(within(dialog).getByLabelText(/Message/), { target: { value: 'Hi Olivia' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === 'messaging.sendEmail')?.input).toEqual({
        entityType: 'lead',
        entityId: leadId,
        to: ['olivia@example.com'],
        cc: ['micky@makemysolar.com.au'],
        subject: 'Your quote',
        html: '<p>Hi Olivia</p>',
        attachmentIds: [],
        includeSignature: false,
      });
    });
  });

  it('is hidden for roles that can’t edit the record', async () => {
    const viewer = emptyPermissionMatrix();
    viewer.leads.view = true;
    renderPage(
      <>
        <p>page ready</p>
        <ComposeButtons target={target} />
      </>,
      {
        path: '/leads/$leadId',
        url: `/leads/${leadId}`,
        auth: fakeAuth({ status: 'signedIn', profile: { ...fakeProfile, permissions: viewer } }),
        responses: {},
      },
    );
    expect(await screen.findByText('page ready')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Send SMS' })).toBeNull();
  });
});

describe('MessagesPanel', () => {
  afterEach(cleanup);

  it('lists SMS and email with status, parts and where they came from', async () => {
    const now = new Date().toISOString();
    renderPage(<MessagesPanel entityType="contact" entityId={leadId} />, {
      path: '/contacts/$contactId',
      url: `/contacts/${leadId}`,
      auth: signedIn(),
      responses: {
        'messaging.history': [
          {
            kind: 'sms',
            id: 's2',
            direction: 'inbound',
            from: '+61412345678',
            to: ['MakeMySolar'],
            cc: [],
            subject: null,
            body: 'Yes please',
            segments: 1,
            status: 'received',
            statusAt: now,
            error: null,
            senderName: null,
            source: null,
            createdAt: now,
            files: [],
          },
          {
            kind: 'email',
            id: 'e1',
            direction: 'outbound',
            from: 'sam@makemysolar.com.au',
            to: ['olivia@example.com'],
            cc: [],
            subject: 'Your quote',
            body: 'Hi Olivia',
            segments: null,
            status: 'sent',
            statusAt: now,
            error: null,
            senderName: 'Sam',
            source: { entityType: 'ticket', entityId: '11111111-1111-4111-8111-111111111111' },
            createdAt: now,
            files: [],
          },
          {
            kind: 'sms',
            id: 's1',
            direction: 'outbound',
            from: 'MakeMySolar',
            to: ['+61412345678'],
            cc: [],
            subject: null,
            body: 'a'.repeat(200),
            segments: 2,
            status: 'failed',
            statusAt: now,
            error: 'Invalid destination number',
            senderName: 'Sam',
            source: null,
            createdAt: now,
            files: [],
          },
        ],
      },
    });
    const list = await screen.findByRole('list', { name: 'Messages' });
    expect(within(list).getByText('SMS from 0412 345 678')).toBeDefined();
    expect(within(list).getByText('Received')).toBeDefined();
    expect(within(list).getByText('Your quote')).toBeDefined();
    expect(within(list).getByRole('link', { name: 'From a ticket' })).toBeDefined();
    expect(within(list).getByText('Not sent')).toBeDefined();
    expect(within(list).getByText('2 parts')).toBeDefined();
    expect(within(list).getByText('Invalid destination number')).toBeDefined();
  });

  it('shows a received email’s formatting and replies to it in the same thread', async () => {
    const now = new Date().toISOString();
    const calls: TrpcCall[] = [];
    renderPage(<MessagesPanel entityType="contact" entityId={leadId} />, {
      path: '/contacts/$contactId',
      url: `/contacts/${leadId}`,
      auth: signedIn(),
      calls,
      responses: {
        'integrations.status': status({
          status: 'connected',
          account: 'micky@makemysolar.com.au',
          lastCheckedAt: null,
          lastError: null,
          connectedAt: now,
        }),
        'messaging.sendEmail': { id: 'e-2', to: ['jack@example.com'], threadId: 'th-1' },
        'messaging.history': [
          {
            kind: 'email',
            id: '22222222-2222-4222-8222-222222222222',
            direction: 'inbound',
            from: 'jack@example.com',
            to: ['micky@makemysolar.com.au'],
            cc: [],
            subject: 'Install date',
            body: 'Friday works.',
            html: '<p><strong>Friday</strong> works.</p>',
            attachments: 2,
            inReplyToId: null,
            segments: null,
            status: 'received',
            statusAt: now,
            error: null,
            senderName: null,
            source: null,
            createdAt: now,
            files: [],
          },
        ],
      },
    });
    const list = await screen.findByRole('list', { name: 'Messages' });
    expect(within(list).getByText('Email from jack@example.com')).toBeDefined();
    expect(within(list).getByText('Friday').tagName).toBe('STRONG');
    expect(within(list).getByText(/2 attachments/)).toBeDefined();
    fireEvent.click(within(list).getByRole('button', { name: 'Reply' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reply to jack@example.com' });
    expect(within(dialog).getByLabelText<HTMLInputElement>(/^To/).value).toBe('jack@example.com');
    expect(within(dialog).getByLabelText<HTMLInputElement>(/Subject/).value).toBe(
      'Re: Install date',
    );
    await within(dialog).findByText('From micky@makemysolar.com.au');
    fireEvent.change(within(dialog).getByLabelText(/Message/), {
      target: { value: 'See you then' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === 'messaging.sendEmail')?.input).toEqual({
        entityType: 'contact',
        entityId: leadId,
        to: ['jack@example.com'],
        cc: [],
        subject: 'Re: Install date',
        html: '<p>See you then</p>',
        replyToId: '22222222-2222-4222-8222-222222222222',
        attachmentIds: [],
        includeSignature: false,
      });
    });
  });
});

describe('MessagesPanel: colleagues', () => {
  afterEach(cleanup);

  it('shows a colleague’s reply-all with their name, without a Reply button', async () => {
    const now = new Date().toISOString();
    renderPage(<MessagesPanel entityType="contact" entityId={leadId} />, {
      path: '/contacts/$contactId',
      url: `/contacts/${leadId}`,
      auth: signedIn(),
      responses: {
        'messaging.drafts': [],
        'messaging.history': [
          {
            kind: 'email',
            id: '77777777-7777-4777-8777-777777777777',
            direction: 'inbound',
            from: 'sam@makemysolar.com.au',
            to: ['micky@makemysolar.com.au'],
            cc: ['jack@example.com'],
            subject: 'Re: Install',
            body: 'Friday it is.',
            html: '<p>Friday it is.</p>',
            attachments: 0,
            inReplyToId: null,
            fromStaff: true,
            segments: null,
            status: 'received',
            statusAt: now,
            error: null,
            senderName: 'Sam',
            source: null,
            createdAt: now,
            files: [],
          },
        ],
      },
    });
    const list = await screen.findByRole('list', { name: 'Messages' });
    expect(within(list).getByText('Email from Sam (sam@makemysolar.com.au)')).toBeDefined();
    expect(within(list).queryByRole('button', { name: 'Reply' })).toBeNull();
  });
});

describe('email composer extras', () => {
  afterEach(cleanup);

  const gmail = () =>
    status({
      status: 'connected',
      account: 'micky@makemysolar.com.au',
      lastCheckedAt: null,
      lastError: null,
      connectedAt: new Date().toISOString(),
    });
  const signature = (enabled: boolean) => ({
    saved: true,
    fields: { enabled },
    hasLogo: false,
    logoUrl: null,
    previewHtml: '<table class="mms-signature"><tr><td>Micky Singh</td></tr></table>',
    storageReady: true,
  });

  it('uploads attachments, adds the signature and sends both', async () => {
    const calls: TrpcCall[] = [];
    renderPage(<ComposeButtons target={target} />, {
      path: '/leads/$leadId',
      url: `/leads/${leadId}`,
      auth: signedIn(),
      calls,
      responses: {
        'integrations.status': gmail(),
        'messaging.signature': signature(true),
        'messaging.attachmentUpload': {
          id: '33333333-3333-4333-8333-333333333333',
          contentType: 'application/pdf',
          uploadUrl: 'https://storage.example/put',
        },
        'messaging.attachmentComplete': { id: '33333333-3333-4333-8333-333333333333' },
        'messaging.sendEmail': {
          id: 'e-3',
          to: ['olivia@example.com'],
          threadId: 't',
          attachments: 1,
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Send email' }));
    const dialog = await screen.findByRole('dialog', { name: 'Email to Olivia Nguyen' });
    // The saved signature is on by default and shown under the message.
    expect(await within(dialog).findByText('Micky Singh')).toBeDefined();
    expect(
      within(dialog)
        .getByRole('checkbox', { name: 'Add my signature' })
        .getAttribute('aria-checked'),
    ).toBe('true');

    const chooser = within(dialog).getByLabelText<HTMLInputElement>('Choose files to attach');
    fireEvent.change(chooser, {
      target: {
        files: [
          new File(['%PDF'], 'quote.pdf', { type: 'application/pdf' }),
          new File(['MZ'], 'virus.exe', { type: 'application/octet-stream' }),
        ],
      },
    });
    expect(await within(dialog).findByText(/virus.exe: attach PDFs or images/)).toBeDefined();
    const files = await within(dialog).findByRole('list', { name: 'Attachments' });
    expect(within(files).getByText('quote.pdf')).toBeDefined();
    await waitFor(() => {
      expect(calls.some((c) => c.path === 'messaging.attachmentComplete')).toBe(true);
    });
    expect(calls.find((c) => c.path === 'messaging.attachmentUpload')?.input).toEqual({
      fileName: 'quote.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4,
    });

    fireEvent.change(within(dialog).getByLabelText(/Subject/), { target: { value: 'Quote' } });
    fireEvent.change(within(dialog).getByLabelText(/Message/), { target: { value: 'Attached' } });
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(
        false,
      );
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === 'messaging.sendEmail')?.input).toMatchObject({
        attachmentIds: ['33333333-3333-4333-8333-333333333333'],
        includeSignature: true,
      });
    });
  });

  it('saves a draft, and a draft reopens from the Messages tab', async () => {
    const calls: TrpcCall[] = [];
    renderPage(
      <>
        <ComposeButtons target={target} />
        <MessagesPanel entityType="lead" entityId={leadId} />
      </>,
      {
        path: '/leads/$leadId',
        url: `/leads/${leadId}`,
        auth: signedIn(),
        calls,
        responses: {
          'integrations.status': gmail(),
          'messaging.signature': signature(false),
          'messaging.history': [],
          'messaging.draftSave': { id: '44444444-4444-4444-8444-444444444444', savedAt: '' },
          'messaging.drafts': [
            {
              id: '55555555-5555-4555-8555-555555555555',
              to: ['olivia@example.com'],
              cc: [],
              subject: 'Half-written quote',
              html: '<p>So far</p>',
              replyToId: null,
              includeSignature: true,
              updatedAt: new Date().toISOString(),
              attachments: [
                {
                  id: '66666666-6666-4666-8666-666666666666',
                  fileName: 'plan.pdf',
                  contentType: 'application/pdf',
                  sizeBytes: 2048,
                },
              ],
            },
          ],
        },
      },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Send email' }));
    const dialog = await screen.findByRole('dialog', { name: 'Email to Olivia Nguyen' });
    fireEvent.change(within(dialog).getByLabelText(/Subject/), { target: { value: 'Later' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === 'messaging.draftSave')?.input).toEqual({
        entityType: 'lead',
        entityId: leadId,
        to: ['olivia@example.com'],
        cc: [],
        subject: 'Later',
        html: '',
        includeSignature: false,
        attachmentIds: [],
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    const drafts = await screen.findByRole('region', { name: 'Your drafts' });
    expect(within(drafts).getByText('Half-written quote')).toBeDefined();
    fireEvent.click(within(drafts).getByRole('button', { name: 'Continue' }));
    const reopened = await screen.findByRole('dialog', { name: 'Draft: Half-written quote' });
    expect(within(reopened).getByLabelText<HTMLInputElement>(/Subject/).value).toBe(
      'Half-written quote',
    );
    expect(within(reopened).getByText('plan.pdf')).toBeDefined();
    expect(
      within(reopened)
        .getByRole('checkbox', { name: 'Add my signature' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(within(reopened).getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === 'messaging.sendEmail')?.input).toMatchObject({
        subject: 'Half-written quote',
        html: '<p>So far</p>',
        draftId: '55555555-5555-4555-8555-555555555555',
        attachmentIds: ['66666666-6666-4666-8666-666666666666'],
        includeSignature: true,
      });
    });
  });
});
