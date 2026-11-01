import { boolean, check, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { id, lowercaseEmailCheck, timestamps, tstz } from './_columns.ts';

export const roles = pgTable('roles', {
  id: id(),
  /** Stable key used by code, e.g. 'admin'. */
  key: text().notNull().unique(),
  name: text().notNull(),
  description: text(),
  /** System roles (§1.2) cannot be deleted from the admin UI. */
  isSystem: boolean().notNull().default(false),
  ...timestamps,
});

/** Per-feature toggles (§1.2). `feature` is one of FEATURES in @mms/shared. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    feature: text().notNull(),
    canView: boolean().notNull().default(false),
    canCreate: boolean().notNull().default(false),
    canEdit: boolean().notNull().default(false),
    canDelete: boolean().notNull().default(false),
    canExport: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.roleId, t.feature] })],
);

/** The sign-in allowlist. No passwords — identity comes from Firebase (Google Workspace). */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text().notNull().unique('users_email_unique'),
    name: text().notNull(),
    phone: text(),
    /** Set on first successful sign-in. */
    firebaseUid: text().unique('users_firebase_uid_unique'),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    /** Option value from `employeeDepartments`. */
    department: text(),
    voiplineNumber: text(),
    smsSenderId: text(),
    isActive: boolean().notNull().default(true),
    deactivatedAt: tstz(),
    lastSignInAt: tstz(),
    ...timestamps,
  },
  (t) => [check('users_email_lowercase', lowercaseEmailCheck(t.email))],
);
