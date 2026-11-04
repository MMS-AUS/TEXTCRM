import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_columns.ts';
import { users } from './users.ts';

/**
 * A connected external account (Phase 5). Gmail is per user (`user_id` set); Xero and
 * MessageMedia belong to the organisation (`user_id` null) — at most one of each.
 * `secrets` is AES-256-GCM ciphertext (TOKEN_ENCRYPTION_KEY) of the provider's tokens or API
 * credentials; nothing secret is ever stored in plain text.
 */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: id(),
    /** 'gmail' | 'xero' | 'messagemedia'. */
    provider: text().notNull(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    /** The mailbox address, Xero tenant ID, or MessageMedia key's first characters. */
    accountId: text(),
    /** What people see: the mailbox, the Xero organisation name, the sender. */
    accountName: text(),
    /** Encrypted JSON: { accessToken, refreshToken, expiresAt } or { apiKey, apiSecret }. */
    secrets: text().notNull(),
    scopes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Non-secret extras, e.g. the Xero tenants offered when there is more than one. */
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** connected | needs_tenant | expired | error. */
    status: text().notNull().default('connected'),
    lastError: text(),
    lastCheckedAt: tstz(),
    connectedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('integration_connections_user_unique')
      .on(t.provider, t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex('integration_connections_org_unique')
      .on(t.provider)
      .where(sql`${t.userId} is null`),
    check(
      'integration_connections_provider_valid',
      sql`${t.provider} in ('gmail', 'xero', 'messagemedia')`,
    ),
    check(
      'integration_connections_status_valid',
      sql`${t.status} in ('connected', 'needs_tenant', 'expired', 'error')`,
    ),
  ],
);

/**
 * One OAuth attempt: the random `state` sent to the provider, bound to the CRM user who
 * started it, with the PKCE verifier. Single use and short-lived.
 */
export const integrationOAuthStates = pgTable(
  'integration_oauth_states',
  {
    state: text().primaryKey(),
    provider: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeVerifier: text().notNull(),
    expiresAt: tstz().notNull(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index('integration_oauth_states_expires_idx').on(t.expiresAt)],
);
