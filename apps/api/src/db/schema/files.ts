import { sql } from 'drizzle-orm';
import { bigint, check, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_columns.ts';
import { users } from './users.ts';

/** Keep in sync with FILE_ENTITY_TYPES in packages/shared/src/files.ts. */
export const fileEntityType = pgEnum('file_entity_type', [
  'lead',
  'contact',
  'company',
  'project',
  'ticket',
]);

/** Keep in sync with FILE_CATEGORIES in packages/shared/src/files.ts. */
export const fileCategory = pgEnum('file_category', [
  'bill',
  'photo',
  'contract',
  'saa_doc',
  'other',
]);

/**
 * A file attached to a record (F-13). The bytes live in object storage (Cloudflare R2; a local
 * S3-compatible container in development) under `storageKey`; this row is the index and the
 * access check. Rows start 'pending' while the browser uploads directly to storage, and become
 * 'ready' once the API has confirmed the object exists with the declared size and type.
 */
export const files = pgTable(
  'files',
  {
    id: id(),
    entityType: fileEntityType().notNull(),
    entityId: uuid().notNull(),
    category: fileCategory().notNull(),
    fileName: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    storageKey: text().notNull().unique('files_storage_key_unique'),
    /** Small JPEG preview made in the browser for images; null for other files. */
    thumbnailKey: text(),
    status: text().notNull().default('pending'),
    uploadedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    deletedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    index('files_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    check('files_status_valid', sql`${t.status} in ('pending', 'ready')`),
    check('files_size_positive', sql`${t.sizeBytes} > 0`),
  ],
);
