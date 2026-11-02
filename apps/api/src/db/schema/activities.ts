import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_columns.ts';
import { users } from './users.ts';

/** Keep in sync with ACTIVITY_TYPES in packages/shared/src/activities.ts. */
export const activityType = pgEnum('activity_type', [
  'note',
  'call',
  'meeting',
  'task',
  /** Written by the CRM itself: status changes, assignment, conversion. */
  'system',
]);

/** Keep in sync with ACTIVITY_ENTITY_TYPES in packages/shared/src/activities.ts. */
export const activityEntityType = pgEnum('activity_entity_type', [
  'lead',
  'contact',
  'project',
  'ticket',
]);

/**
 * The timeline of a record (F-05). Polymorphic — `entityType` + `entityId` point at a lead,
 * contact, project or ticket — so there is no foreign key on `entityId`; the API checks the
 * record exists and that the user may see it. Tasks are activities with a due date.
 */
export const activities = pgTable(
  'activities',
  {
    id: id(),
    entityType: activityEntityType().notNull(),
    entityId: uuid().notNull(),
    type: activityType().notNull(),
    subject: text(),
    body: text(),
    /** When the call/meeting happened (or the note was written). */
    occurredAt: tstz().notNull().defaultNow(),
    /** Calls: 'inbound' | 'outbound'. */
    direction: text(),
    /** Calls: e.g. 'Answered', 'No answer', 'Left voicemail'. */
    outcome: text(),
    durationMinutes: integer(),
    /** Tasks. */
    dueAt: tstz(),
    completedAt: tstz(),
    assignedUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** System activities: structured detail, e.g. { from: 'New', to: 'Contacted' }. */
    metadata: jsonb().$type<Record<string, unknown>>(),
    authorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    deletedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    index('activities_entity_idx').on(t.entityType, t.entityId, t.occurredAt),
    index('activities_open_tasks_idx')
      .on(t.assignedUserId, t.dueAt)
      .where(sql`${t.type} = 'task' and ${t.completedAt} is null and ${t.deletedAt} is null`),
    check(
      'activities_duration_non_negative',
      sql`${t.durationMinutes} is null or ${t.durationMinutes} >= 0`,
    ),
  ],
);

/** A user's named filter set on a list page, e.g. "My new Meta leads" (Step 2.2). */
export const savedViews = pgTable(
  'saved_views',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Which list, e.g. 'leads'. */
    page: text().notNull(),
    name: text().notNull(),
    /** The list's URL search params (validated by the web app when applied). */
    search: jsonb().$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (t) => [index('saved_views_user_page_idx').on(t.userId, t.page)],
);
