import { TICKET_AGE_LABELS, TICKET_AGES, TICKET_PRIORITIES, ticketAgeDays } from '@mms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { functionalUpdate, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { LifeBuoy, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/PageHeader.tsx';
import { SavedViewsMenu } from '../../components/SavedViewsMenu.tsx';
import { SearchBox } from '../../components/SearchBox.tsx';
import { ViewToggle } from '../../components/ViewToggle.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { formatDate, formatRelative } from '../../lib/format.ts';
import { useBatchedPatch, useCan, useOptions, useUsers } from '../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  cn,
  createDataTableColumns,
  DataTable,
  EmptyState,
  Select,
  Skeleton,
  Tooltip,
  type PaginationState,
  type SortingState,
} from '../../ui/index.ts';
import { ticketsSearchSchema, type TicketsSearch } from '../list-search.ts';
import { ageLabel, priorityTone, ticketStatusTone } from './ticket-labels.ts';
import { TicketBoard } from './TicketBoard.tsx';
import { TicketFormDialog } from './TicketFormDialog.tsx';

type TicketRow = RouterOutputs['tickets']['list']['rows'][number];

const ALL = '__all';

const col = createDataTableColumns<TicketRow>();
// Column ids match the API's sort keys (TICKET_SORTS).
const columns = col.columns([
  col.accessor('ticketNumber', {
    id: 'ticketNumber',
    header: 'Ticket',
    enableHiding: false,
    cell: ({ row }) => (
      <Link
        to="/tickets/$ticketId"
        params={{ ticketId: row.original.id }}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="font-mono text-xs font-medium hover:text-accent-text hover:underline"
      >
        {row.original.ticketNumber}
      </Link>
    ),
  }),
  col.accessor('title', {
    header: 'Problem',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium">{row.original.title}</span>
        {row.original.category && (
          <span className="text-xs text-fg-muted">{row.original.category}</span>
        )}
      </span>
    ),
  }),
  col.accessor('customerName', {
    id: 'customer',
    header: 'Customer',
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span>{row.original.customerName}</span>
        <span className="text-xs text-fg-muted">
          {[row.original.projectNumber, row.original.suburb].filter(Boolean).join(' · ')}
        </span>
      </span>
    ),
  }),
  col.accessor('priority', {
    id: 'priority',
    header: 'Priority',
    cell: (info) => (
      <Badge tone={priorityTone(info.getValue())} dot>
        {info.getValue()}
      </Badge>
    ),
  }),
  col.accessor('resolutionStatus', {
    id: 'status',
    header: 'Status',
    cell: (info) => (
      <Badge tone={ticketStatusTone(info.getValue())} dot>
        {info.getValue()}
      </Badge>
    ),
  }),
  col.accessor('assignedName', {
    header: 'Handler',
    enableSorting: false,
    cell: (info) => {
      const name = info.getValue();
      return name ? (
        <span className="flex items-center gap-2">
          <Avatar name={name} size="sm" />
          {name}
        </span>
      ) : (
        <span className="text-fg-subtle">Unassigned</span>
      );
    },
  }),
  col.accessor('createdAt', {
    id: 'age',
    header: 'Open for',
    cell: ({ row }) => {
      const days = ticketAgeDays(row.original.createdAt, row.original.closedAt);
      return (
        <Tooltip content={`Opened ${formatDate(row.original.createdAt)}`}>
          <span
            tabIndex={0}
            className={cn(
              'tabular-nums',
              days > 30 && !row.original.closedAt && 'text-danger-text',
            )}
          >
            {ageLabel(days)}
          </span>
        </Tooltip>
      );
    },
  }),
  col.accessor('updatedAt', {
    id: 'updatedAt',
    header: 'Updated',
    cell: (info) => <span className="text-fg-muted">{formatRelative(info.getValue())}</span>,
  }),
]);

