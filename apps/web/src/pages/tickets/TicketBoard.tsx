import { isTicketClosed, ticketAgeDays } from '@mms/shared';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { errorMessage } from '../../lib/errors.ts';
import { useCan, useOptions } from '../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Avatar,
  Badge,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  toast,
  Tooltip,
} from '../../ui/index.ts';
import { ageLabel, priorityTone } from './ticket-labels.ts';

type Board = RouterOutputs['tickets']['board'];
type Card = Board['rows'][number];

const DRAG_TYPE = 'application/x-mms-ticket';

function TicketCard({
  card,
  statuses,
  closing,
  canMove,
  onMove,
  onDragStart,
}: {
  card: Card;
  statuses: string[];
  closing: string[];
  canMove: boolean;
  onMove: (status: string) => void;
  onDragStart: (event: DragEvent) => void;
}) {
  const age = ticketAgeDays(card.createdAt, card.closedAt);
  return (
    <li
      draggable={canMove}
      onDragStart={onDragStart}
      className={cn(
        'rounded-lg border border-line bg-surface p-3 text-sm shadow-xs transition-shadow hover:shadow-sm',
        canMove && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-fg-subtle">{card.ticketNumber}</p>
          <Link
            to="/tickets/$ticketId"
            params={{ ticketId: card.id }}
            className="block truncate font-medium hover:text-accent-text hover:underline"
          >
            {card.title}
          </Link>
          <p className="truncate text-fg-muted">
            {card.customerName}
            {card.suburb ? ` · ${card.suburb}` : ''}
          </p>
        </div>
        {canMove && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" label={`Move ${card.ticketNumber}`}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Move to…</DropdownMenuLabel>
              {statuses
                .filter((status) => status !== card.resolutionStatus)
                .map((status) => (
                  <DropdownMenuItem
                    key={status}
                    onSelect={() => {
                      onMove(status);
                    }}
                  >
                    {status}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Close as…</DropdownMenuLabel>
              {closing.map((status) => (
                <DropdownMenuItem
                  key={status}
                  onSelect={() => {
                    onMove(status);
                  }}
                >
                  {status}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone={priorityTone(card.priority)} dot>
          {card.priority}
        </Badge>
        {card.category && <Badge>{card.category}</Badge>}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-fg-muted">
        <span className={cn(age > 30 && 'font-medium text-danger-text')}>Open {ageLabel(age)}</span>
        {card.assignedName ? (
          <Tooltip content={card.assignedName}>
            <span tabIndex={0}>
              <Avatar name={card.assignedName} size="sm" />
            </span>
          </Tooltip>
        ) : (
          <span>Unassigned</span>
        )}
      </div>
    </li>
  );
}

/** Open tickets by resolution status. Drag a card (or use its menu) to move it on. */
export function TicketBoard({ board, queryKey }: { board: Board; queryKey: QueryKey }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canMove = useCan()('tickets', 'edit');
  const setStatus = useMutation(trpc.tickets.setStatus.mutationOptions());
  const options = useOptions(['ticketIssueResolutionStatuses']);
  const [over, setOver] = useState<string | null>(null);

  const all = options.options('ticketIssueResolutionStatuses').map((o) => o.value);
  const open = all.filter((status) => !isTicketClosed(status));
  const closing = all.filter((status) => isTicketClosed(status));
  // A status archived since a ticket got it still gets a column while tickets use it.
  for (const row of board.rows) {
    if (!open.includes(row.resolutionStatus)) open.push(row.resolutionStatus);
  }

  const move = async (card: Card, status: string) => {
    if (card.resolutionStatus === status) return;
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData<Board>(queryKey);
    queryClient.setQueryData<Board>(
      queryKey,
      (old) =>
        old && {
          ...old,
          rows: isTicketClosed(status)
            ? old.rows.filter((row) => row.id !== card.id)
            : old.rows.map((row) =>
                row.id === card.id ? { ...row, resolutionStatus: status } : row,
              ),
        },
    );
    try {
      await setStatus.mutateAsync({ id: card.id, status });
      toast({
        title: isTicketClosed(status)
          ? `${card.ticketNumber} closed`
          : `${card.ticketNumber} moved to ${status}`,
        tone: 'success',
      });
    } catch (error) {
      queryClient.setQueryData(queryKey, previous);
      toast({
        title: "Couldn't move the ticket",
        description: errorMessage(error),
        tone: 'danger',
      });
    } finally {
      await queryClient.invalidateQueries(trpc.tickets.pathFilter());
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {board.truncated && (
        <p className="text-sm text-warning-text">
          Showing the first 500 open tickets. Narrow the filters to see the rest.
        </p>
      )}
      <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <ol aria-label="Ticket statuses" className="flex min-w-max gap-3">
          {open.map((status) => {
            const cards = board.rows.filter((row) => row.resolutionStatus === status);
            return (
              <li
                key={status}
                aria-label={`${status}: ${String(cards.length)} tickets`}
                onDragOver={(event) => {
                  if (!canMove || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
                  event.preventDefault();
                  setOver(status);
                }}
                onDragLeave={() => {
                  setOver((current) => (current === status ? null : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setOver(null);
                  const card = board.rows.find(
                    (row) => row.id === event.dataTransfer.getData(DRAG_TYPE),
                  );
                  if (card) void move(card, status);
                }}
                className={cn(
                  'flex max-h-[calc(100dvh-17rem)] w-72 shrink-0 flex-col rounded-xl border border-line bg-surface-2/60 transition-colors',
                  over === status && 'border-accent bg-accent-subtle',
                )}
              >
                <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                  <h2 className="truncate text-sm font-semibold" title={status}>
                    {status}
                  </h2>
                  <span className="rounded-full bg-surface px-2 text-xs font-medium tabular-nums text-fg-muted inset-ring inset-ring-line">
                    {cards.length}
                  </span>
                </div>
                <ul className="flex min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {cards.map((card) => (
                    <TicketCard
                      key={card.id}
                      card={card}
                      statuses={open}
                      closing={closing}
                      canMove={canMove}
                      onMove={(next) => void move(card, next)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(DRAG_TYPE, card.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                    />
                  ))}
                  {cards.length === 0 && (
                    <li className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-fg-subtle">
                      No tickets
                    </li>
                  )}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
