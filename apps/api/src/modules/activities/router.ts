import { TRPCError } from '@trpc/server';
import { aliasedTable, and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACTIVITY_ENTITY_FEATURE,
  ACTIVITY_ENTITY_TYPES,
  activityInputSchema,
  hasPermission,
  type ActivityEntityType,
  type PermissionAction,
} from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import { activities, contacts, leads, users } from '../../db/schema/index.ts';
import { protectedProcedure, router } from '../../trpc/trpc.ts';
import type { AuthUser } from '../../auth/types.ts';
import { recordAudit } from '../audit.ts';
import { assertEntityExists } from './service.ts';

function assertAllowed(user: AuthUser, entityType: ActivityEntityType, action: PermissionAction) {
  if (!hasPermission(user.permissions, ACTIVITY_ENTITY_FEATURE[entityType], action)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your role does not allow this action.' });
  }
}

async function assertActiveUser(db: Db | Tx, userId: string) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true)));
  if (!user) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That person is not an active user.' });
  }
}

async function loadActivity(db: Db | Tx, id: string) {
  const [activity] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, id), isNull(activities.deletedAt)));
  if (!activity) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'This activity no longer exists.' });
  }
  return activity;
}

const entityInput = z.object({
  entityType: z.enum(ACTIVITY_ENTITY_TYPES),
  entityId: z.uuid(),
});

export const activitiesRouter = router({
  /** A record's timeline, newest first. */
  list: protectedProcedure.input(entityInput).query(async ({ ctx, input }) => {
    assertAllowed(ctx.user, input.entityType, 'view');
    const author = aliasedTable(users, 'author');
    const assignee = aliasedTable(users, 'assignee');
    const rows = await ctx.db
      .select({
        activity: activities,
        authorName: author.name,
        assigneeName: assignee.name,
      })
      .from(activities)
      .leftJoin(author, eq(author.id, activities.authorUserId))
      .leftJoin(assignee, eq(assignee.id, activities.assignedUserId))
      .where(
        and(
          eq(activities.entityType, input.entityType),
          eq(activities.entityId, input.entityId),
          isNull(activities.deletedAt),
        ),
      )
      .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
      .limit(500);
    return rows.map(({ activity, authorName, assigneeName }) => ({
      id: activity.id,
      type: activity.type,
      subject: activity.subject,
      body: activity.body,
      direction: activity.direction,
      outcome: activity.outcome,
      durationMinutes: activity.durationMinutes,
      metadata: activity.metadata,
      occurredAt: activity.occurredAt.toISOString(),
      dueAt: activity.dueAt?.toISOString() ?? null,
      completedAt: activity.completedAt?.toISOString() ?? null,
      assignedUserId: activity.assignedUserId,
      assigneeName,
      authorUserId: activity.authorUserId,
      authorName,
    }));
  }),

  create: protectedProcedure.input(activityInputSchema).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      assertAllowed(ctx.user, input.entityType, 'edit');
      await assertEntityExists(tx, input.entityType, input.entityId);
      const base = {
        entityType: input.entityType,
        entityId: input.entityId,
        type: input.type,
        authorUserId: ctx.user.id,
      };
      let values: typeof activities.$inferInsert;
      switch (input.type) {
        case 'note':
          values = { ...base, body: input.body };
          break;
        case 'call':
          values = {
            ...base,
            direction: input.direction,
            outcome: input.outcome,
            durationMinutes: input.durationMinutes ?? null,
            body: input.body,
          };
          break;
        case 'meeting':
          values = {
            ...base,
            subject: input.subject,
            body: input.body,
            occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          };
          break;
        case 'task': {
          const assignedUserId = input.assignedUserId ?? ctx.user.id;
          await assertActiveUser(tx, assignedUserId);
          values = {
            ...base,
            subject: input.subject,
            body: input.body,
            dueAt: new Date(input.dueAt),
            assignedUserId,
          };
          break;
        }
      }
      const [created] = await tx.insert(activities).values(values).returning({ id: activities.id });
      if (!created) throw new Error('Insert returned no row');
      if (input.entityType === 'contact' && input.type === 'call') {
        await tx
          .update(contacts)
          .set({ lastContactedAt: new Date() })
          .where(eq(contacts.id, input.entityId));
      }
      return created;
    }),
  ),

  /** Tick a task done (or undo it). */
  setCompleted: protectedProcedure
    .input(z.object({ id: z.uuid(), completed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const activity = await loadActivity(ctx.db, input.id);
      assertAllowed(ctx.user, activity.entityType, 'edit');
      if (activity.type !== 'task') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only tasks can be completed.' });
      }
      await ctx.db
        .update(activities)
        .set({ completedAt: input.completed ? new Date() : null })
        .where(eq(activities.id, input.id));
      return { id: input.id };
    }),

  /** Authors can remove their own entries; others need delete permission on the record. */
  remove: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const activity = await loadActivity(tx, input.id);
      if (activity.type === 'system') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Entries the CRM recorded itself cannot be removed.',
        });
      }
      assertAllowed(
        ctx.user,
        activity.entityType,
        activity.authorUserId === ctx.user.id ? 'edit' : 'delete',
      );
      await tx.update(activities).set({ deletedAt: new Date() }).where(eq(activities.id, input.id));
      await recordAudit(
        tx,
        { userId: ctx.user.id, meta: ctx.meta },
        {
          action: 'activity_remove',
          entityType: activity.entityType,
          entityId: activity.entityId,
          before: {
            type: activity.type,
            subject: activity.subject,
            body: activity.body,
          },
        },
      );
      return { id: input.id };
    }),
  ),

  /** My open tasks due by the end of `before` (default: today), overdue first. */
  myTasks: protectedProcedure
    .input(z.object({ before: z.iso.datetime({ offset: true }) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: activities.id,
          subject: activities.subject,
          dueAt: activities.dueAt,
          entityType: activities.entityType,
          entityId: activities.entityId,
          leadName: sql<
            string | null
          >`${leads.firstName} || coalesce(' ' || ${leads.lastName}, '')`,
          contactName: sql<
            string | null
          >`${contacts.firstName} || coalesce(' ' || ${contacts.lastName}, '')`,
        })
        .from(activities)
        .leftJoin(leads, and(eq(activities.entityType, 'lead'), eq(leads.id, activities.entityId)))
        .leftJoin(
          contacts,
          and(eq(activities.entityType, 'contact'), eq(contacts.id, activities.entityId)),
        )
        .where(
          and(
            eq(activities.assignedUserId, ctx.user.id),
            eq(activities.type, 'task'),
            isNull(activities.completedAt),
            isNull(activities.deletedAt),
            lte(activities.dueAt, new Date(input.before)),
          ),
        )
        .orderBy(asc(activities.dueAt))
        .limit(100);
      return rows.map((row) => ({
        id: row.id,
        subject: row.subject,
        dueAt: row.dueAt?.toISOString() ?? null,
        entityType: row.entityType,
        entityId: row.entityId,
        entityName: row.leadName ?? row.contactName,
      }));
    }),
});
