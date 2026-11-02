import {
  FILE_ACCEPT,
  FILE_CATEGORIES,
  FILE_CATEGORY_LABELS,
  FILE_ENTITY_FEATURE,
  formatBytes,
  MAX_FILE_BYTES,
  MAX_THUMBNAIL_BYTES,
  resolveContentType,
  type FileCategory,
  type FileEntityType,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  ExternalLink,
  FileImage,
  FileSpreadsheet,
  FileText,
  MoreHorizontal,
  Paperclip,
  Trash2,
  Upload,
} from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useProfile } from '../auth/auth-context.ts';
import { errorMessage } from '../lib/errors.ts';
import { formatDate } from '../lib/format.ts';
import { useCan } from '../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../lib/trpc.ts';
import {
  Alert,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Select,
  Skeleton,
  toast,
} from '../ui/index.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

type StoredFile = RouterOutputs['files']['list'][number];
type Upload = { key: string; name: string; progress: number; error?: string };

const CATEGORY_OPTIONS = FILE_CATEGORIES.map((value) => ({
  value,
  label: FILE_CATEGORY_LABELS[value],
}));

/** A small JPEG preview (max 320 px) for images the browser can decode; null otherwise. */
async function makeThumbnail(file: File): Promise<Blob | null> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8);
    });
    return blob && blob.size <= MAX_THUMBNAIL_BYTES ? blob : null;
  } catch {
    return null; // A preview is a nice-to-have; the upload goes ahead without it.
  }
}

