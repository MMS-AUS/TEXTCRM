import { eq, sql } from 'drizzle-orm';
import { emptyPermissionMatrix, isFeature, type PermissionMatrix } from '@mms/shared';
import type { Db } from '../db/client.ts';
import { auditLog, rolePermissions, roles, users } from '../db/schema/index.ts';
import type { AuthUser, DenyReason } from './types.ts';

export async function findUserForAuth(db: Db, email: string): Promise<AuthUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.email, email));
  if (!row) return null;

  const permissionRows = await db
    .select()
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, row.roleId));

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isActive: row.isActive,
    role: { key: row.roleKey, name: row.roleName },
    permissions: toPermissionMatrix(permissionRows),
  };
}

export function toPermissionMatrix(
  rows: (typeof rolePermissions.$inferSelect)[],
): PermissionMatrix {
  const matrix = emptyPermissionMatrix();
  for (const r of rows) {
    // Rows for features this code version doesn't know about are ignored, never granted.
    if (!isFeature(r.feature)) continue;
    matrix[r.feature] = {
      view: r.canView,
      create: r.canCreate,
      edit: r.canEdit,
      delete: r.canDelete,
      export: r.canExport,
    };
  }
  return matrix;
}

export interface RequestMeta {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export async function recordSignIn(
  db: Db,
  input: { userId: string; firebaseUid: string } & RequestMeta,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ firebaseUid: input.firebaseUid, lastSignInAt: sql`now()` })
      .where(eq(users.id, input.userId));
    await tx.insert(auditLog).values({
      actorType: 'user',
      actorUserId: input.userId,
      action: 'sign_in',
      entityType: 'user',
      entityId: input.userId,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  });
}

export async function recordSignInDenied(
  db: Db,
  input: { email: string | null; userId: string | null; reason: DenyReason } & RequestMeta,
): Promise<void> {
  await db.insert(auditLog).values({
    actorType: 'user',
    actorUserId: null,
    action: 'sign_in_denied',
    entityType: 'user',
    entityId: input.userId,
    changes: { after: { email: input.email, reason: input.reason } },
    requestId: input.requestId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
}
