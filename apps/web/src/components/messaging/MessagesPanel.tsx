import {
  ACTIVITY_ENTITY_FEATURE,
  formatBytes,
  formatPhone,
  type ActivityEntityType,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  FilePen,
  Mail,
  MessageSquare,
  Paperclip,
  Reply,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../lib/errors.ts';
import { useCan } from '../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import { Alert, Badge, Button, EmptyState, Skeleton, type BadgeTone } from '../../ui/index.ts';
import { When } from '../When.tsx';
import { EmailDialog, type Draft } from './EmailComposer.tsx';
import type { ReplyTo } from './types.ts';

type Item = RouterOutputs['messaging']['history'][number];

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  queued: { label: 'Sending', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'info' },
  enroute: { label: 'On its way', tone: 'info' },
  submitted: { label: 'Submitted', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  received: { label: 'Received', tone: 'accent' },
  expired: { label: 'Not delivered (expired)', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'danger' },
  undeliverable: { label: 'Undeliverable', tone: 'danger' },
  failed: { label: 'Not sent', tone: 'danger' },
};

const SOURCE_LABEL: Record<ActivityEntityType, string> = {
  lead: 'a lead',
  contact: 'the contact',
  project: 'a project',
  ticket: 'a ticket',
};

function SourceLink({ source }: { source: NonNullable<Item['source']> }) {
  const label = `From ${SOURCE_LABEL[source.entityType]}`;
  const className = 'text-xs text-fg-muted hover:text-fg hover:underline';
  switch (source.entityType) {
    case 'lead':
      return (
        <Link to="/leads/$leadId" params={{ leadId: source.entityId }} className={className}>
          {label}
        </Link>
      );
    case 'contact':
      return (
        <Link
          to="/contacts/$contactId"
          params={{ contactId: source.entityId }}
          className={className}
        >
          {label}
        </Link>
      );
    case 'project':
      return (
        <Link
          to="/projects/$projectId"
          params={{ projectId: source.entityId }}
          className={className}
        >
          {label}
        </Link>
      );
    case 'ticket':
      return (
        <Link to="/tickets/$ticketId" params={{ ticketId: source.entityId }} className={className}>
          {label}
        </Link>
      );
  }
}

const who = (item: Item, value: string | null) =>
  value ? (item.kind === 'sms' ? formatPhone(value) : value) : '—';

function Message({ item, onReply }: { item: Item; onReply?: (reply: ReplyTo) => void }) {
  const [expanded, setExpanded] = useState(false);
  const from = item.from;
  const inbound = item.direction === 'inbound';
  const status = STATUS[item.status] ?? { label: item.status, tone: 'neutral' as const };
  const long = item.body.length > 400 || item.body.split('\n').length > 8;
  return (
    <li className="flex gap-3 py-3">
      <span
        className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-muted [&_svg]:size-4"
        aria-hidden
      >
        {item.kind === 'sms' ? <MessageSquare /> : <Mail />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {inbound ? (
            <ArrowDownLeft className="size-3.5 text-accent-text" aria-label="Received" />
          ) : (
            <ArrowUpRight className="size-3.5 text-fg-muted" aria-label="Sent" />
          )}
          <span className="font-medium">
            {inbound
              ? item.fromStaff && item.senderName
                ? `Email from ${item.senderName} (${who(item, item.from)})`
                : `${item.kind === 'sms' ? 'SMS' : 'Email'} from ${who(item, item.from)}`
              : `${item.senderName ?? 'Someone'} → ${item.to.map((t) => who(item, t)).join(', ')}`}
          </span>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          {item.kind === 'sms' && item.segments && item.segments > 1 && (
            <span className="text-xs text-fg-subtle">{item.segments} parts</span>
          )}
          <span className="text-xs text-fg-muted">
            <When iso={item.createdAt} />
          </span>
          {item.source && <SourceLink source={item.source} />}
        </div>
        {item.subject && <p className="text-sm font-medium">{item.subject}</p>}
        {item.cc.length > 0 && <p className="text-xs text-fg-muted">CC {item.cc.join(', ')}</p>}
        {item.html ? (
          <div
            className={`email-paper rich-text email-text rounded-md border border-line px-3 py-2 ${long && !expanded ? 'max-h-36 overflow-hidden' : ''}`}
            // Cleaned on the server (email-html.ts): formatting only, no scripts, stylesheets or images.
            dangerouslySetInnerHTML={{ __html: item.html }}
          />
        ) : (
          <p
            className={`text-sm whitespace-pre-wrap text-fg ${long && !expanded ? 'line-clamp-6' : ''}`}
          >
            {item.body}
          </p>
        )}
        {item.files.length > 0 && <SentFiles files={item.files} />}
        {item.attachments > 0 && item.files.length === 0 && (
          <p className="flex items-center gap-1 text-xs text-fg-muted">
            <Paperclip className="size-3.5" aria-hidden />
            {item.attachments === 1 ? '1 attachment' : `${String(item.attachments)} attachments`} —
            open it in Gmail
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          {long && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              {expanded ? 'Show less' : 'Show all'}
            </Button>
          )}
          {onReply && item.kind === 'email' && inbound && !item.fromStaff && from && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onReply({ id: item.id, from, subject: item.subject });
              }}
            >
              <Reply />
              Reply
            </Button>
          )}
        </div>
        {item.error && <p className="text-xs text-danger-text">{item.error}</p>}
      </div>
    </li>
  );
}

