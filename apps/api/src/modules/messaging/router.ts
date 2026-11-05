import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import {
  ACTIVITY_ENTITY_FEATURE,
  attachmentUploadSchema,
  countSms,
  draftSaveSchema,
  emailSendSchema,
  hasPermission,
  messageListSchema,
  signatureLogoUploadSchema,
  signatureSchema,
  smsSendSchema,
  type ActivityEntityType,
  type PermissionAction,
} from '@mms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../auth/types.ts';
import { emailAttachments, emailMessages, smsMessages, users } from '../../db/schema/index.ts';
import { protectedProcedure, router } from '../../trpc/trpc.ts';
import {
  completeAttachmentUpload,
  completeLogoUpload,
  createAttachmentUpload,
  createLogoUpload,
  deleteDraft,
  listDrafts,
  removeAttachment,
  removeLogo,
  requireStorage,
  saveDraft,
  saveSignature,
  signatureView,
} from './compose.ts';
import { recipientOf, sendEmail, sendSms, webhookUrl } from './service.ts';

// SMS (Step 5.3) and email (Step 5.2) from a record. Sending needs edit on that record;
// reading its messages needs view.

function assertAllowed(user: AuthUser, entityType: ActivityEntityType, action: PermissionAction) {
  if (!hasPermission(user.permissions, ACTIVITY_ENTITY_FEATURE[entityType], action)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your role does not allow this action.' });
  }
}

const sender = (user: AuthUser) => ({ id: user.id, name: user.name, email: user.email });

