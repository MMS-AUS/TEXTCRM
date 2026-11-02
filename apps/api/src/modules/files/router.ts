import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  ALLOWED_FILE_TYPES,
  FILE_CATEGORY_LABELS,
  FILE_ENTITY_FEATURE,
  FILE_ENTITY_TYPES,
  fileUploadRequestSchema,
  hasPermission,
  MAX_THUMBNAIL_BYTES,
  resolveContentType,
  type FileEntityType,
  type PermissionAction,
} from '@mms/shared';
import type { AuthUser } from '../../auth/types.ts';
import { files, users } from '../../db/schema/index.ts';
import type { Storage } from '../../storage/storage.ts';
import { protectedProcedure, router } from '../../trpc/trpc.ts';
import { logSystemActivity } from '../activities/service.ts';
import { recordAudit } from '../audit.ts';
import { assertEntityExists } from '../entities.ts';

function assertAllowed(user: AuthUser, entityType: FileEntityType, action: PermissionAction) {
  if (!hasPermission(user.permissions, FILE_ENTITY_FEATURE[entityType], action)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your role does not allow this action.' });
  }
}

function requireStorage(storage: Storage | null): Storage {
  if (!storage) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: "File storage isn't set up yet. Add the S3_ settings to .env (see the README).",
    });
  }
  return storage;
}

/** Keeps letters, digits, dot, dash and underscore — the original name stays in the database. */
function safeKeyName(fileName: string): string {
  const cleaned = fileName
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_');
  return cleaned.slice(-100) || 'file';
}

/** Timelines exist for leads and contacts (and later projects/tickets), not companies. */
function hasTimeline(
  entityType: FileEntityType,
): entityType is 'lead' | 'contact' | 'project' | 'ticket' {
  return entityType !== 'company';
}

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'This file no longer exists.' });

