import { formatAud, formatPhone, TICKET_PRIORITIES, ticketAgeDays } from '@mms/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, LifeBuoy, Mail, Paperclip, Pencil, Phone, StickyNote } from 'lucide-react';
import { useState } from 'react';
import { ActivityTimeline } from '../../components/ActivityTimeline.tsx';
import { DetailList } from '../../components/DetailList.tsx';
import { FilesPanel } from '../../components/FilesPanel.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { formatDate, fullName } from '../../lib/format.ts';
import { useCan } from '../../lib/hooks.ts';
import { trpcErrorCode, useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../ui/index.ts';
import { ageLabel, priorityTone, ticketStatusTone } from './ticket-labels.ts';
import { TicketFormDialog } from './TicketFormDialog.tsx';
import {
  HardwareCard,
  InstallerVisitsCard,
  TriageCard,
  WarrantyClaimsCard,
} from './TicketPanels.tsx';

type Ticket = RouterOutputs['tickets']['get'];

function BackLink() {
  return (
    <Link
      to="/tickets"
      className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
    >
      <ArrowLeft className="size-4" />
      Tickets
    </Link>
  );
}

function DetailsCard({ ticket, editable }: { ticket: Ticket; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const can = useCan();
  const contact = ticket.contact;
  const age = ticketAgeDays(ticket.createdAt, ticket.closedAt);
  return (
    <Card>
      <CardHeader
        actions={
          editable && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(true);
              }}
            >
              <Pencil />
              Edit
            </Button>
          )
        }
      >
        <CardTitle>Ticket</CardTitle>
      </CardHeader>
      <CardContent className="py-1">
        <DetailList
          items={[
            {
              label: 'Customer',
              value: contact ? (
                can('contacts', 'view') ? (
                  <Link
                    to="/contacts/$contactId"
                    params={{ contactId: contact.id }}
                    className="hover:underline"
                  >
                    {fullName(contact)}
                  </Link>
                ) : (
                  fullName(contact)
                )
              ) : null,
            },
            {
              label: 'Contact',
              value: contact && (contact.mobile ?? contact.email) && (
                <span className="flex flex-col gap-0.5">
                  {contact.mobile && (
                    <a
                      href={`tel:${contact.mobile}`}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <Phone className="size-3.5 text-fg-muted" />
                      {formatPhone(contact.mobile)}
                    </a>
                  )}
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <Mail className="size-3.5 text-fg-muted" />
                      {contact.email}
                    </a>
                  )}
                </span>
              ),
            },
            {
              label: 'Project',
              value: ticket.project && (
                <span className="flex flex-col">
                  {can('projects', 'view') ? (
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: ticket.project.id }}
                      className="font-mono text-xs hover:underline"
                    >
                      {ticket.project.projectNumber}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{ticket.project.projectNumber}</span>
                  )}
                  <span className="text-fg-muted">
                    {ticket.project.streetAddress}, {ticket.project.suburb} {ticket.project.state}
                  </span>
                </span>
              ),
            },
            { label: 'Category', value: ticket.category },
            { label: 'Handler', value: ticket.assignedName ?? 'Unassigned' },
            {
              label: 'Details',
              value: ticket.description && (
                <span className="whitespace-pre-wrap">{ticket.description}</span>
              ),
            },
            {
              label: 'Opened',
              value: `${formatDate(ticket.createdAt)}${ticket.createdByName ? ` by ${ticket.createdByName}` : ''}`,
            },
            {
              label: ticket.closedAt ? 'Was open' : 'Open for',
              value: ageLabel(age),
            },
            {
              label: 'Service charge',
              value: ticket.serviceChargeAud && formatAud(ticket.serviceChargeAud),
            },
          ]}
        />
      </CardContent>
      <TicketFormDialog
        open={editing}
        onOpenChange={setEditing}
        ticket={{
          id: ticket.id,
          contactId: ticket.contactId,
          contactName: contact ? fullName(contact) : null,
          projectId: ticket.projectId,
          title: ticket.title,
          description: ticket.description,
          category: ticket.category,
          priority: TICKET_PRIORITIES.find((p) => p === ticket.priority) ?? 'Medium',
          assignedUserId: ticket.assignedUserId,
        }}
      />
    </Card>
  );
}

function TicketView({ ticket }: { ticket: Ticket }) {
  const editable = useCan()('tickets', 'edit');
  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-sm text-fg-subtle">{ticket.ticketNumber}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{ticket.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={priorityTone(ticket.priority)} dot>
              {ticket.priority} priority
            </Badge>
            <Badge tone={ticketStatusTone(ticket.resolutionStatus)} dot>
              {ticket.resolutionStatus}
            </Badge>
            {ticket.closedAt && <Badge>Closed {formatDate(ticket.closedAt)}</Badge>}
          </div>
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6">
          <DetailsCard ticket={ticket} editable={editable} />
          <TriageCard ticket={ticket} editable={editable} />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-2">
          <HardwareCard ticket={ticket} editable={editable} />
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <WarrantyClaimsCard ticket={ticket} editable={editable} />
            <InstallerVisitsCard ticket={ticket} editable={editable} />
          </div>
          <Tabs defaultValue="activity">
            <TabsList>
              <TabsTrigger value="activity">
                <StickyNote />
                Activity
              </TabsTrigger>
              <TabsTrigger value="files">
                <Paperclip />
                Files
              </TabsTrigger>
            </TabsList>
            <TabsContent value="activity">
              <Card>
                <CardContent>
                  <ActivityTimeline entityType="ticket" entityId={ticket.id} />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="files">
              <Card>
                <CardContent>
                  <FilesPanel entityType="ticket" entityId={ticket.id} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

/** One service ticket: details, triage, hardware, warranty claims, visits, timeline, files. */
export function TicketDetailPage() {
  const trpc = useTRPC();
  const { ticketId = '' } = useParams({ strict: false });
  const query = useQuery(trpc.tickets.get.queryOptions({ id: ticketId }));
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <BackLink />
        <Skeleton className="h-8 w-80" />
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
              icon={<LifeBuoy />}
              title="Ticket not found"
              description="It may have been mistyped in the address bar."
            />
          </Card>
        ) : (
          <Alert tone="danger">{errorMessage(query.error)}</Alert>
        )}
      </div>
    );
  }
  return <TicketView ticket={query.data} />;
}