export const messagingRouter = router({
  /** The segment counter, as the server counts it (the form shows the same numbers). */
  smsCount: protectedProcedure
    .input(z.object({ content: z.string().max(2000) }))
    .query(({ input }) => countSms(input.content)),

  /** Whether SMS delivery reports and replies can reach this server. */
  smsSetup: protectedProcedure.query(({ ctx }) => ({
    deliveryReports: webhookUrl(ctx.integrations, 'delivery') !== null,
    inboundWebhookUrl: hasPermission(ctx.user.permissions, 'integrations', 'edit')
      ? webhookUrl(ctx.integrations, 'inbound')
      : null,
  })),

  sendSms: protectedProcedure.input(smsSendSchema).mutation(({ ctx, input }) => {
    assertAllowed(ctx.user, input.entityType, 'edit');
    return sendSms(ctx.db, ctx.integrations, sender(ctx.user), input, ctx.log);
  }),

  sendEmail: protectedProcedure.input(emailSendSchema).mutation(({ ctx, input }) => {
    assertAllowed(ctx.user, input.entityType, 'edit');
    return sendEmail(ctx.db, ctx.integrations, sender(ctx.user), input, ctx.log, ctx.storage);
  }),

  // ── Attachments: upload (presigned PUT) → complete → send; removable until sent ──

  attachmentUpload: protectedProcedure
    .input(attachmentUploadSchema)
    .mutation(({ ctx, input }) =>
      createAttachmentUpload(ctx.db, ctx.storage, sender(ctx.user), input),
    ),
  attachmentComplete: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      completeAttachmentUpload(ctx.db, ctx.storage, sender(ctx.user), input.id),
    ),
  attachmentRemove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      removeAttachment(ctx.db, ctx.storage, sender(ctx.user), input.id),
    ),
  /** A sent email's file: anyone who can view the record it was sent from. */
  attachmentDownload: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const storage = requireStorage(ctx.storage);
      const [row] = await ctx.db
        .select({ file: emailAttachments, entityType: emailMessages.entityType })
        .from(emailAttachments)
        .innerJoin(emailMessages, eq(emailMessages.id, emailAttachments.emailMessageId))
        .where(eq(emailAttachments.id, input.id));
      if (!row?.entityType) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'This file no longer exists.' });
      }
      assertAllowed(ctx.user, row.entityType, 'view');
      return {
        url: await storage.presignDownload(row.file.storageKey, {
          fileName: row.file.fileName,
          inline: true,
        }),
      };
    }),

  // ── Signature (each user's own) ──

  signature: protectedProcedure.query(({ ctx }) =>
    signatureView(ctx.db, ctx.storage, sender(ctx.user)),
  ),
  signatureSave: protectedProcedure
    .input(signatureSchema)
    .mutation(({ ctx, input }) => saveSignature(ctx.db, sender(ctx.user), input)),
  signatureLogoUpload: protectedProcedure
    .input(signatureLogoUploadSchema)
    .mutation(({ ctx, input }) => createLogoUpload(ctx.db, ctx.storage, sender(ctx.user), input)),
  signatureLogoComplete: protectedProcedure.mutation(({ ctx }) =>
    completeLogoUpload(ctx.db, ctx.storage, sender(ctx.user)),
  ),
  signatureLogoRemove: protectedProcedure.mutation(({ ctx }) =>
    removeLogo(ctx.db, ctx.storage, sender(ctx.user)),
  ),

  // ── Drafts (only their author sees them) ──

  drafts: protectedProcedure.input(messageListSchema).query(({ ctx, input }) => {
    assertAllowed(ctx.user, input.entityType, 'edit');
    return listDrafts(ctx.db, sender(ctx.user), input.entityType, input.entityId);
  }),
  draftSave: protectedProcedure.input(draftSaveSchema).mutation(async ({ ctx, input }) => {
    assertAllowed(ctx.user, input.entityType, 'edit');
    await recipientOf(ctx.db, input.entityType, input.entityId); // the record exists
    return saveDraft(ctx.db, sender(ctx.user), input);
  }),
  draftDelete: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => deleteDraft(ctx.db, ctx.storage, sender(ctx.user), input.id)),

  /**
   * The customer's message history for a record page: SMS and emails of this record, plus
   * those of other records for the same contact (a contact page shows its leads' and tickets'
   * messages too). Messages from records the role can't view are left out.
   */
  history: protectedProcedure.input(messageListSchema).query(async ({ ctx, input }) => {
    assertAllowed(ctx.user, input.entityType, 'view');
    const { contactId } = await recipientOf(ctx.db, input.entityType, input.entityId);
    const visible = (entityType: ActivityEntityType | null) =>
      entityType === null ||
      hasPermission(ctx.user.permissions, ACTIVITY_ENTITY_FEATURE[entityType], 'view');
    const forSms: SQL | undefined = or(
      and(eq(smsMessages.entityType, input.entityType), eq(smsMessages.entityId, input.entityId)),
      contactId ? eq(smsMessages.contactId, contactId) : undefined,
    );
    const forEmail: SQL | undefined = or(
      and(
        eq(emailMessages.entityType, input.entityType),
        eq(emailMessages.entityId, input.entityId),
      ),
      contactId ? eq(emailMessages.contactId, contactId) : undefined,
    );
    const [sms, emails] = await Promise.all([
      ctx.db
        .select({ row: smsMessages, senderName: users.name })
        .from(smsMessages)
        .leftJoin(users, eq(users.id, smsMessages.sentByUserId))
        .where(forSms)
        .orderBy(desc(smsMessages.createdAt))
        .limit(200),
      ctx.db
        .select({ row: emailMessages, senderName: users.name })
        .from(emailMessages)
        .leftJoin(users, eq(users.id, emailMessages.sentByUserId))
        .where(forEmail)
        .orderBy(desc(emailMessages.createdAt))
        .limit(200),
    ]);
    const emailIds = emails.map(({ row }) => row.id);
    const sentFiles = emailIds.length
      ? await ctx.db
          .select({
            id: emailAttachments.id,
            emailMessageId: emailAttachments.emailMessageId,
            fileName: emailAttachments.fileName,
            contentType: emailAttachments.contentType,
            sizeBytes: emailAttachments.sizeBytes,
          })
          .from(emailAttachments)
          .where(inArray(emailAttachments.emailMessageId, emailIds))
      : [];
    const filesOf = (id: string) =>
      sentFiles
        .filter((f) => f.emailMessageId === id)
        .map(({ emailMessageId: _, ...file }) => file);
    const source = (entityType: ActivityEntityType | null, entityId: string | null) =>
      entityType && entityId && !(entityType === input.entityType && entityId === input.entityId)
        ? { entityType, entityId }
        : null;
    const items = [
      ...sms
        .filter(({ row }) => visible(row.entityType))
        .map(({ row, senderName }) => ({
          kind: 'sms' as const,
          id: row.id,
          direction: row.direction as 'outbound' | 'inbound',
          from: row.fromNumber,
          to: [row.toNumber],
          cc: [] as string[],
          subject: null,
          body: row.content,
          html: null,
          attachments: 0,
          files: [] as ReturnType<typeof filesOf>,
          inReplyToId: null,
          fromStaff: false,
          segments: row.segments,
          status: row.status,
          statusAt: row.statusAt?.toISOString() ?? null,
          error: row.error,
          senderName,
          source: source(row.entityType, row.entityId),
          createdAt: row.createdAt.toISOString(),
        })),
      ...emails
        .filter(({ row }) => visible(row.entityType))
        .map(({ row, senderName }) => ({
          kind: 'email' as const,
          id: row.id,
          direction: row.direction as 'outbound' | 'inbound',
          from: row.fromAddress,
          to: row.toAddresses,
          cc: row.ccAddresses,
          subject: row.subject,
          body: row.bodyText,
          html: row.bodyHtml,
          attachments: row.attachmentCount,
          /** Files sent from the CRM (received ones stay in Gmail). */
          files: filesOf(row.id),
          inReplyToId: row.inReplyToId,
          /** Received, but from a colleague (a reply-all with the customer on it). */
          fromStaff: row.direction === 'inbound' && row.sentByUserId !== null,
          segments: null,
          status: row.status,
          statusAt: row.sentAt?.toISOString() ?? null,
          error: row.error,
          senderName,
          source: source(row.entityType, row.entityId),
          // A received email is placed at when it arrived, not when it was synced.
          createdAt: (row.sentAt ?? row.createdAt).toISOString(),
        })),
    ];
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
  }),

  /** A record's SMS, newest first, with delivery status. */
  sms: protectedProcedure.input(messageListSchema).query(async ({ ctx, input }) => {
    assertAllowed(ctx.user, input.entityType, 'view');
    const rows = await ctx.db
      .select({ sms: smsMessages, senderName: users.name })
      .from(smsMessages)
      .leftJoin(users, eq(users.id, smsMessages.sentByUserId))
      .where(
        and(eq(smsMessages.entityType, input.entityType), eq(smsMessages.entityId, input.entityId)),
      )
      .orderBy(desc(smsMessages.createdAt))
      .limit(200);
    return rows.map(({ sms, senderName }) => ({
      id: sms.id,
      direction: sms.direction as 'outbound' | 'inbound',
      from: sms.fromNumber,
      to: sms.toNumber,
      content: sms.content,
      segments: sms.segments,
      encoding: sms.encoding,
      status: sms.status,
      statusAt: sms.statusAt?.toISOString() ?? null,
      error: sms.error,
      senderName,
      createdAt: sms.createdAt.toISOString(),
    }));
  }),

  /** A record's emails, newest first. */
  emails: protectedProcedure.input(messageListSchema).query(async ({ ctx, input }) => {
    assertAllowed(ctx.user, input.entityType, 'view');
    const rows = await ctx.db
      .select({ email: emailMessages, senderName: users.name })
      .from(emailMessages)
      .leftJoin(users, eq(users.id, emailMessages.sentByUserId))
      .where(
        and(
          eq(emailMessages.entityType, input.entityType),
          eq(emailMessages.entityId, input.entityId),
        ),
      )
      .orderBy(desc(emailMessages.createdAt))
      .limit(200);
    return rows.map(({ email, senderName }) => ({
      id: email.id,
      direction: email.direction as 'outbound' | 'inbound',
      from: email.fromAddress,
      to: email.toAddresses,
      cc: email.ccAddresses,
      subject: email.subject,
      body: email.bodyText,
      status: email.status,
      error: email.error,
      threadId: email.gmailThreadId,
      senderName,
      sentAt: email.sentAt?.toISOString() ?? null,
      createdAt: email.createdAt.toISOString(),
    }));
  }),
});
