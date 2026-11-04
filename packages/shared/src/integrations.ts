import { z } from 'zod';

// Integrations (Phase 5): which providers exist, whose they are, and their connection states.

export const INTEGRATION_PROVIDERS = ['gmail', 'xero', 'messagemedia'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_INFO: Record<
  IntegrationProvider,
  { label: string; owner: 'user' | 'organisation'; how: 'oauth' | 'api-key'; purpose: string }
> = {
  gmail: {
    label: 'Gmail',
    owner: 'user',
    how: 'oauth',
    purpose: 'Each person connects their own mailbox to send and log email.',
  },
  xero: {
    label: 'Xero',
    owner: 'organisation',
    how: 'oauth',
    purpose: 'The business Xero organisation, for invoices and payments.',
  },
  messagemedia: {
    label: 'MessageMedia SMS',
    owner: 'organisation',
    how: 'api-key',
    purpose: 'Sends and receives SMS through the business MessageMedia account.',
  },
};

/**
 * connected — working at the last check · needs_tenant — Xero connected to several
 * organisations, one must be chosen · expired — access revoked/expired, reconnect ·
 * error — the last check failed (network, permissions…).
 */
export const CONNECTION_STATUSES = ['connected', 'needs_tenant', 'expired', 'error'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const integrationProviderSchema = z.object({ provider: z.enum(INTEGRATION_PROVIDERS) });

export const messageMediaCredentialsSchema = z.object({
  apiKey: z.string().trim().min(8, 'Paste the API key from MessageMedia Hub.').max(200),
  apiSecret: z.string().trim().min(8, 'Paste the API secret.').max(200),
  /** Dedicated number (E.164) or an approved alphanumeric sender ID; optional. */
  defaultSender: z
    .string()
    .trim()
    .max(20)
    .regex(
      /^(\+?\d{6,15}|[A-Za-z0-9 ]{1,11})$/,
      'A phone number or a sender ID of up to 11 letters/digits.',
    )
    .nullish()
    .or(z.literal(''))
    .transform((value) => value || null),
});
export type MessageMediaCredentials = z.input<typeof messageMediaCredentialsSchema>;

export const xeroTenantSchema = z.object({ tenantId: z.uuid() });
