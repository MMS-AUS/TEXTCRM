import { ticketAgeDays } from '@mms/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../lib/errors.ts';
import { useCan } from '../../lib/hooks.ts';
import { useTRPC } from '../../lib/trpc.ts';
import { Alert, Badge, Button, Skeleton } from '../../ui/index.ts';
import { ageLabel, priorityTone, ticketStatusTone } from './ticket-labels.ts';
import { TicketFormDialog } from './TicketFormDialog.tsx';

/** A contact's or project's service tickets (open and closed), with "New ticket". */
export function RecordTickets({
  contactId,
  contactName,
  projectId,
}: {
  contactId: string;
  contactName: string;
  projectId?: string;
}) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const query = useQuery(
    trpc.tickets.list.queryOptions({
      state: 'all',
      ...(projectId ? { projectId } : { contactId }),
      pageSize: 50,
    }),
  );
  return (
    <div className="flex flex-col gap-3">
      {can('tickets', 'create') && (
        <div>
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus />
            New ticket
          </Button>
        </div>
      )}
      {query.isPending ? (
        <Skeleton className="h-20" />
      ) : query.isError ? (
        <Alert tone="danger">{errorMessage(query.error)}</Alert>
      ) : query.data.rows.length === 0 ? (
        <p className="py-3 text-sm text-fg-muted">No service tickets.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line" aria-label="Service tickets">
          {query.data.rows.map((ticket) => (
            <li
              key={ticket.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
            >
              <span className="min-w-0">
                <Link
                  to="/tickets/$ticketId"
                  params={{ ticketId: ticket.id }}
                  className="font-medium hover:underline"
                >
                  <span className="font-mono text-xs text-fg-subtle">{ticket.ticketNumber}</span>{' '}
                  {ticket.title}
                </Link>
                <span className="block text-xs text-fg-muted">
                  {ticket.closedAt
                    ? 'Closed'
                    : `Open ${ageLabel(ticketAgeDays(ticket.createdAt, null))}`}
                  {ticket.assignedName ? ` · ${ticket.assignedName}` : ''}
                </span>
              </span>
              <span className="flex gap-1.5">
                <Badge tone={priorityTone(ticket.priority)} dot>
                  {ticket.priority}
                </Badge>
                <Badge tone={ticketStatusTone(ticket.resolutionStatus)} dot>
                  {ticket.resolutionStatus}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
      <TicketFormDialog
        open={creating}
        onOpenChange={setCreating}
        ticket={{ contactId, contactName, projectId: projectId ?? null }}
        onSaved={(id) => {
          void navigate({ to: '/tickets/$ticketId', params: { ticketId: id } });
        }}
      />
    </div>
  );
}
