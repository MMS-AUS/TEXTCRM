import {
  EMAIL_ATTACHMENT_ACCEPT,
  emailAttachmentType,
  formatBytes,
  MAX_EMAIL_ATTACHMENT_BYTES,
  MAX_EMAIL_ATTACHMENTS,
  MAX_EMAIL_TOTAL_ATTACHMENT_BYTES,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileText, Image as ImageIcon, Paperclip, Save, Send, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { errorMessage } from '../../lib/errors.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import { putWithProgress } from '../../lib/upload.ts';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Progress,
  RichTextEditor,
  toast,
} from '../../ui/index.ts';
import { reSubject, type ReplyTo, type Target } from './types.ts';

// The email composer (Step 5.2): rich text, attachments (uploaded to S3/R2 as they're added),
// the user's signature, Save draft and Send.

export type Draft = RouterOutputs['messaging']['drafts'][number];

type Attachment = {
  /** Local key (the server id once known). */
  key: string;
  id: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** 0–1 while uploading; null when done. */
  progress: number | null;
  error: string | null;
};

const splitAddresses = (text: string) =>
  text
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);

/** The plain text of saved HTML (to know whether a reopened draft has content). */
const textOf = (html: string) =>
  html ? new DOMParser().parseFromString(html, 'text/html').body.textContent : '';

function useRefreshMessages() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.messaging.pathFilter()),
      queryClient.invalidateQueries(trpc.activities.pathFilter()),
    ]);
}