function SentFiles({ files }: { files: Item['files'] }) {
  const trpc = useTRPC();
  const download = useMutation(trpc.messaging.attachmentDownload.mutationOptions());
  return (
    <ul aria-label="Attachments" className="flex flex-wrap gap-1.5">
      {files.map((file) => (
        <li key={file.id}>
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-2"
            onClick={() => {
              // Opened first, filled in once the short-lived link arrives (keeps the popup allowed).
              const tab = window.open('', '_blank');
              download
                .mutateAsync({ id: file.id })
                .then(({ url }) => {
                  if (tab) tab.location.href = url;
                  else window.location.href = url;
                })
                .catch(() => tab?.close());
            }}
          >
            <Paperclip className="size-3.5" aria-hidden />
            {file.fileName}
            <span className="text-fg-muted">{formatBytes(file.sizeBytes)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Your saved drafts on this record: continue or delete. */
function Drafts({
  entityType,
  entityId,
  onOpen,
}: {
  entityType: ActivityEntityType;
  entityId: string;
  onOpen: (draft: Draft) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const drafts = useQuery(trpc.messaging.drafts.queryOptions({ entityType, entityId }));
  const remove = useMutation(trpc.messaging.draftDelete.mutationOptions());
  if (!drafts.data?.length) return null;
  return (
    <section aria-label="Your drafts" className="mb-3 flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold text-fg-muted">Your drafts</h3>
      <ul className="flex flex-col gap-1.5">
        {drafts.data.map((draft) => (
          <li
            key={draft.id}
            className="flex items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2 text-sm"
          >
            <FilePen className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{draft.subject || '(no subject)'}</span>
              <span className="block text-xs text-fg-muted">
                {draft.to.join(', ') || 'No recipient yet'} · saved <When iso={draft.updatedAt} />
                {draft.attachments.length > 0 &&
                  ` · ${String(draft.attachments.length)} attachment${draft.attachments.length === 1 ? '' : 's'}`}
              </span>
            </span>
            <Button
              size="sm"
              onClick={() => {
                onOpen(draft);
              }}
            >
              Continue
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete draft ${draft.subject || '(no subject)'}`}
              loading={remove.isPending && remove.variables.id === draft.id}
              onClick={() => {
                remove
                  .mutateAsync({ id: draft.id })
                  .then(() => queryClient.invalidateQueries(trpc.messaging.drafts.pathFilter()))
                  .catch(() => undefined);
              }}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The customer's SMS and emails for a record page, newest first. */
export function MessagesPanel({
  entityType,
  entityId,
}: {
  entityType: ActivityEntityType;
  entityId: string;
}) {
  const trpc = useTRPC();
  const can = useCan();
  const [reply, setReply] = useState<ReplyTo | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const canReply = can(ACTIVITY_ENTITY_FEATURE[entityType], 'edit');
  const query = useQuery({
    ...trpc.messaging.history.queryOptions({ entityType, entityId }),
    // Delivery reports and replies arrive by webhook; pick them up while the tab is open.
    refetchInterval: 30_000,
  });
  if (query.isPending) return <Skeleton className="h-40" />;
  if (query.isError) return <Alert tone="danger">{errorMessage(query.error)}</Alert>;
  return (
    <>
      {canReply && <Drafts entityType={entityType} entityId={entityId} onOpen={setDraft} />}
      {query.data.length === 0 ? (
        <EmptyState
          icon={<MessageSquare />}
          title="No messages yet"
          description="SMS and emails sent with the buttons above — and customers’ replies — show here."
        />
      ) : (
        <ul aria-label="Messages" className="flex flex-col divide-y divide-line">
          {query.data.map((item) => (
            <Message
              key={`${item.kind}-${item.id}`}
              item={item}
              onReply={canReply ? setReply : undefined}
            />
          ))}
        </ul>
      )}
      {draft && (
        <EmailDialog
          target={{ entityType, entityId, phone: null, email: null, name: '' }}
          draft={draft}
          open
          onOpenChange={(open) => {
            if (!open) setDraft(null);
          }}
        />
      )}
      <EmailDialog
        target={{
          entityType,
          entityId,
          phone: null,
          email: reply?.from ?? null,
          name: reply?.from ?? '',
        }}
        reply={reply ?? undefined}
        open={reply !== null}
        onOpenChange={(open) => {
          if (!open) setReply(null);
        }}
      />
    </>
  );
}
