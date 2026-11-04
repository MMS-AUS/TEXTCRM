import { createHmac, timingSafeEqual } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import {
  countSms,
  formatPhone,
  normalisePhone,
  type ActivityEntityType,
  type EmailSendInput,
  type SmsSendInput,
} from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import {
  activities,
  contacts,
  emailMessages,
  integrationConnections,
  leads,
  projects,
  smsMessages,
  tickets,
  users,
} from '../../db/schema/index.ts';
import type { Logger } from '../../logger.ts';
import { buildMime, gmailSend } from '../../integrations/gmail.ts';
import { ProviderError } from '../../integrations/http.ts';
import { messageMediaSend } from '../../integrations/messagemedia.ts';
import {
  freshTokens,
  IntegrationUserError,
  loadConnection,
  messageMediaCreds,
  type Integrations,
} from '../../integrations/service.ts';
import { assertEntityExists } from '../entities.ts';

// Sending SMS and email from a record (Steps 5.3, 5.2) and receiving SMS (webhooks). Every
// message is logged — failures included — and appears on the record's timeline.

type Sender = { id: string; name: string; email: string };

const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });

/** The record's customer: their contact (if any), mobile and email. */
async function recipientOf(db: Db | Tx, entityType: ActivityEntityType, entityId: string) {
  await assertEntityExists(db, entityType, entityId);
  const contactById = async (id: string | null) => {
    if (!id) return null;
    const [c] = await db
      .select({
        id: contacts.id,
        mobile: contacts.mobile,
        email: contacts.email,
        firstName: contacts.firstName,
      })
      .from(contacts)
      .where(eq(contacts.id, id));
    return c ?? null;
  };
  if (entityType === 'lead') {
    const [lead] = await db
      .select({
        mobile: leads.mobile,
        email: leads.email,
        contactId: leads.contactId,
        firstName: leads.firstName,
      })
      .from(leads)
      .where(eq(leads.id, entityId));
    return {
      contactId: lead?.contactId ?? null,
      mobile: lead?.mobile ?? null,
      email: lead?.email ?? null,
      firstName: lead?.firstName ?? '',
    };
  }
  let contactId: string | null = entityType === 'contact' ? entityId : null;
  if (entityType === 'ticket') {
    contactId =
      (await db.select({ id: tickets.contactId }).from(tickets).where(eq(tickets.id, entityId)))[0]
        ?.id ?? null;
  }
  if (entityType === 'project') {
    contactId =
      (
        await db.select({ id: projects.contactId }).from(projects).where(eq(projects.id, entityId))
      )[0]?.id ?? null;
  }
  const contact = await contactById(contactId);
  return {
    contactId,
    mobile: contact?.mobile ?? null,
    email: contact?.email ?? null,
    firstName: contact?.firstName ?? '',
  };
}

// ── Webhook URL signing ──────────────────────────────────────────────────

export type WebhookKind = 'delivery' | 'inbound';

/** The token in a MessageMedia callback URL: HMAC of its purpose with our secret. */
export const webhookToken = (secret: string, kind: WebhookKind) =>
  createHmac('sha256', secret).update(`messagemedia:${kind}`).digest('base64url');

