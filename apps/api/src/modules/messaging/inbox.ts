import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { ActivityEntityType } from '@mms/shared';
import type { Db } from '../../db/client.ts';
import {
  activities,
  contacts,
  emailMessages,
  gmailSyncState,
  integrationConnections,
  leads,
  users,
} from '../../db/schema/index.ts';
import type { Logger } from '../../logger.ts';
import {
  htmlToText,
  sanitizeInboundHtml,
  stripQuotedText,
  textToSimpleHtml,
} from '../../integrations/email-html.ts';
import {
  gmailGetMessage,
  gmailHistory,
  gmailProfile,
  gmailRecentInbox,
  gmailWatch,
  type GmailMessage,
} from '../../integrations/gmail.ts';
import { ProviderError } from '../../integrations/http.ts';
import {
  freshTokens,
  IntegrationUserError,
  type Integrations,
} from '../../integrations/service.ts';

// Gmail inbox sync (Step 5.2, §2.2). Pub/Sub tells us a mailbox changed; we read its history
// since the last run and keep the emails that come from a customer — matched by the Gmail thread
// of an email sent from the CRM, else by the sender's address on a contact or lead. Everything
// else in the mailbox (personal or internal mail) is never stored. A catch-up run every two
// minutes covers missed pushes and works without Pub/Sub.

const WATCH_RENEW_MS = 24 * 3600_000;
const MAX_TEXT = 50_000;
const MAX_HTML = 200_000;
/** Gmail labels that mean "not a received email". */
const SKIP_LABELS = ['SENT', 'DRAFT', 'SPAM', 'TRASH'];

export type SyncResult = {
  mailbox: string | null;
  stored: number;
  checked: number;
  /** Why nothing was read (not connected, expired, first run…). */
  note?: string;
};

type Target = { entityType: ActivityEntityType; entityId: string; contactId: string | null };

/** The record of the CRM conversation this email continues (same thread, or a reply). */
async function matchConversation(db: Db, mailboxUserId: string, message: GmailMessage) {
  // 1. A reply in a thread started from the CRM: the record that email was sent from.
  if (message.threadId) {
    const [thread] = await db
      .select({
        entityType: emailMessages.entityType,
        entityId: emailMessages.entityId,
        contactId: emailMessages.contactId,
      })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.gmailThreadId, message.threadId),
          eq(emailMessages.mailboxUserId, mailboxUserId),
          isNotNull(emailMessages.entityId),
        ),
      )
      .orderBy(desc(emailMessages.createdAt))
      .limit(1);
    if (thread?.entityType && thread.entityId) {
      return {
        entityType: thread.entityType,
        entityId: thread.entityId,
        contactId: thread.contactId,
      } satisfies Target;
    }
  }
  // 2. Replying to an email we stored (another mailbox's thread): the same record.
  if (message.inReplyTo) {
    const [parent] = await db
      .select({
        entityType: emailMessages.entityType,
        entityId: emailMessages.entityId,
        contactId: emailMessages.contactId,
      })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.messageIdHeader, message.inReplyTo),
          isNotNull(emailMessages.entityId),
        ),
      )
      .limit(1);
    if (parent?.entityType && parent.entityId) {
      return {
        entityType: parent.entityType,
        entityId: parent.entityId,
        contactId: parent.contactId,
      } satisfies Target;
    }
  }
  return null;
}

/** A customer's address: their contact, else their most recent live lead. */
async function matchAddress(db: Db, address: string): Promise<Target | null> {
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.email, address), isNull(contacts.archivedAt)))
    .orderBy(desc(contacts.updatedAt))
    .limit(1);
  if (contact) {
    return { entityType: 'contact', entityId: contact.id, contactId: contact.id } satisfies Target;
  }
  const [lead] = await db
    .select({ id: leads.id, contactId: leads.contactId })
    .from(leads)
    .where(and(eq(leads.email, address), isNull(leads.deletedAt)))
    .orderBy(desc(leads.updatedAt))
    .limit(1);
  if (lead) {
    return { entityType: 'lead', entityId: lead.id, contactId: lead.contactId } satisfies Target;
  }
  return null;
}

/** The email's display content: cleaned HTML (quoted history removed) and its plain text. */
export function inboundContent(message: GmailMessage) {
  let html = message.html ? sanitizeInboundHtml(message.html) : null;
  let text = html ? htmlToText(html) : stripQuotedText(message.text ?? '');
  if (!text && message.text) text = stripQuotedText(message.text) || message.text.trim();
  if (!html && text) html = textToSimpleHtml(text);
  if (html && html.length > MAX_HTML) html = textToSimpleHtml(text.slice(0, MAX_TEXT));
  return { html: html || null, text: text.slice(0, MAX_TEXT) || '(No text)' };
}

/**
 * The record an inbound email belongs to, or null (then it isn't stored).
 * - From a customer: the CRM conversation it continues, else the sender's contact or lead.
 * - From staff (e.g. a colleague's reply-all): kept only if a customer is among To, CC or BCC —
 *   on the conversation's record, else that customer's. Purely internal mail is never stored.
 */
