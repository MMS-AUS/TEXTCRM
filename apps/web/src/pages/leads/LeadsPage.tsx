import { AU_STATES, businessToday, formatPhone } from '@mms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { functionalUpdate, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Plus, X, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/PageHeader.tsx';
import { SavedViewsMenu } from '../../components/SavedViewsMenu.tsx';
import { SearchBox } from '../../components/SearchBox.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { formatDate, formatRelative, fullName } from '../../lib/format.ts';
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
  DateInput,
  EmptyState,
  focusRing,
  Select,
  Tooltip,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from '../../ui/index.ts';
import { leadsSearchSchema, type LeadsSearch } from '../list-search.ts';
import { BulkActions } from './BulkActions.tsx';
import { LeadFormDrawer } from './LeadFormDrawer.tsx';
import { LEAD_STATUSES, startOfWeek, statusTone } from './lead-status.ts';

type LeadRow = RouterOutputs['leads']['list']['rows'][number];

const dash = <span className="text-fg-subtle">—</span>;
const ALL = '__all';
const count = new Intl.NumberFormat('en-AU');

const col = createDataTableColumns<LeadRow>();
// Column ids match the API's sort keys (LEAD_SORTS).
const columns = col.columns([
  col.accessor('firstName', {
    id: 'name',
    header: 'Name',
    enableHiding: false,
    cell: ({ row }) => (
      <Link
        to="/leads/$leadId"
        params={{ leadId: row.original.id }}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="font-medium hover:text-accent-text hover:underline"
      >
        {fullName(row.original)}
      </Link>
    ),
  }),
  col.accessor('status', {
    id: 'status',
    header: 'Status',
    cell: (info) => (
      <Badge tone={statusTone(info.getValue())} dot>
        {info.getValue()}
      </Badge>
    ),
  }),
  col.accessor('mobile', {
    header: 'Mobile',
    enableSorting: false,
    meta: { className: 'tabular-nums' },
    cell: (info) => formatPhone(info.getValue()) || dash,
  }),
  col.accessor('suburb', {
    id: 'location',
    header: 'Location',
    cell: ({ row }) =>
      row.original.suburb || row.original.state ? (
        <span className="text-fg-muted">
          {[row.original.suburb, row.original.state].filter(Boolean).join(', ')}
        </span>
      ) : (
        dash
      ),
  }),
  col.accessor('source', {
    id: 'source',
    header: 'Lead source',
    cell: (info) => <span className="text-fg-muted">{info.getValue() ?? dash}</span>,
  }),
  col.accessor('ownerName', {
    id: 'owner',
    header: 'Sales person',
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
  col.accessor('leadDate', {
    id: 'leadDate',
    header: 'Lead date',
    meta: { className: 'tabular-nums' },
    cell: (info) => <span className="text-fg-muted">{formatDate(info.getValue())}</span>,
  }),
  col.accessor('updatedAt', {
    id: 'updatedAt',
    header: 'Updated',
    cell: (info) => (
      <Tooltip content={formatDate(info.getValue())}>
        <span className="text-fg-muted" tabIndex={0}>
          {formatRelative(info.getValue())}
        </span>
      </Tooltip>
    ),
  }),
]);

/** "All" plus one pill per status, each with its count for the other active filters. */
function StatusPills({
  counts,
  selected,
  onSelect,
}: {
  counts: Record<string, number> | undefined;
  selected: string[];
  onSelect: (statuses: string[]) => void;
}) {
  const total = Object.values(counts ?? {}).reduce((sum, n) => sum + n, 0);
  const pills = [
    { label: 'All', value: null, n: total },
    ...LEAD_STATUSES.map((status) => ({ label: status, value: status, n: counts?.[status] ?? 0 })),
  ];
  return (
    <div role="group" aria-label="Status" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {pills.map((pill) => {
        const active =
          pill.value === null
            ? selected.length === 0
            : selected.length === 1 && selected[0] === pill.value;
        return (
          <button
            key={pill.label}
            type="button"
            aria-pressed={active}
            onClick={() => {
              onSelect(pill.value === null ? [] : [pill.value]);
            }}
            className={cn(
              'flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm whitespace-nowrap text-fg-muted transition-colors hover:border-line-strong hover:text-fg',
              'aria-pressed:border-accent aria-pressed:bg-accent-subtle aria-pressed:text-accent-text',
              focusRing,
            )}
          >
            {pill.value && (
              <span
                aria-hidden
                className={cn('size-1.5 rounded-full', {
                  'bg-info': statusTone(pill.value) === 'info',
                  'bg-accent': statusTone(pill.value) === 'accent',
                  'bg-warning': statusTone(pill.value) === 'warning',
                  'bg-success': statusTone(pill.value) === 'success',
                  'bg-fg-subtle': statusTone(pill.value) === 'neutral',
                })}
              />
            )}
            {pill.label}
            <span className="text-xs tabular-nums opacity-70">{count.format(pill.n)}</span>
          </button>
        );
      })}
    </div>
  );
}

function QuickFilter({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'primary' : 'secondary'}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function LeadsPage() {
  const trpc = useTRPC();
  const can = useCan();
  const navigate = useNavigate();
  const search = leadsSearchSchema.parse(useSearch({ strict: false }));
  const [creating, setCreating] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const options = useOptions(['leadSources']);
  const users = useUsers();

  const setSearch = useBatchedPatch<LeadsSearch>((patch) => {
    void navigate({ to: '/leads', search: { ...search, ...patch }, replace: true });
  });
  /** Any filter change goes back to page 1. */
  const filter = (patch: Partial<LeadsSearch>) => {
    setSearch({ ...patch, page: 0 });
  };

  const sorting: SortingState = useMemo(
    () => [{ id: search.sort ?? 'leadDate', desc: search.desc ?? true }],
    [search.sort, search.desc],
  );
  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: search.page ?? 0, pageSize: search.size ?? 25 }),
    [search.page, search.size],
  );

  const filters = {
    search: search.q ?? '',
    statuses: search.status ?? [],
    source: search.source,
    owner: search.owner,
    state: search.state,
    dateFrom: search.from,
    dateTo: search.to,
    deleted: search.deleted ?? false,
  };
  const query = useQuery({
    ...trpc.leads.list.queryOptions({
      ...filters,
      page: pagination.pageIndex,
      pageSize: pagination.pageSize,
      sort: { id: search.sort ?? 'leadDate', desc: search.desc ?? true },
    }),
    placeholderData: keepPreviousData,
  });
  const counts = useQuery({
    ...trpc.leads.statusCounts.queryOptions(filters),
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const weekStart = startOfWeek(businessToday());
  const filtered = Boolean(
    search.q ||
    search.status?.length ||
    search.source ||
    search.owner ||
    search.state ||
    search.from ||
    search.to ||
    search.deleted,
  );
  const selectedIds = Object.keys(rowSelection);
  const newLeadButton = can('leads', 'create') && (
    <Button
      variant="primary"
      onClick={() => {
        setCreating(true);
      }}
    >
      <Plus />
      New lead
    </Button>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Leads"
        description="Every enquiry, from first contact to deposit."
        actions={
          <>
            <SavedViewsMenu
              page="leads"
              current={search}
              onApply={(saved) => {
                void navigate({ to: '/leads', search: leadsSearchSchema.parse(saved) });
              }}
            />
            {newLeadButton}
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <QuickFilter
            active={search.owner === 'me'}
            onClick={() => {
              filter({ owner: search.owner === 'me' ? undefined : 'me' });
            }}
          >
            My leads
          </QuickFilter>
          <QuickFilter
            active={search.owner === 'none'}
            onClick={() => {
              filter({ owner: search.owner === 'none' ? undefined : 'none' });
            }}
          >
            Unassigned
          </QuickFilter>
          <QuickFilter
            active={search.from === weekStart && !search.to}
            onClick={() => {
              const on = search.from === weekStart && !search.to;
              filter({ from: on ? undefined : weekStart, to: undefined });
            }}
          >
            New this week
          </QuickFilter>
          {filtered && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigate({ to: '/leads', search: {}, replace: true });
              }}
            >
              <X />
              Clear filters
            </Button>
          )}
        </div>
        <StatusPills
          counts={counts.data}
          selected={search.status ?? []}
          onSelect={(statuses) => {
            filter({ status: statuses.length ? statuses : undefined });
          }}
        />
      </div>

      {query.isError && <Alert tone="danger">{errorMessage(query.error)}</Alert>}
      <DataTable
        label="Leads"
        columns={columns}
        data={rows}
        rowCount={query.data?.total ?? 0}
        getRowId={(row) => row.id}
        sorting={sorting}
        onSortingChange={(updater) => {
          const [next] = functionalUpdate(updater, sorting);
          setSearch({
            sort: leadsSearchSchema.shape.sort.parse(next?.id),
            desc: next?.desc,
            page: 0,
          });
        }}
        pagination={pagination}
        onPaginationChange={(updater) => {
          const next = functionalUpdate(updater, pagination);
          setSearch({ page: next.pageIndex, size: next.pageSize });
        }}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        selectionActions={
          !filters.deleted && (
            <BulkActions
              ids={selectedIds}
              onDone={() => {
                setRowSelection({});
              }}
            />
          )
        }
        initialColumnVisibility={{ updatedAt: false }}
        isLoading={query.isPending}
        isFetching={query.isFetching && query.isPlaceholderData}
        onRowClick={(row) => {
          void navigate({ to: '/leads/$leadId', params: { leadId: row.id } });
        }}
        toolbar={
          <>
            <SearchBox
              value={search.q ?? ''}
              onChange={(q) => {
                filter({ q: q || undefined });
              }}
              placeholder="Search name, phone, email, suburb"
              label="Search leads"
            />
            <div className="w-36">
              <Select
                aria-label="Lead source"
                value={search.source ?? ALL}
                onValueChange={(source) => {
                  filter({ source: source === ALL ? undefined : source });
                }}
                options={[{ value: ALL, label: 'All sources' }, ...options.options('leadSources')]}
              />
            </div>
            <div className="w-40">
              <Select
                aria-label="Sales person"
                value={search.owner ?? ALL}
                onValueChange={(owner) => {
                  filter({ owner: leadsSearchSchema.shape.owner.parse(owner) });
                }}
                options={[
                  { value: ALL, label: 'Everyone' },
                  { value: 'me', label: 'Me' },
                  { value: 'none', label: 'Unassigned' },
                  ...(users.data ?? []).map((user) => ({ value: user.id, label: user.name })),
                ]}
              />
            </div>
            <div className="w-28">
              <Select
                aria-label="State"
                value={search.state ?? ALL}
                onValueChange={(state) => {
                  filter({ state: AU_STATES.find((s) => s === state) });
                }}
                options={[
                  { value: ALL, label: 'All states' },
                  ...AU_STATES.map((state) => ({ value: state, label: state })),
                ]}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <DateInput
                aria-label="Lead date from"
                className="w-36"
                value={search.from}
                onChange={(from) => {
                  filter({ from: from || undefined });
                }}
              />
              <span className="text-sm text-fg-subtle">to</span>
              <DateInput
                aria-label="Lead date to"
                className="w-36"
                value={search.to}
                onChange={(to) => {
                  filter({ to: to || undefined });
                }}
              />
            </div>
            {can('leads', 'delete') && (
              <div className="w-28">
                <Select
                  aria-label="Show"
                  value={filters.deleted ? 'deleted' : 'active'}
                  onValueChange={(value) => {
                    setRowSelection({});
                    filter({ deleted: value === 'deleted' || undefined });
                  }}
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'deleted', label: 'Deleted' },
                  ]}
                />
              </div>
            )}
          </>
        }
        empty={
          filtered ? undefined : (
            <EmptyState
              icon={<Zap />}
              title="No leads yet"
              description="Leads from the Google Sheet arrive automatically once the sync is set up (Step 3.3). You can also add one by hand."
              action={newLeadButton}
            />
          )
        }
      />
      <LeadFormDrawer
        open={creating}
        onOpenChange={setCreating}
        onSaved={(id) => {
          void navigate({ to: '/leads/$leadId', params: { leadId: id } });
        }}
      />
    </div>
  );
}
