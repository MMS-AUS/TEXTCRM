import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { files } from '../db/schema/index.ts';
import type { Storage } from '../storage/storage.ts';

/** An upload not confirmed within this time was abandoned (tab closed, network lost). */
export const ABANDONED_UPLOAD_HOURS = 24;

/**
 * Removes abandoned uploads: 'pending' file rows older than a day, and whatever bytes reached
 * storage for them. Ready files are never touched. Returns how many were removed.
 */
export async function cleanupPendingUploads(
  db: Db,
  storage: Storage | null,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - ABANDONED_UPLOAD_HOURS * 3600_000);
  const abandoned = await db
    .select({ id: files.id, storageKey: files.storageKey, thumbnailKey: files.thumbnailKey })
    .from(files)
    .where(and(eq(files.status, 'pending'), lt(files.createdAt, cutoff)))
    .limit(500);
  if (abandoned.length === 0) return 0;
  if (storage) {
    await storage.remove(
      abandoned.flatMap((file) =>
        file.thumbnailKey ? [file.storageKey, file.thumbnailKey] : [file.storageKey],
      ),
    );
  }
  await db.delete(files).where(
    and(
      eq(files.status, 'pending'),
      inArray(
        files.id,
        abandoned.map((file) => file.id),
      ),
    ),
  );
  return abandoned.length;
}
