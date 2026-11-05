import { and, asc, eq, inArray, isNull, ne, notInArray } from 'drizzle-orm';
import { LEAD_CONVERTED, LEAD_LOST } from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import { activities, leads, roles, users } from '../../db/schema/index.ts';
import { recordAudit, type Actor } from '../audit.ts';

// Offboarding (F-02): when an admin deactivates someone, their open leads move to their manager
// — or, with no active manager, to the primary admin — in the deactivation's own transaction,
// so leads are never left with an owner who can't sign in. Reactivating moves nothing back.
// (There is deliberately no automatic deactivation for inactivity: short leaves are normal.)

const ADMIN_ROLE = 'admin';

export type ReassignTarget = {
  id: string;
  name: string;
  /** 'manager' = their manager; 'primary_admin' = no active manager, so the primary admin. */
  reason: 'manager' | 'primary_admin';
};

/** A lead still being worked: not deleted, not converted, not lost. */
export const openLeadsOf = (userId: string) =>
  and(
    eq(leads.ownerUserId, userId),
    isNull(leads.deletedAt),
    isNull(leads.convertedAt),
    notInArray(leads.status, [LEAD_CONVERTED, LEAD_LOST]),
  );

/**
 * Who takes over a departing user's leads: their manager if active, else the primary admin —
 * the longest-serving active admin other than them. Null only if no one is left (the last
 * admin can't be deactivated, so that can't happen through Settings).
 */
export async function reassignTarget(
  db: Db | Tx,
  user: { id: string; managerUserId: string | null },
): Promise<ReassignTarget | null> {
  if (user.managerUserId) {
    const [manager] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(eq(users.id, user.managerUserId), eq(users.isActive, true), ne(users.id, user.id)),
      );
    if (manager) return { ...manager, reason: 'manager' };
  }
  const [admin] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(roles.key, ADMIN_ROLE), eq(users.isActive, true), ne(users.id, user.id)))
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(1);
  return admin ? { ...admin, reason: 'primary_admin' } : null;
}

/** How many open leads would move, and to whom (shown before deactivating). */
export async function reassignPreview(
  db: Db | Tx,
  user: { id: string; managerUserId: string | null },
) {
  const [target, open] = await Promise.all([
    reassignTarget(db, user),
    db.select({ id: leads.id }).from(leads).where(openLeadsOf(user.id)),
  ]);
  return { openLeads: open.length, to: target };
}

/**
 * Moves the user's open leads to `to`, with a timeline entry and an audit row on each lead.
 * Runs in the caller's transaction: if anything fails, the deactivation is undone with it.
 */
export async function reassignOpenLeads(
  tx: Tx,
  actor: Actor,
  from: { id: string; name: string },
  to: ReassignTarget,
): Promise<number> {
  // Locked so a lead edited at the same moment can't keep the departing owner.
  const open = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(openLeadsOf(from.id))
    .for('update');
  if (open.length === 0) return 0;
  const ids = open.map((l) => l.id);
  const now = new Date();
  await tx
    .update(leads)
    .set({ ownerUserId: to.id, updatedAt: now, updatedByUserId: actor.userId })
    .where(inArray(leads.id, ids));
  const subject = `Reassigned from ${from.name} to ${to.name} due to deactivation`;
  await tx.insert(activities).values(
    ids.map((id) => ({
      entityType: 'lead' as const,
      entityId: id,
      type: 'system' as const,
      subject,
      authorUserId: actor.userId,
      metadata: {
        reason: 'deactivation',
        fromUserId: from.id,
        toUserId: to.id,
        to: to.reason,
      },
    })),
  );
  for (const id of ids) {
    await recordAudit(tx, actor, {
      action: 'reassign',
      entityType: 'lead',
      entityId: id,
      before: { ownerUserId: from.id },
      after: { ownerUserId: to.id },
    });
  }
  return ids.length;
}
