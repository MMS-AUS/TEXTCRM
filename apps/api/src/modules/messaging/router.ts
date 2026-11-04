import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import {
  ACTIVITY_ENTITY_FEATURE,
  countSms,
  emailSendSchema,
  hasPermission,
  messageListSchema,
  smsSendSchema,
  type ActivityEntityType,
  type PermissionAction,
} from '@mms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../auth/types.ts';
import { emailMessages, smsMessages, users } from '../../db/schema/index.ts';
import { protectedProcedure, router } from '../../trpc/trpc.ts';
import { webhookUrl, sendEmail, sendSms } from './service.ts';

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
    return sendEmail(ctx.db, ctx.integrations, sender(ctx.user), input, ctx.log);
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