/** Service tickets (Step 2.8): open work by default, as a table or a board by status. */
export function TicketsPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const can = useCan();
  const search = ticketsSearchSchema.parse(useSearch({ strict: false }));
  const view = search.view ?? 'table';
  const users = useUsers();
  const options = useOptions(['ticketCategories', 'ticketIssueResolutionStatuses']);
  const [creating, setCreating] = useState(false);

  const setSearch = useBatchedPatch<TicketsSearch>((patch) => {
    void navigate({ to: '/tickets', search: { ...search, ...patch }, replace: true });
  });
  const filter = (patch: Partial<TicketsSearch>) => {
    setSearch({ ...patch, page: 0 });
  };

  const filters = {
    search: search.q ?? '',
    state: search.state ?? ('open' as const),
    status: search.status,
    priority: search.priority,
    category: search.category,
    assigned: search.assigned,
    age: search.age,
  };
  const sorting: SortingState = useMemo(
    () => [{ id: search.sort ?? 'ticketNumber', desc: search.desc ?? true }],
    [search.sort, search.desc],
  );
  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: search.page ?? 0, pageSize: search.size ?? 25 }),
    [search.page, search.size],
  );

  const boardOptions = trpc.tickets.board.queryOptions(filters);
  const board = useQuery({
    ...boardOptions,
    enabled: view === 'board',
    placeholderData: keepPreviousData,
  });
  const table = useQuery({
    ...trpc.tickets.list.queryOptions({
      ...filters,
      page: pagination.pageIndex,
      pageSize: pagination.pageSize,
      sort: { id: search.sort ?? 'ticketNumber', desc: search.desc ?? true },
    }),
    enabled: view === 'table',
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => table.data?.rows ?? [], [table.data]);
  const filtered = Boolean(
    search.q ||
    search.state ||
    search.status ||
    search.priority ||
    search.category ||
    search.assigned ||
    search.age,
  );

  const pick = (
    label: string,
    value: string | undefined,
    choices: { value: string; label: string }[],
    onChange: (value: string | undefined) => void,
    width = 'w-40',
    allLabel = 'Any',
  ) => (
    <div className={width}>
      <Select
        aria-label={label}
        value={value ?? ALL}
        onValueChange={(next) => {
          onChange(next === ALL ? undefined : next);
        }}
        options={[{ value: ALL, label: allLabel }, ...choices]}
      />
    </div>
  );

  const toolbar = (
    <>
      <SearchBox
        value={search.q ?? ''}
        onChange={(q) => {
          filter({ q: q || undefined });
        }}
        placeholder="Search ticket, customer, phone"
        label="Search tickets"
      />
      {view === 'table' &&
        pick(
          'Open or closed',
          search.state,
          [
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'Open and closed' },
          ],
          (state) => {
            filter({ state: ticketsSearchSchema.shape.state.parse(state) });
          },
          'w-40',
          'Open',
        )}
      {view === 'table' &&
        pick(
          'Status',
          search.status,
          options.options('ticketIssueResolutionStatuses'),
          (status) => {
            filter({ status });
          },
          'w-52',
          'All statuses',
        )}
      {pick(
        'Priority',
        search.priority,
        TICKET_PRIORITIES.map((p) => ({ value: p, label: p })),
        (priority) => {
          filter({ priority: TICKET_PRIORITIES.find((p) => p === priority) });
        },
        'w-32',
        'Any priority',
      )}
      {pick(
        'Category',
        search.category,
        options.options('ticketCategories'),
        (category) => {
          filter({ category });
        },
        'w-48',
        'All categories',
      )}
      {pick(
        'Handler',
        search.assigned,
        [
          { value: 'me', label: 'Me' },
          { value: 'none', label: 'Unassigned' },
          ...(users.data ?? []).map((user) => ({ value: user.id, label: user.name })),
        ],
        (assigned) => {
          filter({ assigned: ticketsSearchSchema.shape.assigned.parse(assigned) });
        },
        'w-40',
        'Everyone',
      )}
      {pick(
        'Age',
        search.age,
        TICKET_AGES.map((age) => ({ value: age, label: TICKET_AGE_LABELS[age] })),
        (age) => {
          filter({ age: TICKET_AGES.find((a) => a === age) });
        },
        'w-36',
        'Any age',
      )}
      {filtered && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigate({ to: '/tickets', search: { view: search.view }, replace: true });
          }}
        >
          <X />
          Clear
        </Button>
      )}
    </>
  );

  const empty = (
    <EmptyState
      icon={<LifeBuoy />}
      title={filtered ? 'No tickets match' : 'No open tickets'}
      description={
        filtered
          ? 'Try clearing some filters.'
          : 'When a customer reports a problem, open a ticket for it.'
      }
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tickets"
        description="After-sales service and warranty claims."
        actions={
          <>
            <SavedViewsMenu
              page="tickets"
              current={search}
              onApply={(saved) => {
                void navigate({ to: '/tickets', search: ticketsSearchSchema.parse(saved) });
              }}
            />
            <ViewToggle
              view={view}
              onChange={(next) => {
                setSearch({ view: next === 'table' ? undefined : next, page: 0 });
              }}
            />
            {can('tickets', 'create') && (
              <Button
                variant="primary"
                onClick={() => {
                  setCreating(true);
                }}
              >
                <Plus />
                New ticket
              </Button>
            )}
          </>
        }
      />
      {view === 'board' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
          {board.isError ? (
            <Alert tone="danger">{errorMessage(board.error)}</Alert>
          ) : board.isPending ? (
            <div className="flex gap-3 overflow-hidden">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-96 w-72 shrink-0 rounded-xl" />
              ))}
            </div>
          ) : board.data.rows.length === 0 && filtered ? (
            empty
          ) : (
            <TicketBoard board={board.data} queryKey={boardOptions.queryKey} />
          )}
        </>
      ) : (
        <>
          {table.isError && <Alert tone="danger">{errorMessage(table.error)}</Alert>}
          <DataTable
            label="Tickets"
            columns={columns}
            data={rows}
            rowCount={table.data?.total ?? 0}
            getRowId={(row) => row.id}
            sorting={sorting}
            onSortingChange={(updater) => {
              const [next] = functionalUpdate(updater, sorting);
              setSearch({
                sort: ticketsSearchSchema.shape.sort.parse(next?.id),
                desc: next?.desc,
                page: 0,
              });
            }}
            pagination={pagination}
            onPaginationChange={(updater) => {
              const next = functionalUpdate(updater, pagination);
              setSearch({ page: next.pageIndex, size: next.pageSize });
            }}
            initialColumnVisibility={{ updatedAt: false }}
            isLoading={table.isPending}
            isFetching={table.isFetching && table.isPlaceholderData}
            onRowClick={(row) => {
              void navigate({ to: '/tickets/$ticketId', params: { ticketId: row.id } });
            }}
            toolbar={toolbar}
            empty={empty}
          />
        </>
      )}
      <TicketFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(id) => {
          void navigate({ to: '/tickets/$ticketId', params: { ticketId: id } });
        }}
      />
    </div>
  );
}
