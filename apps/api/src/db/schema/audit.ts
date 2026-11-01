import { bigint, index, inet, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { tstz } from './_columns.ts';
import { users } from './users.ts';

export const auditActorType = pgEnum('audit_actor_type', [
  'user',
  'system',
  'sheet_sync',
  'webhook',
  'integration',
]);

export interface AuditChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Append-only: who changed what, when (F-18). Rows are never updated or deleted by the app. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: tstz().notNull().defaultNow(),
    actorType: auditActorType().notNull(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** e.g. 'create', 'update', 'delete', 'sign_in', 'convert_to_project'. */
    action: text().notNull(),
    /** Table-style name, e.g. 'lead', 'project'. */
    entityType: text().notNull(),
    entityId: text(),
    changes: jsonb().$type<AuditChanges>(),
    requestId: text(),
    ipAddress: inet(),
    userAgent: text(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId, t.occurredAt),
    index('audit_log_actor_idx').on(t.actorUserId, t.occurredAt),
    index('audit_log_occurred_at_idx').on(t.occurredAt),
  ],
);