async function matchEmail(
  db: Db,
  mailboxUserId: string,
  staff: Map<string, string>,
  message: GmailMessage,
): Promise<Target | null> {
  const from = message.from?.address;
  if (!from) return null;
  if (!staff.has(from)) {
    return (await matchConversation(db, mailboxUserId, message)) ?? matchAddress(db, from);
  }
  const recipients = [...new Set([...message.to, ...message.cc, ...message.bcc])].filter(
    (address) => !staff.has(address),
  );
  let customer: Target | null = null;
  for (const address of recipients) {
    customer = await matchAddress(db, address);
    if (customer) break;
  }
  if (!customer) return null;
  return (await matchConversation(db, mailboxUserId, message)) ?? customer;
}

/** Stores one received email on its record and timeline. False if skipped or already stored. */
async function storeInbound(
  db: Db,
  mailbox: { userId: string; address: string },
  staff: Map<string, string>,
  message: GmailMessage,
): Promise<boolean> {
  if (!message.from || message.labelIds.some((l) => SKIP_LABELS.includes(l))) return false;
  // The same email reaches every colleague on it (and the CRM keeps the ones it sent): one copy.
  if (message.messageIdHeader) {
    const [known] = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(eq(emailMessages.messageIdHeader, message.messageIdHeader))
      .limit(1);
    if (known) return false;
  }
  const target = await matchEmail(db, mailbox.userId, staff, message);
  if (!target) return false;
  /** A colleague's email: shown with their name. */
  const staffSender = staff.get(message.from.address) ?? null;
  const content = inboundContent(message);
  const subject = message.subject || '(no subject)';
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(emailMessages)
      .values({
        direction: 'inbound',
        entityType: target.entityType,
        entityId: target.entityId,
        contactId: target.contactId,
        mailboxUserId: mailbox.userId,
        fromAddress: message.from?.address ?? '',
        toAddresses: message.to,
        ccAddresses: message.cc,
        subject,
        bodyText: content.text,
        bodyHtml: content.html,
        status: 'received',
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        messageIdHeader: message.messageIdHeader,
        attachmentCount: message.attachments,
        sentAt: message.receivedAt,
        sentByUserId: staffSender,
      })
      // Gmail ID or Message-ID already stored (a parallel run, or a colleague's mailbox).
      .onConflictDoNothing()
      .returning({ id: emailMessages.id });
    if (!row) return false; // a parallel run stored it first
    if (message.inReplyTo) {
      const [parent] = await tx
        .select({ id: emailMessages.id })
        .from(emailMessages)
        .where(eq(emailMessages.messageIdHeader, message.inReplyTo))
        .limit(1);
      if (parent) {
        await tx
          .update(emailMessages)
          .set({ inReplyToId: parent.id })
          .where(eq(emailMessages.id, row.id));
      }
    }
    const [activity] = await tx
      .insert(activities)
      .values({
        entityType: target.entityType,
        entityId: target.entityId,
        type: 'email',
        direction: 'inbound',
        subject,
        body: content.text,
        occurredAt: message.receivedAt,
        metadata: { emailMessageId: row.id, from: message.from?.address },
      })
      .returning({ id: activities.id });
    await tx
      .update(emailMessages)
      .set({ activityId: activity?.id ?? null })
      .where(eq(emailMessages.id, row.id));
    return true;
  });
}

const isNewer = (next: string) =>
  sql`case when ${gmailSyncState.historyId} is null or ${gmailSyncState.historyId}::numeric < ${next}::numeric then ${next} else ${gmailSyncState.historyId} end`;

async function saveState(
  db: Db,
  connectionId: string,
  values: Partial<typeof gmailSyncState.$inferInsert> & { historyId?: string | null },
) {
  const { historyId, ...rest } = values;
  await db
    .insert(gmailSyncState)
    .values({ connectionId, historyId: historyId ?? null, ...rest })
    .onConflictDoUpdate({
      target: gmailSyncState.connectionId,
      set: {
        ...rest,
        // Never move backwards: an older run finishing late keeps the newer position.
        ...(historyId ? { historyId: isNewer(historyId) } : {}),
        updatedAt: new Date(),
      },
    });
}

