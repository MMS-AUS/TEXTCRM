import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_columns.ts';
import { activities, activityEntityType } from './activities.ts';
import { contacts } from './contacts.ts';
import { integrationConnections } from './integrations.ts';
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
 * Emails sent through a user's connected Gmail (Step 5.2), and the customers' emails synced
 * from its inbox. Failed sends are kept with their error. `body_html` is cleaned HTML
 * (email-html.ts); `body_text` is its plain-text version (timeline, search, plain clients).
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
    bodyHtml: text(),
    /** The RFC 5322 Message-ID header (inbound), so a reply can thread with it. */
    messageIdHeader: text(),
    /** The email this one replies to. */
    inReplyToId: uuid(),
    attachmentCount: integer().notNull().default(0),
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
    index('email_messages_contact_idx').on(t.contactId),
    // One row per email, however many colleagues' mailboxes it reached.
    uniqueIndex('email_messages_message_id_header_unique')
      .on(t.messageIdHeader)
      .where(sql`${t.messageIdHeader} is not null`),
    check('email_messages_direction_valid', sql`${t.direction} in ('outbound', 'inbound')`),
  ],
);

/**
 * Where each connected mailbox's inbox sync is up to (Step 5.2): Gmail's history ID, the
 * Pub/Sub watch's expiry, and the last run. Kept apart from the connection so the sync and the
 * Settings page never overwrite each other.
 */
export const gmailSyncState = pgTable('gmail_sync_state', {
  connectionId: uuid()
    .primaryKey()
    .references(() => integrationConnections.id, { onDelete: 'cascade' }),
  historyId: text(),
  watchExpiresAt: tstz(),
  lastPushAt: tstz(),
  lastSyncAt: tstz(),
  lastSyncError: text(),
  /** Emails stored by the last run that found any. */
  lastStored: integer().notNull().default(0),
  ...timestamps,
});

/**
 * An email being written and saved for later (Step 5.2), by its author, on a record. Only the
 * author sees it. Attachments uploaded for it are linked by `email_attachments.draft_id`.
 */
export const emailDrafts = pgTable(
  'email_drafts',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: activityEntityType().notNull(),
    entityId: uuid().notNull(),
    toAddresses: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ccAddresses: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    subject: text().notNull().default(''),
    /** Cleaned like a sent email's HTML. */
    bodyHtml: text().notNull().default(''),
    replyToId: uuid().references(() => emailMessages.id, { onDelete: 'set null' }),
    includeSignature: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index('email_drafts_owner_idx').on(t.userId, t.entityType, t.entityId)],
);

/**
 * A file attached to an outgoing email (PDF or image), stored in S3/R2 under `email/…`. It is
 * uploaded first (pending → ready), may belong to a draft, and is linked to the email once sent.
 * Unsent files that aren't on a draft are removed by the clean-up job after a day.
 */
export const emailAttachments = pgTable(
  'email_attachments',
  {
    id: id(),
    uploadedByUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emailMessageId: uuid().references(() => emailMessages.id, { onDelete: 'set null' }),
    draftId: uuid().references(() => emailDrafts.id, { onDelete: 'set null' }),
    fileName: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    storageKey: text().notNull().unique('email_attachments_storage_key_unique'),
    status: text().notNull().default('pending'),
    ...timestamps,
  },
  (t) => [
    index('email_attachments_email_idx').on(t.emailMessageId),
    index('email_attachments_draft_idx').on(t.draftId),
    check('email_attachments_status_valid', sql`${t.status} in ('pending', 'ready')`),
    check('email_attachments_size_positive', sql`${t.sizeBytes} > 0`),
  ],
);

/**
 * A user's email signature (Step 5.2): the details shown under their emails and an optional
 * logo (stored in S3/R2, sent inside the email). `enabled` adds it to new emails by default.
 */
export const emailSignatures = pgTable('email_signatures', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  enabled: boolean().notNull().default(true),
  fullName: text(),
  title: text(),
  phone: text(),
  mobile: text(),
  email: text(),
  companyName: text(),
  address: text(),
  website: text(),
  logoKey: text(),
  logoContentType: text(),
  logoSizeBytes: integer(),
  /** A logo uploaded but not yet confirmed (replaces logo_key once it arrives). */
  pendingLogoKey: text(),
  ...timestamps,
});