export function verifyWebhookToken(
  secret: string | null,
  kind: WebhookKind,
  token: unknown,
): boolean {
  if (!secret || typeof token !== 'string') return false;
  const expected = Buffer.from(webhookToken(secret, kind));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Where MessageMedia should send this kind of callback, or null if it can't reach us. */
export function webhookUrl(int: Integrations, kind: WebhookKind): string | null {
  if (!int.publicApiUrl || !int.webhookSecret) return null;
  return `${int.publicApiUrl}/webhooks/messagemedia/${kind}?token=${webhookToken(int.webhookSecret, kind)}`;
}

// ── SMS ──────────────────────────────────────────────────────────────────

export async function sendSms(
  db: Db,
  int: Integrations,
  sender: Sender,
  input: SmsSendInput,
  log?: Logger,
) {
  const recipient = await recipientOf(db, input.entityType, input.entityId);
  const to = input.to ? normalisePhone(input.to) : recipient.mobile;
  if (!to) {
    throw bad(
      input.to
        ? `"${input.to}" isn't a valid phone number.`
        : 'This record has no mobile number. Add one, or type the number to send to.',
    );
  }
  const found = await messageMediaCreds(db, int).catch((error: unknown) => {
    if (error instanceof IntegrationUserError) throw bad(error.message);
    throw error;
  });
  if (!found)
    throw bad('SMS isn’t connected. An admin can connect MessageMedia in Settings → Integrations.');
  const [person] = await db
    .select({ smsSenderId: users.smsSenderId })
    .from(users)
    .where(eq(users.id, sender.id));
  const from = person?.smsSenderId ?? found.creds.defaultSender;
  const count = countSms(input.content);

  // Logged before sending, so a failure is on record too.
  const [row] = await db.transaction(async (tx) => {
    const [activity] = await tx
      .insert(activities)
      .values({
        entityType: input.entityType,
        entityId: input.entityId,
        type: 'sms',
        direction: 'outbound',
        subject: `SMS to ${formatPhone(to)}`,
        body: input.content,
        authorUserId: sender.id,
      })
      .returning({ id: activities.id });
    return tx
      .insert(smsMessages)
      .values({
        direction: 'outbound',
        entityType: input.entityType,
        entityId: input.entityId,
        contactId: recipient.contactId,
        activityId: activity?.id ?? null,
        fromNumber: from,
        toNumber: to,
        content: input.content,
        encoding: count.encoding,
        segments: count.segments,
        status: 'queued',
        statusAt: new Date(),
        sentByUserId: sender.id,
      })
      .returning();
  });
  if (!row) throw new Error('Insert returned no row');
  await db
    .update(activities)
    .set({ metadata: { smsMessageId: row.id } })
    .where(eq(activities.id, row.activityId ?? ''));

  try {
    const sent = await messageMediaSend(int.fetch, found.creds, {
      to,
      content: input.content,
      from,
      callbackUrl: webhookUrl(int, 'delivery') ?? undefined,
    });
    await db
      .update(smsMessages)
      .set({ status: 'sent', providerMessageId: sent.messageId, statusAt: new Date() })
      .where(eq(smsMessages.id, row.id));
    return {
      id: row.id,
      status: 'sent' as const,
      to,
      segments: count.segments,
      deliveryReports: webhookUrl(int, 'delivery') !== null,
    };
  } catch (error) {
    const message = error instanceof ProviderError ? error.message : 'The SMS could not be sent.';
    if (!(error instanceof ProviderError))
      log?.error({ err: error, smsId: row.id }, 'SMS send failed');
    await db
      .update(smsMessages)
      .set({ status: 'failed', error: message, statusAt: new Date() })
      .where(eq(smsMessages.id, row.id));
    throw bad(`${message} (Logged on the timeline as not sent.)`);
  }
}

const FINAL_SMS = ['delivered', 'expired', 'rejected', 'failed', 'undeliverable'];
const DELIVERY_STATUSES = new Set(['enroute', 'submitted', ...FINAL_SMS]);

type Json = Record<string, unknown>;
const str = (value: unknown) => (typeof value === 'string' && value ? value : null);
const items = (body: unknown, listKey: string): Json[] => {
  if (Array.isArray(body))
    return body.filter((x): x is Json => typeof x === 'object' && x !== null);
  if (typeof body !== 'object' || body === null) return [];
  const list = (body as Json)[listKey];
  if (Array.isArray(list))
    return list.filter((x): x is Json => typeof x === 'object' && x !== null);
  return [body as Json];
};

/** A MessageMedia delivery report: moves the SMS on, never back from a final status. */
export async function handleDeliveryReports(db: Db, body: unknown, log?: Logger) {
  let updated = 0;
  for (const report of items(body, 'delivery_reports')) {
    const messageId = str(report.message_id);
    const status = str(report.status)?.toLowerCase();
    if (!messageId || !status || !DELIVERY_STATUSES.has(status)) continue;
    const [sms] = await db
      .select()
      .from(smsMessages)
      .where(eq(smsMessages.providerMessageId, messageId));
    if (!sms) {
      log?.info({ messageId }, 'Delivery report for an unknown SMS');
      continue;
    }
    if (FINAL_SMS.includes(sms.status) && !FINAL_SMS.includes(status)) continue;
    const at = str(report.submitted_date) ?? str(report.date_received);
    await db
      .update(smsMessages)
      .set({
        status,
        statusAt: at ? new Date(at) : new Date(),
        error:
          FINAL_SMS.includes(status) && status !== 'delivered' ? `MessageMedia: ${status}` : null,
      })
      .where(eq(smsMessages.id, sms.id));
    updated += 1;
  }
  return { updated };
}

/** Who an inbound number belongs to: a contact, else a live lead (most recent first). */
async function matchByPhone(db: Db, phone: string) {
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        isNull(contacts.archivedAt),
        or(eq(contacts.mobile, phone), eq(contacts.secondaryMobile, phone)),
      ),
    )
    .orderBy(desc(contacts.updatedAt))
    .limit(1);
  if (contact)
    return { entityType: 'contact' as const, entityId: contact.id, contactId: contact.id };
  const [lead] = await db
    .select({ id: leads.id, contactId: leads.contactId })
    .from(leads)
    .where(
      and(isNull(leads.deletedAt), or(eq(leads.mobile, phone), eq(leads.secondaryMobile, phone))),
    )
    .orderBy(desc(leads.updatedAt))
    .limit(1);
  if (lead) return { entityType: 'lead' as const, entityId: lead.id, contactId: lead.contactId };
  return null;
}

/**
 * An inbound SMS: attached to the record the original SMS came from, else matched by phone
 * to a contact or lead; unmatched replies are kept without a record. Retries are ignored.
 */