/** Reads one mailbox's new inbox emails and stores the customers' ones. */
export async function syncMailbox(
  db: Db,
  int: Integrations,
  connectionId: string,
  log?: Logger,
): Promise<SyncResult> {
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, connectionId));
  if (!connection?.userId || connection.provider !== 'gmail') {
    return { mailbox: null, stored: 0, checked: 0, note: 'not connected' };
  }
  const mailbox = { userId: connection.userId, address: connection.accountId ?? '' };
  if (connection.status === 'expired') {
    return { mailbox: mailbox.address, stored: 0, checked: 0, note: 'access expired' };
  }
  try {
    const tokens = await freshTokens(db, int, connection.id);
    const [state] = await db
      .select()
      .from(gmailSyncState)
      .where(eq(gmailSyncState.connectionId, connection.id));
    let historyId = state?.historyId ?? null;

    // Pub/Sub watch: started on the first run, renewed daily (it lasts 7 days).
    let watchError: string | null = null;
    const topic = int.gmailPush.topic;
    if (
      topic &&
      (!state?.watchExpiresAt || state.watchExpiresAt.getTime() - Date.now() < WATCH_RENEW_MS)
    ) {
      try {
        const watch = await gmailWatch(int.fetch, tokens.accessToken, topic);
        await saveState(db, connection.id, { watchExpiresAt: watch.expiresAt });
        historyId ??= watch.historyId;
      } catch (error) {
        // Polling still works; the reason shows in Settings.
        watchError = `Live updates are off: ${error instanceof Error ? error.message : 'Gmail refused the watch'}`;
        log?.warn({ err: error, mailbox: mailbox.address }, 'Gmail watch failed');
      }
    }

    // First run: start from now (earlier mail isn't imported).
    if (!historyId) {
      const profile = await gmailProfile(int.fetch, tokens.accessToken);
      await saveState(db, connection.id, {
        historyId: profile.historyId ?? null,
        lastSyncAt: new Date(),
        lastSyncError: watchError,
      });
      return { mailbox: mailbox.address, stored: 0, checked: 0, note: 'started' };
    }

    let ids: string[] = [];
    let latest = historyId;
    let page: string | undefined;
    let tooOld = false;
    do {
      const result = await gmailHistory(int.fetch, tokens.accessToken, historyId, page);
      if (!result) {
        tooOld = true;
        break;
      }
      ids.push(...result.messageIds);
      if (result.historyId) latest = result.historyId;
      page = result.next ?? undefined;
    } while (page);
    if (tooOld) {
      // Gmail keeps about a week of history; catch up from the recent inbox instead.
      ids = await gmailRecentInbox(int.fetch, tokens.accessToken);
      latest = (await gmailProfile(int.fetch, tokens.accessToken)).historyId ?? latest;
    }
    ids = [...new Set(ids)];

    const known = ids.length
      ? await db
          .select({ id: emailMessages.gmailMessageId })
          .from(emailMessages)
          .where(inArray(emailMessages.gmailMessageId, ids))
      : [];
    const seen = new Set(known.map((k) => k.id));
    const fresh = ids.filter((id) => !seen.has(id));
    // Every CRM user's address (and the mailbox's own) → their user id.
    const staff = new Map<string, string>(
      fresh.length
        ? (await db.select({ id: users.id, email: users.email }).from(users)).map((u) => [
            u.email,
            u.id,
          ])
        : [],
    );
    if (!staff.has(mailbox.address)) staff.set(mailbox.address, mailbox.userId);
    let stored = 0;
    for (const id of fresh) {
      const message = await gmailGetMessage(int.fetch, tokens.accessToken, id);
      if (message && (await storeInbound(db, mailbox, staff, message))) stored += 1;
    }
    await saveState(db, connection.id, {
      historyId: latest,
      lastSyncAt: new Date(),
      lastSyncError: watchError,
      ...(stored ? { lastStored: stored } : {}),
    });
    if (stored) log?.info({ mailbox: mailbox.address, stored }, 'Customer emails synced');
    return { mailbox: mailbox.address, stored, checked: fresh.length };
  } catch (error) {
    if (!(error instanceof ProviderError || error instanceof IntegrationUserError)) throw error;
    if (error instanceof ProviderError && error.kind === 'revoked') {
      await db
        .update(integrationConnections)
        .set({ status: 'expired', lastError: error.message, lastCheckedAt: new Date() })
        .where(eq(integrationConnections.id, connection.id));
    }
    await saveState(db, connection.id, { lastSyncAt: new Date(), lastSyncError: error.message });
    log?.warn({ err: error, mailbox: mailbox.address }, 'Gmail inbox sync failed');
    return { mailbox: mailbox.address, stored: 0, checked: 0, note: error.message };
  }
}

/** The catch-up run: every connected mailbox, one after another. */
export async function syncAllMailboxes(db: Db, int: Integrations, log?: Logger) {
  if (!int.gmail || !int.key.ok) return { mailboxes: 0, stored: 0 };
  const rows = await db
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.provider, 'gmail'),
        eq(integrationConnections.status, 'connected'),
      ),
    );
  let stored = 0;
  for (const row of rows) stored += (await syncMailbox(db, int, row.id, log)).stored;
  return { mailboxes: rows.length, stored };
}

/** A push for this address: the connection to sync (null when it isn't connected here). */
export async function connectionForPush(db: Db, emailAddress: string) {
  const [row] = await db
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.provider, 'gmail'),
        eq(integrationConnections.accountId, emailAddress),
      ),
    );
  if (!row) return null;
  await saveState(db, row.id, { lastPushAt: new Date() });
  return row.id;
}
