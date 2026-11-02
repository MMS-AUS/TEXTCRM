import { and, eq, isNull } from 'drizzle-orm';
import type { ActivityEntityType } from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import { activities } from '../../db/schema/index.ts';

export { assertEntityExists } from '../entities.ts';

/**
 * A timeline entry written by the CRM itself, e.g. "Status: New → Contacted". Runs in the
 * caller's transaction so it's recorded exactly when the change is.
 */
export async function logSystemActivity(
  db: Db | Tx,
  entry: {
    entityType: ActivityEntityType;
    entityId: string;
    authorUserId: string | null;
    subject: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(activities).values({
    entityType: entry.entityType,
    entityId: entry.entityId,
    type: 'system',
    subject: entry.subject,
    metadata: entry.metadata ?? null,
    authorUserId: entry.authorUserId,
  });
}

/** Open tasks on a record — e.g. shown on the lead header. */
export function openTasksWhere(entityType: ActivityEntityType, entityId: string) {
  return and(
    eq(activities.entityType, entityType),
    eq(activities.entityId, entityId),
    eq(activities.type, 'task'),
    isNull(activities.completedAt),
    isNull(activities.deletedAt),
  );
}
