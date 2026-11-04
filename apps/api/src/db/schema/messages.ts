import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_columns.ts';
import { activities, activityEntityType } from './activities.ts';
import { contacts } from './contacts.ts';
import { users } from './users.ts';

/**
 * Every SMS sent or received through MessageMedia (Step 5.3). `entity_*` is the record it
 * belongs to (lead, contact, ticket); an inbound SMS nobody could be matched to has none.
 * Its timeline entry is `activity_id`.
 */
export const smsMessages = pgTable(
  'sms_messages',
  {
    id: id(),
    /** 'outbound' | 'inbound'. */
    direction: text().notNull(),
    entityType: activityEntityType(),
    entityId: uuid(),
    contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    activityId: uuid().references(() => activities.id, { onDelete: 'set null' }),
    fromNumber: text(),
    toNumber: text().notNull(),
    content: text().notNull(),
    /** 'GSM-7' | 'UCS-2'. */
    encoding: text().notNull(),
    segments: integer().notNull(),
    /** queued → sent → enroute/submitted → delivered | expired | rejected | failed | undeliverable; received for inbound. */
    status: text().notNull(),
    statusAt: tstz(),
    error: text(),
    /** MessageMedia's message_id (outbound). */
    providerMessageId: text().unique('sms_messages_provider_message_unique'),
    /** MessageMedia's reply_id (inbound) — makes webhook retries harmless. */
    providerReplyId: text().unique('sms_messages_provider_reply_unique'),
    /** Inbound: the outbound SMS this replies to. */
    inReplyToId: uuid(),
    sentByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('sms_messages_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    index('sms_messages_contact_idx').on(t.contactId),
    index('sms_messages_from_idx').on(t.fromNumber),
    check('sms_messages_direction_valid', sql`${t.direction} in ('outbound', 'inbound')`),
  ],
);

/**
 * Emails sent through a user's connected Gmail (Step 5.2), and later the ones synced from
 * it. Failed sends are kept with their error.
 */
export const emailMessages = pgTable(
  'email_messages',
  {
    id: id(),
    direction: text().notNull(),
    entityType: activityEntityType(),
    entityId: uuid(),
    contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    activityId: uuid().references(() => activities.id, { onDelete: 'set null' }),
    /** Whose connected mailbox it went through. */
    mailboxUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    fromAddress: text().notNull(),
    toAddresses: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ccAddresses: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    subject: text().notNull(),
    bodyText: text().notNull(),
    /** 'sent' | 'failed' (outbound); 'received' (inbound, Step 5.2 sync). */
    status: text().notNull(),
    error: text(),
    gmailMessageId: text().unique('email_messages_gmail_message_unique'),
    gmailThreadId: text(),
    sentAt: tstz(),
    sentByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('email_messages_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    index('email_messages_thread_idx').on(t.gmailThreadId),
    check('email_messages_direction_valid', sql`${t.direction} in ('outbound', 'inbound')`),
  ],
);
