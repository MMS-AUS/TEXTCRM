import { and, desc, eq } from 'drizzle-orm';
import type { RequestMeta } from '../auth/users-repo.ts';
import type { Db, Tx } from '../db/client.ts';
import { auditLog, users } from '../db/schema/index.ts';

export type Actor = { userId: string; meta: RequestMeta };

/** A change made by the CRM itself rather than a person, e.g. the live sheet sync. */
export type SystemActor = { system: 'sheet_sync' | 'system' };

type Values = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  // Lists (e.g. a lead's extra emails or inverter lines) are the same when they hold the same
  // items in order; plain objects when every field is the same.
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => same(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => same(a[key], b[key]));
  }
  return a === b;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Only the fields that changed, as { before, after } — keeps the audit log readable. */
export function diff(before: Values, after: Values): { before: Values; after: Values } | null {
  const changedKeys = Object.keys(after).filter((key) => !same(before[key], after[key]));
  if (changedKeys.length === 0) return null;
  return {
    before: Object.fromEntries(changedKeys.map((key) => [key, before[key] ?? null])),
    after: Object.fromEntries(changedKeys.map((key) => [key, after[key] ?? null])),
  };
}

/** Append one audit row (F-18) for a user action, in the caller's transaction. */
export async function recordAudit(
  db: Db | Tx,
  actor: Actor | SystemActor,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    before?: Values;
    after?: Values;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    actorType: 'system' in actor ? actor.system : 'user',
    actorUserId: 'system' in actor ? null : actor.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    changes: {
      ...(entry.before ? { before: entry.before } : {}),
      ...(entry.after ? { after: entry.after } : {}),
    },
    requestId: 'system' in actor ? null : actor.meta.requestId,
    ipAddress: 'system' in actor ? null : actor.meta.ipAddress,
    userAgent: 'system' in actor ? null : actor.meta.userAgent,
  });
}

/** Recent history of one record, newest first, with who did it. */
export async function entityHistory(db: Db, entityType: string, entityId: string, limit = 50) {
  const rows = await db
    .select({
      id: auditLog.id,
      occurredAt: auditLog.occurredAt,
      action: auditLog.action,
      changes: auditLog.changes,
      actorType: auditLog.actorType,
      actorName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    occurredAt: row.occurredAt.toISOString(),
    // jsonb comes back as whatever was stored; the API only ever stores {before?, after?}.
    changes: row.changes ?? {},
  }));
}