function Attachments({
  items,
  onAdd,
  onRemove,
}: {
  items: Attachment[];
  onAdd: (files: File[]) => void;
  onRemove: (item: Attachment) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const total = items.reduce((sum, a) => sum + a.sizeBytes, 0);
  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <ul aria-label="Attachments" className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-2 rounded-md border border-line bg-surface-2/50 px-2 py-1.5 text-sm"
            >
              {item.contentType.startsWith('image/') ? (
                <ImageIcon className="size-4 shrink-0 text-fg-muted" aria-hidden />
              ) : (
                <FileText className="size-4 shrink-0 text-fg-muted" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.fileName}</span>
                {item.error ? (
                  <span className="block text-xs text-danger-text">{item.error}</span>
                ) : item.progress !== null ? (
                  <Progress
                    value={item.progress}
                    label={`Uploading ${item.fileName}`}
                    className="mt-1"
                  />
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-fg-muted tabular-nums">
                {formatBytes(item.sizeBytes)}
              </span>
              <IconButton
                size="sm"
                label={`Remove ${item.fileName}`}
                onClick={() => {
                  onRemove(item);
                }}
              >
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={EMAIL_ATTACHMENT_ACCEPT}
          aria-label="Choose files to attach"
          onChange={(event) => {
            onAdd(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <Button
          size="sm"
          onClick={() => {
            input.current?.click();
          }}
        >
          <Paperclip />
          Attach files
        </Button>
        <span className="text-xs text-fg-muted">
          PDFs and images, up to 10 MB each
          {items.length > 0 && ` · ${formatBytes(total)} of 18 MB`}
        </span>
      </div>
    </div>
  );
}

function EmailForm({
  target,
  reply,
  draft,
  onDone,
}: {
  target: Target;
  reply?: ReplyTo;
  draft?: Draft;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const refresh = useRefreshMessages();
  const status = useQuery(trpc.integrations.status.queryOptions());
  const signature = useQuery(trpc.messaging.signature.queryOptions());
  const send = useMutation(trpc.messaging.sendEmail.mutationOptions());
  const saveDraft = useMutation(trpc.messaging.draftSave.mutationOptions());
  const createUpload = useMutation(trpc.messaging.attachmentUpload.mutationOptions());
  const completeUpload = useMutation(trpc.messaging.attachmentComplete.mutationOptions());
  const removeUpload = useMutation(trpc.messaging.attachmentRemove.mutationOptions());

  const [draftId, setDraftId] = useState(draft?.id);
  const [to, setTo] = useState(draft ? draft.to.join(', ') : (reply?.from ?? target.email ?? ''));
  const [cc, setCc] = useState(draft?.cc.join(', ') ?? '');
  const [subject, setSubject] = useState(draft?.subject ?? (reply ? reSubject(reply.subject) : ''));
  const [html, setHtml] = useState(draft?.html ?? '');
  const [text, setText] = useState(() => textOf(draft?.html ?? ''));
  const [attachments, setAttachments] = useState<Attachment[]>(
    draft?.attachments.map((a) => ({
      key: a.id,
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      progress: null,
      error: null,
    })) ?? [],
  );
  const [signatureChoice, setSignatureChoice] = useState<boolean | null>(
    draft ? draft.includeSignature : null,
  );
  const [problem, setProblem] = useState<string | null>(null);

  const replyToId = draft?.replyToId ?? reply?.id;
  const gmail = status.data?.providers.find((p) => p.provider === 'gmail')?.connection ?? null;
  const usable = gmail !== null && gmail.status !== 'expired';
  const withSignature = signatureChoice ?? signature.data?.fields.enabled ?? false;
  const uploading = attachments.some((a) => a.progress !== null);
  const broken = attachments.some((a) => a.error !== null);
  const ready =
    usable &&
    !uploading &&
    !broken &&
    splitAddresses(to).length > 0 &&
    subject.trim() &&
    text.trim();
  const update = (key: string, patch: Partial<Attachment>) => {
    setAttachments((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  };

  const addFiles = (files: File[]) => {
    setProblem(null);
    let total = attachments.reduce((sum, a) => sum + a.sizeBytes, 0);
    let count = attachments.length;
    for (const file of files) {
      const type = emailAttachmentType(file.name, file.type);
      if (!type) {
        setProblem(`${file.name}: attach PDFs or images (JPEG, PNG, GIF, WebP).`);
        continue;
      }
      if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
        setProblem(`${file.name} is over 10 MB.`);
        continue;
      }
      if (count + 1 > MAX_EMAIL_ATTACHMENTS) {
        setProblem(`Up to ${String(MAX_EMAIL_ATTACHMENTS)} files per email.`);
        break;
      }
      if (total + file.size > MAX_EMAIL_TOTAL_ATTACHMENT_BYTES) {
        setProblem('Attachments can add up to 18 MB per email (Gmail’s limit).');
        break;
      }
      total += file.size;
      count += 1;
      const key = crypto.randomUUID();
      setAttachments((list) => [
        ...list,
        {
          key,
          id: null,
          fileName: file.name,
          contentType: type,
          sizeBytes: file.size,
          progress: 0,
          error: null,
        },
      ]);
      createUpload
        .mutateAsync({ fileName: file.name, contentType: type, sizeBytes: file.size })
        .then(async (upload) => {
          update(key, { id: upload.id });
          await putWithProgress(upload.uploadUrl, file, upload.contentType, (fraction) => {
            update(key, { progress: fraction });
          });
          await completeUpload.mutateAsync({ id: upload.id });
          update(key, { progress: null });
        })
        .catch((error: unknown) => {
          update(key, { progress: null, error: errorMessage(error) });
        });
    }
  };

  const removeFile = (item: Attachment) => {
    setAttachments((list) => list.filter((a) => a.key !== item.key));
    if (item.id) removeUpload.mutate({ id: item.id });
  };

  const readyIds = () =>
    attachments.filter((a) => a.id && a.progress === null && !a.error).map((a) => a.id as string);

  const save = () => {
    saveDraft
      .mutateAsync({
        id: draftId,
        entityType: target.entityType,
        entityId: target.entityId,
        to: splitAddresses(to),
        cc: splitAddresses(cc),
        subject,
        html,
        ...(replyToId ? { replyToId } : {}),
        includeSignature: withSignature,
        attachmentIds: readyIds(),
      })
      .then(async (saved) => {
        setDraftId(saved.id);
        await queryClient.invalidateQueries(trpc.messaging.drafts.pathFilter());
        toast({
          title: 'Draft saved',
          description: 'Find it at the top of the Messages tab.',
          tone: 'success',
        });
        onDone();
      })
      .catch(() => undefined);
  };

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        send
          .mutateAsync({
            entityType: target.entityType,
            entityId: target.entityId,
            to: splitAddresses(to),
            cc: splitAddresses(cc),
            subject,
            html,
            ...(replyToId ? { replyToId } : {}),
            attachmentIds: readyIds(),
            includeSignature: withSignature,
            ...(draftId ? { draftId } : {}),
          })
          .then(async (result) => {
            await refresh();
            toast({
              title: `Email sent to ${result.to.join(', ')}`,
              description: 'It’s in your Gmail Sent folder too.',
              tone: 'success',
            });
            onDone();
          })
          .catch(async () => {
            await refresh();
          });
      }}
    >
      <DialogBody className="flex flex-col gap-4">
        {!status.isPending && !usable && (
          <Alert
            tone="warning"
            title={gmail ? 'Your Gmail access has expired' : 'Connect your Gmail first'}
          >
            Emails go from your own mailbox.{' '}
            <Link to="/settings/integrations" className="font-medium underline">
              {gmail ? 'Reconnect it' : 'Connect it'} in Connected accounts
            </Link>
            .
          </Alert>
        )}
        {send.isError && <Alert tone="danger">{errorMessage(send.error)}</Alert>}
        {saveDraft.isError && <Alert tone="danger">{errorMessage(saveDraft.error)}</Alert>}
        {gmail?.account && <p className="text-sm text-fg-muted">From {gmail.account}</p>}
        <Field label="To" required hint="Separate several addresses with commas.">
          {(props) => (
            <Input
              {...props}
              type="email"
              multiple
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="CC">
          {(props) => (
            <Input
              {...props}
              type="email"
              multiple
              value={cc}
              onChange={(event) => {
                setCc(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Subject" required>
          {(props) => (
            <Input
              {...props}
              value={subject}
              autoFocus={!reply && !draft}
              onChange={(event) => {
                setSubject(event.target.value.replace(/[\r\n]+/g, ' '));
              }}
            />
          )}
        </Field>
        <RichTextEditor
          label="Message"
          required
          defaultValue={draft?.html}
          onChange={(nextHtml, nextText) => {
            setHtml(nextHtml);
            setText(nextText);
          }}
          footer={
            withSignature && signature.data?.previewHtml ? (
              <div
                aria-label="Your signature"
                className="email-text opacity-80"
                // Built on the server from the signature fields, every value escaped.
                dangerouslySetInnerHTML={{ __html: signature.data.previewHtml }}
              />
            ) : undefined
          }
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={withSignature}
              disabled={!signature.data?.previewHtml}
              onCheckedChange={(checked) => {
                setSignatureChoice(checked === true);
              }}
            />
            Add my signature
          </label>
          <Link to="/settings/email-signature" className="text-xs text-fg-muted underline">
            Edit signature
          </Link>
        </div>
        {problem && <Alert tone="warning">{problem}</Alert>}
        <Attachments items={attachments} onAdd={addFiles} onRemove={removeFile} />
        {replyToId && (
          <p className="text-xs text-fg-muted">
            Sent as a reply, so it stays in the same conversation in Gmail.
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={saveDraft.isPending} disabled={uploading || send.isPending} onClick={save}>
          <Save />
          Save draft
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={send.isPending}
          disabled={!ready || saveDraft.isPending}
        >
          <Send />
          {uploading ? 'Uploading…' : 'Send'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The email dialog: new, a reply to a received email, or a saved draft reopened. */
export function EmailDialog({
  target,
  reply,
  draft,
  open,
  onOpenChange,
}: {
  target: Target;
  reply?: ReplyTo;
  draft?: Draft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const title = draft
    ? `Draft: ${draft.subject || '(no subject)'}`
    : reply
      ? `Reply to ${reply.from}`
      : `Email to ${target.name}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className="max-w-3xl">
        {open && (
          <EmailForm
            target={target}
            reply={reply}
            draft={draft}
            onDone={() => {
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