export async function handleInboundSms(db: Db, body: unknown, log?: Logger) {
  let stored = 0;
  for (const reply of items(body, 'replies')) {
    const replyId = str(reply.reply_id);
    const content = str(reply.content);
    const from = normalisePhone(str(reply.source_number) ?? '') ?? str(reply.source_number);
    if (!replyId || content === null || !from) continue;
    const [duplicate] = await db
      .select({ id: smsMessages.id })
      .from(smsMessages)
      .where(eq(smsMessages.providerReplyId, replyId));
    if (duplicate) continue;
    const originalId = str(reply.message_id);
    const [original] = originalId
      ? await db.select().from(smsMessages).where(eq(smsMessages.providerMessageId, originalId))
      : [];
    const target =
      original?.entityType && original.entityId
        ? {
            entityType: original.entityType,
            entityId: original.entityId,
            contactId: original.contactId,
          }
        : await matchByPhone(db, from);
    const receivedAt = str(reply.date_received)
      ? new Date(str(reply.date_received) ?? '')
      : new Date();
    const count = countSms(content);
    await db.transaction(async (tx) => {
      const [activity] = target
        ? await tx
            .insert(activities)
            .values({
              entityType: target.entityType,
              entityId: target.entityId,
              type: 'sms',
              direction: 'inbound',
              subject: `SMS from ${formatPhone(from)}`,
              body: content,
              occurredAt: receivedAt,
            })
            .returning({ id: activities.id })
        : [];
      const [row] = await tx
        .insert(smsMessages)
        .values({
          direction: 'inbound',
          entityType: target?.entityType ?? null,
          entityId: target?.entityId ?? null,
          contactId: target?.contactId ?? null,
          activityId: activity?.id ?? null,
          fromNumber: from,
          toNumber: str(reply.destination_number) ?? '',
          content,
          encoding: count.encoding,
          segments: count.segments,
          status: 'received',
          statusAt: receivedAt,
          providerReplyId: replyId,
          inReplyToId: original?.id ?? null,
        })
        .returning({ id: smsMessages.id });
      if (activity && row) {
        await tx
          .update(activities)
          .set({ metadata: { smsMessageId: row.id } })
          .where(eq(activities.id, activity.id));
      }
    });
    if (!target) log?.info({ from: formatPhone(from) }, 'Inbound SMS matched no contact or lead');
    stored += 1;
  }
  return { stored };
}

// ── Email ────────────────────────────────────────────────────────────────

export async function sendEmail(
  db: Db,
  int: Integrations,
  sender: Sender,
  input: EmailSendInput,
  log?: Logger,
) {
  const recipient = await recipientOf(db, input.entityType, input.entityId);
  const to = input.to?.length ? input.to : recipient.email ? [recipient.email] : [];
  if (to.length === 0)
    throw bad('This record has no email address. Add one, or type who to send to.');
  const cc = input.cc ?? [];
  const connection = await loadConnection(db, 'gmail', sender.id);
  if (!connection || connection.status === 'expired') {
    throw bad(
      connection
        ? 'Your Gmail access has expired. Reconnect it in Settings → Integrations.'
        : 'Connect your Gmail first (Settings → Integrations) — emails go from your own mailbox.',
    );
  }
  const fromAddress = connection.accountName ?? sender.email;
  const log_ = async (values: Partial<typeof emailMessages.$inferInsert> & { status: string }) =>
    db.transaction(async (tx) => {
      const [activity] =
        values.status === 'sent'
          ? await tx
              .insert(activities)
              .values({
                entityType: input.entityType,
                entityId: input.entityId,
                type: 'email',
                direction: 'outbound',
                subject: input.subject,
                body: input.body,
                authorUserId: sender.id,
              })
              .returning({ id: activities.id })
          : [];
      const [row] = await tx
        .insert(emailMessages)
        .values({
          direction: 'outbound',
          entityType: input.entityType,
          entityId: input.entityId,
          contactId: recipient.contactId,
          activityId: activity?.id ?? null,
          mailboxUserId: sender.id,
          fromAddress,
          toAddresses: to,
          ccAddresses: cc,
          subject: input.subject,
          bodyText: input.body,
          sentByUserId: sender.id,
          ...values,
        })
        .returning({ id: emailMessages.id });
      if (activity && row) {
        await tx
          .update(activities)
          .set({ metadata: { emailMessageId: row.id } })
          .where(eq(activities.id, activity.id));
      }
      return row?.id ?? '';
    });

  try {
    const tokens = await freshTokens(db, int, connection.id);
    const mime = buildMime({
      from: { name: sender.name, address: fromAddress },
      to,
      cc,
      subject: input.subject,
      text: input.body,
    });
    const sent = await gmailSend(int.fetch, tokens.accessToken, mime);
    const id = await log_({
      status: 'sent',
      gmailMessageId: sent.messageId,
      gmailThreadId: sent.threadId,
      sentAt: new Date(),
    });
    return { id, to, threadId: sent.threadId };
  } catch (error) {
    if (!(error instanceof ProviderError || error instanceof IntegrationUserError)) {
      log?.error({ err: error }, 'Email send failed');
      throw error;
    }
    if (error instanceof ProviderError && error.kind === 'revoked') {
      await db
        .update(integrationConnections)
        .set({ status: 'expired', lastError: error.message, lastCheckedAt: new Date() })
        .where(eq(integrationConnections.id, connection.id));
    }
    await log_({ status: 'failed', error: error.message });
    throw bad(error.message);
  }
}
