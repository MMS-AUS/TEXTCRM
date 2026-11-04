import { formatPhone, LEAD_CONVERTED, LEAD_LOST, LEAD_PIPELINE } from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  ArchiveRestore,
  ArrowLeft,
  Check,
  History,
  MapPin,
  Paperclip,
  Pencil,
  StickyNote,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { ActivityTimeline } from '../../components/ActivityTimeline.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DetailList } from '../../components/DetailList.tsx';
import { FilesPanel } from '../../components/FilesPanel.tsx';
import { HistoryList } from '../../components/HistoryList.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { formatDate, fullName } from '../../lib/format.ts';
import { useCan, useUsers } from '../../lib/hooks.ts';
import { trpcErrorCode, useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  focusRing,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '../../ui/index.ts';
import { LeadFormDrawer } from './LeadFormDrawer.tsx';
import { ConvertedNotice, ConvertToProjectButton } from './ConvertToProject.tsx';
import { PricingCard, SystemCard } from './LeadQuoteCards.tsx';
import { statusTone } from './lead-status.ts';

type Lead = RouterOutputs['leads']['get'];

const LEAD_FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  mobile: 'Mobile',
  secondaryMobile: 'Other phone',
  streetAddress: 'Street',
  suburb: 'Suburb',
  state: 'State',
  postcode: 'Postcode',
  area: 'Area',
  nearestBigCity: 'Nearest city',
  platform: 'Platform',
  source: 'Source',
  status: 'Status',
  ownerUserId: 'Sales person',
  leadDate: 'Lead date',
  notes: 'Notes',
  contactId: 'Contact',
};

const UNASSIGNED = '__none';

function BackLink() {
  return (
    <Link
      to="/leads"
      className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
    >
      <ArrowLeft className="size-4" />
      Leads
    </Link>
  );
}

/** New → … → Deposit Received as clickable steps; Lost and Converted shown as end states. */
function StatusPipeline({
  status,
  editable,
  pending,
  onChange,
}: {
  status: string;
  editable: boolean;
  pending: boolean;
  onChange: (status: string) => void;
}) {
  const current = LEAD_PIPELINE.findIndex((step) => step === status);
  const ended = status === LEAD_LOST || status === LEAD_CONVERTED;
  return (
    <div className="flex flex-col gap-2">
      <ol
        aria-label="Lead status"
        className="flex overflow-x-auto rounded-lg border border-line bg-surface p-1"
      >
        {LEAD_PIPELINE.map((step, index) => {
          const done = current >= 0 && index < current;
          const active = index === current;
          return (
            <li key={step} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={!editable || pending || status === LEAD_CONVERTED || active}
                aria-current={active ? 'step' : undefined}
                onClick={() => {
                  onChange(step);
                }}
                className={cn(
                  'flex h-8 w-full min-w-28 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors',
                  'enabled:cursor-pointer enabled:hover:bg-surface-2 disabled:cursor-default',
                  done && 'text-fg',
                  !done && !active && 'text-fg-subtle',
                  active && 'bg-accent text-accent-fg',
                  ended && 'opacity-60',
                  focusRing,
                )}
              >
                {done && <Check className="size-3.5 text-success" />}
                {step}
              </button>
            </li>
          );
        })}
      </ol>
      {ended && (
        <p className="text-sm">
          <Badge tone={statusTone(status)} dot>
            {status}
          </Badge>
          {status === LEAD_LOST && editable && (
            <span className="ml-2 text-fg-muted">Pick a step above to reopen this lead.</span>
          )}
        </p>
      )}
    </div>
  );
}