export const filesRouter = router({
  /**
   * Step 1 of an upload: records the file as pending and returns presigned URLs the browser
   * PUTs the bytes (and an optional thumbnail) to. Nothing is visible until completeUpload.
   */
  createUpload: protectedProcedure
    .input(fileUploadRequestSchema)
    .mutation(async ({ ctx, input }) => {
      assertAllowed(ctx.user, input.entityType, 'edit');
      const storage = requireStorage(ctx.storage);
      const contentType = resolveContentType(input.fileName, input.contentType);
      if (!contentType) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That type of file is not accepted. Upload a PDF, photo, Word or Excel file.',
        });
      }
      await assertEntityExists(ctx.db, input.entityType, input.entityId);

      const id = randomUUID();
      const prefix = `${input.entityType}/${input.entityId}/${id}`;
      const storageKey = `${prefix}/${safeKeyName(input.fileName)}`;
      const thumbnailKey =
        input.withThumbnail && contentType.startsWith('image/') ? `${prefix}/thumbnail.jpg` : null;

      await ctx.db.insert(files).values({
        id,
        entityType: input.entityType,
        entityId: input.entityId,
        category: input.category,
        fileName: input.fileName,
        contentType,
        sizeBytes: input.sizeBytes,
        storageKey,
        thumbnailKey,
        uploadedByUserId: ctx.user.id,
      });
      return {
        id,
        contentType,
        uploadUrl: await storage.presignUpload(storageKey, contentType, input.sizeBytes),
        // The thumbnail's exact size isn't known yet; it's capped when the upload is confirmed.
        thumbnailUploadUrl: thumbnailKey
          ? await storage.presignUpload(thumbnailKey, 'image/jpeg', MAX_THUMBNAIL_BYTES)
          : null,
      };
    }),

  /** Step 2: checks the bytes really arrived (size and type as declared), then shows the file. */
  completeUpload: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const storage = requireStorage(ctx.storage);
      const [file] = await ctx.db
        .select()
        .from(files)
        .where(and(eq(files.id, input.id), eq(files.uploadedByUserId, ctx.user.id)));
      if (!file || file.deletedAt) throw notFound();
      if (file.status === 'ready') return { id: file.id };

      const stored = await storage.head(file.storageKey);
      if (!stored || stored.sizeBytes !== file.sizeBytes) {
        // Clean up outside any transaction, so the error below doesn't undo it.
        await storage.remove([file.storageKey, ...(file.thumbnailKey ? [file.thumbnailKey] : [])]);
        await ctx.db.delete(files).where(eq(files.id, file.id));
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: stored
            ? "The upload didn't match the file you chose. Please try again."
            : "The file didn't finish uploading. Please try again.",
        });
      }
      let thumbnailKey = file.thumbnailKey;
      if (thumbnailKey) {
        const thumbnail = await storage.head(thumbnailKey);
        if (!thumbnail || thumbnail.sizeBytes > MAX_THUMBNAIL_BYTES) {
          if (thumbnail) await storage.remove([thumbnailKey]);
          thumbnailKey = null;
        }
      }

      return ctx.db.transaction(async (tx) => {
        // Only the first confirmation flips pending → ready, so a double click logs once.
        const flipped = await tx
          .update(files)
          .set({ status: 'ready', thumbnailKey })
          .where(and(eq(files.id, file.id), eq(files.status, 'pending')))
          .returning({ id: files.id });
        if (flipped.length === 0) return { id: file.id };

        const actor = { userId: ctx.user.id, meta: ctx.meta };
        await recordAudit(tx, actor, {
          action: 'file_upload',
          entityType: file.entityType,
          entityId: file.entityId,
          after: { fileId: file.id, fileName: file.fileName, category: file.category },
        });
        if (hasTimeline(file.entityType)) {
          await logSystemActivity(tx, {
            entityType: file.entityType,
            entityId: file.entityId,
            authorUserId: ctx.user.id,
            subject: `Uploaded ${FILE_CATEGORY_LABELS[file.category].toLowerCase()}: ${file.fileName}`,
            metadata: { fileId: file.id },
          });
        }
        return { id: file.id };
      });
    }),

  /** A record's files, newest first, with short-lived preview URLs for image thumbnails. */
  list: protectedProcedure
    .input(z.object({ entityType: z.enum(FILE_ENTITY_TYPES), entityId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      assertAllowed(ctx.user, input.entityType, 'view');
      const rows = await ctx.db
        .select({ file: files, uploaderName: users.name })
        .from(files)
        .leftJoin(users, eq(users.id, files.uploadedByUserId))
        .where(
          and(
            eq(files.entityType, input.entityType),
            eq(files.entityId, input.entityId),
            eq(files.status, 'ready'),
            isNull(files.deletedAt),
          ),
        )
        .orderBy(desc(files.createdAt));
      const storage = ctx.storage;
      return Promise.all(
        rows.map(async ({ file, uploaderName }) => ({
          id: file.id,
          category: file.category,
          fileName: file.fileName,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          createdAt: file.createdAt.toISOString(),
          uploadedByUserId: file.uploadedByUserId,
          uploaderName,
          canOpenInBrowser: ALLOWED_FILE_TYPES[file.contentType]?.inline ?? false,
          thumbnailUrl:
            storage && file.thumbnailKey ? await storage.presignPreview(file.thumbnailKey) : null,
        })),
      );
    }),

  /** A link valid for 60 seconds, issued only to someone allowed to see the record. */
  downloadUrl: protectedProcedure
    .input(z.object({ id: z.uuid(), inline: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const storage = requireStorage(ctx.storage);
      const [file] = await ctx.db
        .select()
        .from(files)
        .where(and(eq(files.id, input.id), eq(files.status, 'ready'), isNull(files.deletedAt)));
      if (!file) throw notFound();
      assertAllowed(ctx.user, file.entityType, 'view');
      const inline = input.inline && (ALLOWED_FILE_TYPES[file.contentType]?.inline ?? false);
      return {
        url: await storage.presignDownload(file.storageKey, { fileName: file.fileName, inline }),
      };
    }),

  /** Uploaders can remove their own files; others need delete permission on the record. */
  remove: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const storage = requireStorage(ctx.storage);
      const [file] = await tx
        .select()
        .from(files)
        .where(and(eq(files.id, input.id), isNull(files.deletedAt)));
      if (!file) throw notFound();
      assertAllowed(
        ctx.user,
        file.entityType,
        file.uploadedByUserId === ctx.user.id ? 'edit' : 'delete',
      );
      // The row is kept (marked deleted) for the audit trail; the bytes are removed for privacy.
      await tx.update(files).set({ deletedAt: new Date() }).where(eq(files.id, file.id));
      await recordAudit(
        tx,
        { userId: ctx.user.id, meta: ctx.meta },
        {
          action: 'file_remove',
          entityType: file.entityType,
          entityId: file.entityId,
          before: { fileId: file.id, fileName: file.fileName, category: file.category },
        },
      );
      await storage.remove([file.storageKey, ...(file.thumbnailKey ? [file.thumbnailKey] : [])]);
      return { id: file.id };
    }),
  ),
});