/** PUT to a presigned URL with upload progress (fetch can't report upload progress). */
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Storage refused the upload (${String(request.status)}).`));
    };
    request.onerror = () => {
      reject(new Error("Couldn't reach file storage. Check your connection and try again."));
    };
    request.send(body);
  });
}

function FileIcon({ contentType }: { contentType: string }) {
  if (contentType.startsWith('image/')) return <FileImage />;
  if (/sheet|excel|csv/.test(contentType)) return <FileSpreadsheet />;
  return <FileText />;
}

/** Files attached to a record: upload (drag and drop or picker), open, download, remove. */
export function FilesPanel({
  entityType,
  entityId,
  readOnly = false,
}: {
  entityType: FileEntityType;
  entityId: string;
  readOnly?: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const can = useCan();
  const feature = FILE_ENTITY_FEATURE[entityType];
  const canUpload = !readOnly && can(feature, 'edit');
  const query = useQuery(trpc.files.list.queryOptions({ entityType, entityId }));
  const createUpload = useMutation(trpc.files.createUpload.mutationOptions());
  const completeUpload = useMutation(trpc.files.completeUpload.mutationOptions());
  const downloadUrl = useMutation(trpc.files.downloadUrl.mutationOptions());
  const remove = useMutation(trpc.files.remove.mutationOptions());
  const [category, setCategory] = useState<FileCategory>(entityType === 'lead' ? 'bill' : 'other');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<StoredFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.files.pathFilter()),
      queryClient.invalidateQueries(trpc.activities.pathFilter()),
    ]);

  const setUpload = (key: string, patch: Partial<Upload>) => {
    setUploads((current) => current.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  };

  const uploadOne = async (file: File) => {
    const key = `${file.name}-${String(Date.now())}-${String(Math.random())}`;
    setUploads((current) => [...current, { key, name: file.name, progress: 0 }]);
    try {
      const contentType = resolveContentType(file.name, file.type);
      if (!contentType) {
        throw new Error(
          'That type of file is not accepted. Upload a PDF, photo, Word or Excel file.',
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`Files can be up to ${formatBytes(MAX_FILE_BYTES)}.`);
      }
      const thumbnail = await makeThumbnail(file);
      const ticket = await createUpload.mutateAsync({
        entityType,
        entityId,
        category,
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
        withThumbnail: thumbnail !== null,
      });
      await putWithProgress(ticket.uploadUrl, file, ticket.contentType, (fraction) => {
        setUpload(key, { progress: fraction });
      });
      if (ticket.thumbnailUploadUrl && thumbnail) {
        // A missing preview doesn't fail the upload; the API simply drops it.
        await putWithProgress(
          ticket.thumbnailUploadUrl,
          thumbnail,
          'image/jpeg',
          () => undefined,
        ).catch(() => undefined);
      }
      await completeUpload.mutateAsync({ id: ticket.id });
      setUploads((current) => current.filter((u) => u.key !== key));
      toast({ title: `Uploaded ${file.name}`, tone: 'success' });
    } catch (error) {
      setUpload(key, {
        error: error instanceof Error && !('data' in error) ? error.message : errorMessage(error),
      });
    }
  };

  const uploadAll = async (list: FileList | File[]) => {
    for (const file of Array.from(list)) await uploadOne(file);
    await refresh();
  };

  const open = async (file: StoredFile, inline: boolean) => {
    try {
      const { url } = await downloadUrl.mutateAsync({ id: file.id, inline });
      if (inline) {
        window.open(url, '_blank', 'noopener');
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        link.click();
      }
    } catch (error) {
      toast({ title: "Couldn't open the file", description: errorMessage(error), tone: 'danger' });
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (canUpload && event.dataTransfer.files.length > 0) void uploadAll(event.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-4">
      {canUpload && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface-2/40 px-4 py-6 text-center transition-colors sm:flex-row sm:text-left',
            dragging && 'border-accent bg-accent-subtle',
          )}
        >
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface text-fg-muted shadow-xs">
            <Upload className="size-5" />
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Drop files here, or choose them</p>
            <p className="text-fg-muted">
              PDF, photos, Word or Excel · up to {formatBytes(MAX_FILE_BYTES)} each
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-40">
              <Select
                aria-label="File type"
                value={category}
                onValueChange={(value) => {
                  const next = FILE_CATEGORIES.find((c) => c === value);
                  if (next) setCategory(next);
                }}
                options={CATEGORY_OPTIONS}
              />
            </div>
            <Button
              variant="primary"
              onClick={() => {
                inputRef.current?.click();
              }}
            >
              <Paperclip />
              Choose files
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              aria-label="Choose files to upload"
              className="sr-only"
              onChange={(event) => {
                if (event.target.files?.length) void uploadAll(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Uploads in progress">
          {uploads.map((upload) => (
            <li key={upload.key} className="rounded-md border border-line px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate">{upload.name}</span>
                {upload.error ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setUploads((current) => current.filter((u) => u.key !== upload.key));
                    }}
                  >
                    Dismiss
                  </Button>
                ) : (
                  <span className="text-xs text-fg-muted tabular-nums">
                    {Math.round(upload.progress * 100)}%
                  </span>
                )}
              </div>
              {upload.error ? (
                <p className="mt-1 text-xs text-danger-text">{upload.error}</p>
              ) : (
                <div
                  role="progressbar"
                  aria-label={`Uploading ${upload.name}`}
                  aria-valuenow={Math.round(upload.progress * 100)}
                  className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3"
                >
                  <div
                    className="h-full bg-accent transition-[width]"
                    style={{ width: `${String(Math.round(upload.progress * 100))}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {query.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : query.isError ? (
        <Alert tone="danger">{errorMessage(query.error)}</Alert>
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={<Paperclip />}
          title="No files yet"
          description={
            canUpload ? 'Upload bills, site photos and signed contracts here.' : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Files">
          {query.data.map((file) => {
            const mine = file.uploadedByUserId === profile.id;
            const canRemove = !readOnly && (mine ? can(feature, 'edit') : can(feature, 'delete'));
            return (
              <li
                key={file.id}
                className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5"
              >
                <button
                  type="button"
                  onClick={() => void open(file, file.canOpenInBrowser)}
                  className="grid size-12 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-md bg-surface-2 text-fg-muted [&_svg]:size-5"
                  aria-label={`Open ${file.fileName}`}
                >
                  {file.thumbnailUrl ? (
                    <img src={file.thumbnailUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <FileIcon contentType={file.contentType} />
                  )}
                </button>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium" title={file.fileName}>
                    {file.fileName}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                    <Badge>{FILE_CATEGORY_LABELS[file.category]}</Badge>
                    {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}
                    {file.uploaderName && ` · ${file.uploaderName}`}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton label={`Actions for ${file.fileName}`} size="sm">
                      <MoreHorizontal />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {file.canOpenInBrowser && (
                      <DropdownMenuItem onSelect={() => void open(file, true)}>
                        <ExternalLink />
                        Open
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => void open(file, false)}>
                      <Download />
                      Download
                    </DropdownMenuItem>
                    {canRemove && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          destructive
                          onSelect={() => {
                            setRemoving(file);
                          }}
                        >
                          <Trash2 />
                          Remove
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        title="Remove this file?"
        description={
          removing ? `${removing.fileName} will be deleted from storage. This can't be undone.` : ''
        }
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await remove.mutateAsync({ id: removing.id });
          await refresh();
          toast({ title: 'File removed' });
        }}
      />
    </div>
  );
}