function LeadView({ lead }: { lead: Lead }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const users = useUsers();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const setStatus = useMutation(trpc.leads.setStatus.mutationOptions());
  const assign = useMutation(trpc.leads.assign.mutationOptions());
  const remove = useMutation(trpc.leads.remove.mutationOptions());
  const restore = useMutation(trpc.leads.restore.mutationOptions());

  const deleted = lead.deletedAt !== null;
  const editable = can('leads', 'edit') && !deleted;
  const name = fullName(lead);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.leads.pathFilter()),
      queryClient.invalidateQueries(trpc.activities.pathFilter()),
    ]);
  const run = (action: Promise<unknown>, success: string) =>
    action
      .then(refresh)
      .then(() => {
        toast({ title: success, tone: 'success' });
      })
      .catch((error: unknown) => {
        toast({ title: 'Nothing was changed', description: errorMessage(error), tone: 'danger' });
      });

  const address = [
    lead.streetAddress,
    [lead.suburb, lead.state, lead.postcode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
              {lead.mobile && (
                <a href={`tel:${lead.mobile}`} className="hover:text-accent-text hover:underline">
                  {formatPhone(lead.mobile)}
                </a>
              )}
              {lead.suburb && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {[lead.suburb, lead.state].filter(Boolean).join(', ')}
                </span>
              )}
              {lead.platform && <span>via {lead.platform}</span>}
              <span>Lead {formatDate(lead.leadDate)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48">
              <Select
                aria-label="Sales person"
                disabled={!editable || assign.isPending}
                value={lead.ownerUserId ?? UNASSIGNED}
                onValueChange={(value) => {
                  const ownerUserId = value === UNASSIGNED ? null : value;
                  void run(
                    assign.mutateAsync({ id: lead.id, ownerUserId }),
                    ownerUserId ? 'Lead assigned' : 'Lead unassigned',
                  );
                }}
                options={[
                  { value: UNASSIGNED, label: 'Unassigned' },
                  ...(users.data ?? []).map((user) => ({ value: user.id, label: user.name })),
                ]}
              />
            </div>
            {editable && (
              <Button
                onClick={() => {
                  setEditing(true);
                }}
              >
                <Pencil />
                Edit
              </Button>
            )}
            {editable && lead.status !== LEAD_LOST && lead.status !== LEAD_CONVERTED && (
              <Button
                variant="ghost"
                loading={setStatus.isPending}
                onClick={() =>
                  void run(
                    setStatus.mutateAsync({ id: lead.id, status: LEAD_LOST }),
                    'Marked as lost',
                  )
                }
              >
                <XCircle />
                Lost
              </Button>
            )}
            {can('leads', 'delete') &&
              lead.status !== LEAD_CONVERTED &&
              (deleted ? (
                <Button
                  loading={restore.isPending}
                  onClick={() => void run(restore.mutateAsync({ id: lead.id }), 'Lead restored')}
                >
                  <ArchiveRestore />
                  Restore
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDeleting(true);
                  }}
                >
                  <Trash2 />
                  Delete
                </Button>
              ))}
            {editable && !lead.project && lead.status !== LEAD_LOST && (
              <ConvertToProjectButton leadId={lead.id} />
            )}
          </div>
        </div>
        <StatusPipeline
          status={lead.status}
          editable={editable}
          pending={setStatus.isPending}
          onChange={(status) =>
            void run(setStatus.mutateAsync({ id: lead.id, status }), `Moved to ${status}`)
          }
        />
      </div>

      {lead.project && <ConvertedNotice project={lead.project} />}

      {deleted && (
        <Alert tone="warning" title="This lead is deleted">
          It's hidden from the leads list and can't be changed. Restore it to work on it again.
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer & property</CardTitle>
            </CardHeader>
            <CardContent className="py-1">
              <DetailList
                items={[
                  {
                    label: 'Mobile',
                    value: lead.mobile && (
                      <a
                        href={`tel:${lead.mobile}`}
                        className="hover:text-accent-text hover:underline"
                      >
                        {formatPhone(lead.mobile)}
                      </a>
                    ),
                  },
                  { label: 'Other phone', value: formatPhone(lead.secondaryMobile) },
                  {
                    label: 'Email',
                    value: lead.email && (
                      <a
                        href={`mailto:${lead.email}`}
                        className="hover:text-accent-text hover:underline"
                      >
                        {lead.email}
                      </a>
                    ),
                  },
                  {
                    label: 'Address',
                    value: address && (
                      <span className="flex flex-col gap-1.5">
                        {address}
                        {(lead.area ?? lead.nearestBigCity) && (
                          <span className="flex flex-wrap gap-1.5">
                            {lead.area && <Badge>{lead.area}</Badge>}
                            {lead.nearestBigCity && <Badge>Near {lead.nearestBigCity}</Badge>}
                          </span>
                        )}
                      </span>
                    ),
                  },
                  {
                    label: 'Contact',
                    value: lead.contactId && (
                      <Link
                        to="/contacts/$contactId"
                        params={{ contactId: lead.contactId }}
                        className="hover:text-accent-text hover:underline"
                      >
                        {lead.contactName}
                      </Link>
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Lead</CardTitle>
            </CardHeader>
            <CardContent className="py-1">
              <DetailList
                items={[
                  { label: 'Platform', value: lead.platform },
                  { label: 'Source', value: lead.source },
                  { label: 'Lead date', value: formatDate(lead.leadDate) },
                  { label: 'Sales person', value: lead.ownerName ?? 'Unassigned' },
                  {
                    label: 'Created',
                    value: `${formatDate(lead.createdAt)}${
                      lead.createdByName
                        ? ` by ${lead.createdByName}`
                        : lead.sheetSourceId
                          ? ' from the live sheet'
                          : ''
                    }`,
                  },
                  ...(lead.sheetSourceId && lead.sheetLeadId
                    ? [{ label: 'Live sheet', value: sheetOwnership(lead) }]
                    : []),
                ]}
              />
              {lead.notes && (
                <div className="border-t border-line py-3 text-sm">
                  <p className="text-fg-muted">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap">{lead.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
          {lead.otherLeads.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Other leads from {lead.contactName ?? 'this person'}</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                <ul className="flex flex-col divide-y divide-line">
                  {lead.otherLeads.map((other) => (
                    <li
                      key={other.id}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm"
                    >
                      <Link
                        to="/leads/$leadId"
                        params={{ leadId: other.id }}
                        className="min-w-0 truncate hover:text-accent-text hover:underline"
                      >
                        {[other.suburb, other.state].filter(Boolean).join(', ') || 'No address'} ·{' '}
                        {formatDate(other.leadDate)}
                      </Link>
                      <Badge tone={statusTone(other.status)} dot>
                        {other.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <SystemCard lead={lead} editable={editable} />
            <PricingCard lead={lead} editable={editable} />
          </div>
          <Card>
            <CardContent>
              <Tabs defaultValue="activity">
                <TabsList>
                  <TabsTrigger value="activity">
                    <StickyNote />
                    Activity
                    {lead.openTasks > 0 && (
                      <Badge tone="accent" className="ml-1">
                        {lead.openTasks} open
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="files">
                    <Paperclip />
                    Files
                  </TabsTrigger>
                  <TabsTrigger value="history">
                    <History />
                    History
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="activity">
                  <ActivityTimeline entityType="lead" entityId={lead.id} readOnly={deleted} />
                </TabsContent>
                <TabsContent value="files">
                  <FilesPanel entityType="lead" entityId={lead.id} readOnly={deleted} />
                </TabsContent>
                <TabsContent value="history">
                  <HistoryList entries={lead.history} labels={LEAD_FIELD_LABELS} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      <LeadFormDrawer open={editing} onOpenChange={setEditing} lead={lead} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${name}?`}
        description="The lead is hidden from the list. Its timeline and history are kept, and it can be restored."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync({ id: lead.id });
          await refresh();
          toast({ title: 'Lead deleted' });
        }}
      />
    </div>
  );
}

/** Whether the live sheet still updates this lead (§1.8 "the Sheet creates, the CRM owns after"). */
function sheetOwnership(lead: {
  sheetLeadId: string | null;
  crmEditedAt: string | null;
  createdByUserId: string | null;
}) {
  const id = `Lead ID ${lead.sheetLeadId ?? ''}`;
  if (lead.createdByUserId) return `${id} · linked; the CRM owns this lead`;
  if (lead.crmEditedAt) {
    return `${id} · edited in the CRM ${formatDate(lead.crmEditedAt)}, so the sheet no longer changes it`;
  }
  return `${id} · corrections in the sheet still update it until someone edits it here`;
}

export function LeadDetailPage() {
  const trpc = useTRPC();
  const { leadId = '' } = useParams({ strict: false });
  const query = useQuery(trpc.leads.get.queryOptions({ id: leadId }));

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <BackLink />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-80" />
          <Skeleton className="h-80 lg:col-span-2" />
        </div>
      </div>
    );
  }
  if (query.isError) {
    const code = trpcErrorCode(query.error);
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        {code === 'NOT_FOUND' || code === 'BAD_REQUEST' ? (
          <Card>
            <EmptyState
              icon={<Zap />}
              title="Lead not found"
              description="It may have been mistyped in the address bar."
            />
          </Card>
        ) : (
          <Alert tone="danger">{errorMessage(query.error)}</Alert>
        )}
      </div>
    );
  }
  return <LeadView lead={query.data} />;
}
