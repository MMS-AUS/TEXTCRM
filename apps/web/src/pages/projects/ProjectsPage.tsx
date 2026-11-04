import { AU_STATES, formatAud, PROJECT_STAGES, PROJECT_STATUSES } from '@mms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { functionalUpdate, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { FolderKanban, SlidersHorizontal, X } from 'lucide-react';
import { useMemo } from 'react';
import { PageHeader } from '../../components/PageHeader.tsx';
import { ViewToggle } from '../../components/ViewToggle.tsx';
import { SavedViewsMenu } from '../../components/SavedViewsMenu.tsx';
import { SearchBox } from '../../components/SearchBox.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { formatDate, formatRelative } from '../../lib/format.ts';
import { useBatchedPatch, useOptions, useUsers } from '../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  createDataTableColumns,
  DataTable,
  DateInput,
  EmptyState,
  Field,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Skeleton,
  Tooltip,
  type PaginationState,
  type SortingState,
} from '../../ui/index.ts';
import { projectsSearchSchema, type ProjectsSearch } from '../list-search.ts';
import { ProjectBoard } from './ProjectBoard.tsx';
import { projectStatusTone, stageNumber, systemSummary } from './project-stage.ts';

type ProjectRow = RouterOutputs['projects']['list']['rows'][number];

const dash = <span className="text-fg-subtle">—</span>;
const ALL = '__all';

const col = createDataTableColumns<ProjectRow>();
// Column ids match the API's sort keys (PROJECT_SORTS).
const columns = col.columns([
  col.accessor('projectNumber', {
    id: 'projectNumber',
    header: 'Project',
    enableHiding: false,
    cell: ({ row }) => (
      <Link
        to="/projects/$projectId"
        params={{ projectId: row.original.id }}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="font-mono text-xs font-medium hover:text-accent-text hover:underline"
      >
        {row.original.projectNumber}
      </Link>
    ),
  }),
  col.accessor('customerName', {
    id: 'customer',
    header: 'Customer',
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  col.accessor('stage', {
    id: 'stage',
    header: 'Stage',
    cell: (info) => (
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs text-fg-subtle tabular-nums">
          {stageNumber(info.getValue())}/{PROJECT_STAGES.length}
        </span>
        {info.getValue()}
      </span>
    ),
  }),
  col.accessor('status', {
    id: 'status',
    header: 'Status',
    cell: (info) => (
      <Badge tone={projectStatusTone(info.getValue())} dot>
        {info.getValue()}
      </Badge>
    ),
  }),
  col.accessor('suburb', {
    header: 'Location',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-fg-muted">
        {row.original.suburb}, {row.original.state}
      </span>
    ),
  }),
  col.accessor('systemSizeKw', {
    header: 'System',
    enableSorting: false,
    cell: ({ row }) => systemSummary(row.original.systemSizeKw, row.original.batteryCount) || dash,
  }),
  col.accessor('sellingPriceAud', {
    id: 'sellingPrice',
    header: 'Price',
    meta: { align: 'end' },
    cell: (info) => formatAud(info.getValue()) || dash,
  }),
  col.accessor('salesName', {
    header: 'Sales person',
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
  col.accessor('saleDate', {
    id: 'saleDate',
    header: 'Sold',
    meta: { className: 'tabular-nums' },
    cell: (info) => <span className="text-fg-muted">{formatDate(info.getValue()) || '—'}</span>,
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

export function ProjectsPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const search = projectsSearchSchema.parse(useSearch({ strict: false }));
  const view = search.view ?? 'board';
  const options = useOptions(['electricityDistributors', 'isFinanceOptions', 'stcStatuses']);
  const users = useUsers();
  const installers = useQuery(trpc.projects.installers.queryOptions());

  const setSearch = useBatchedPatch<ProjectsSearch>((patch) => {
    void navigate({ to: '/projects', search: { ...search, ...patch }, replace: true });
  });
  const filter = (patch: Partial<ProjectsSearch>) => {
    setSearch({ ...patch, page: 0 });
  };

  // Default to active jobs; "all" shows every status.
  const statusFilter = search.status === 'all' ? undefined : (search.status ?? 'Active');
  const filters = {
    search: search.q ?? '',
    stages: view === 'table' ? (search.stage ?? []) : [],
    status: statusFilter,
    sales: search.sales,
    state: search.state,
    dnsp: search.dnsp,
    finance: search.finance,
    stcStatus: search.stc,
    installerCompanyId: search.installer,
    saleDateFrom: search.from,
    saleDateTo: search.to,
  };

  const sorting: SortingState = useMemo(
    () => [{ id: search.sort ?? 'projectNumber', desc: search.desc ?? true }],
    [search.sort, search.desc],
  );
  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: search.page ?? 0, pageSize: search.size ?? 25 }),
    [search.page, search.size],
  );

  const boardOptions = trpc.projects.board.queryOptions(filters);
  const board = useQuery({
    ...boardOptions,
    enabled: view === 'board',
    placeholderData: keepPreviousData,
  });
  const table = useQuery({
    ...trpc.projects.list.queryOptions({
      ...filters,
      page: pagination.pageIndex,
      pageSize: pagination.pageSize,
      sort: { id: search.sort ?? 'projectNumber', desc: search.desc ?? true },
    }),
    enabled: view === 'table',
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => table.data?.rows ?? [], [table.data]);

  const extraFilters = [
    search.dnsp,
    search.finance,
    search.stc,
    search.installer,
    search.from,
    search.to,
  ].filter(Boolean).length;
  const filtered = Boolean(
    search.q ||
    search.stage?.length ||
    search.status ||
    search.sales ||
    search.state ||
    extraFilters,
  );

  const toolbar = (
    <>
      <SearchBox
        value={search.q ?? ''}
        onChange={(q) => {
          filter({ q: q || undefined });
        }}
        placeholder="Search number, customer, suburb"
        label="Search projects"
      />
      {view === 'table' && (
        <div className="w-52">
          <Select
            aria-label="Stage"
            value={search.stage?.[0] ?? ALL}
            onValueChange={(stage) => {
              const match = PROJECT_STAGES.find((s) => s === stage);
              filter({ stage: match ? [match] : undefined });
            }}
            options={[
              { value: ALL, label: 'All stages' },
              ...PROJECT_STAGES.map((s) => ({ value: s, label: s })),
            ]}
          />
        </div>
      )}
      <div className="w-32">
        <Select
          aria-label="Status"
          value={search.status ?? 'Active'}
          onValueChange={(status) => {
            filter({
              status: projectsSearchSchema.shape.status.parse(
                status === 'Active' ? undefined : status,
              ),
            });
          }}
          options={[
            ...PROJECT_STATUSES.map((s) => ({ value: s, label: s })),
            { value: 'all', label: 'All statuses' },
          ]}
        />
      </div>
      <div className="w-40">
        <Select
          aria-label="Sales person"
          value={search.sales ?? ALL}
          onValueChange={(sales) => {
            filter({ sales: projectsSearchSchema.shape.sales.parse(sales) });
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
            ...AU_STATES.map((s) => ({ value: s, label: s })),
          ]}
        />
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm">
            <SlidersHorizontal />
            More filters
            {extraFilters > 0 && <Badge tone="accent">{extraFilters}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex flex-col gap-3">
          {(
            [
              ['DNSP', 'dnsp', 'electricityDistributors'],
              ['Finance', 'finance', 'isFinanceOptions'],
              ['STC status', 'stc', 'stcStatuses'],
            ] as const
          ).map(([label, key, list]) => (
            <Field key={key} label={label}>
              {(props) => (
                <Select
                  {...props}
                  value={search[key] ?? ALL}
                  onValueChange={(value) => {
                    filter({ [key]: value === ALL ? undefined : value });
                  }}
                  options={[{ value: ALL, label: 'Any' }, ...options.options(list)]}
                />
              )}
            </Field>
          ))}
          <Field label="Installer">
            {(props) => (
              <Select
                {...props}
                value={search.installer ?? ALL}
                onValueChange={(value) => {
                  filter({ installer: value === ALL ? undefined : value });
                }}
                options={[
                  { value: ALL, label: 'Any' },
                  ...(installers.data ?? []).map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            )}
          </Field>
          <Field label="Sold between">
            {(props) => (
              <div className="flex items-center gap-1.5">
                <DateInput
                  {...props}
                  aria-label="Sold from"
                  value={search.from}
                  onChange={(from) => {
                    filter({ from: from || undefined });
                  }}
                />
                <span className="text-fg-subtle">–</span>
                <DateInput
                  aria-label="Sold to"
                  value={search.to}
                  onChange={(to) => {
                    filter({ to: to || undefined });
                  }}
                />
              </div>
            )}
          </Field>
          <p className="text-xs text-fg-muted">
            DNSP, finance, STC and installer details are entered on each project (Step 2.7).
          </p>
        </PopoverContent>
      </Popover>
      {filtered && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigate({ to: '/projects', search: { view: search.view }, replace: true });
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
      icon={<FolderKanban />}
      title={filtered ? 'No projects match' : 'No projects yet'}
      description={
        filtered
          ? 'Try clearing some filters.'
          : 'Projects are created by converting a lead (Convert to project on the lead page).'
      }
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Projects"
        description="Every job, from engineering approval to completion."
        actions={
          <>
            <SavedViewsMenu
              page="projects"
              current={search}
              onApply={(saved) => {
                void navigate({ to: '/projects', search: projectsSearchSchema.parse(saved) });
              }}
            />
            <ViewToggle
              view={view}
              onChange={(next) => {
                setSearch({ view: next === 'board' ? undefined : next, page: 0 });
              }}
            />
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
            <ProjectBoard board={board.data} queryKey={boardOptions.queryKey} />
          )}
        </>
      ) : (
        <>
          {table.isError && <Alert tone="danger">{errorMessage(table.error)}</Alert>}
          <DataTable
            label="Projects"
            columns={columns}
            data={rows}
            rowCount={table.data?.total ?? 0}
            getRowId={(row) => row.id}
            sorting={sorting}
            onSortingChange={(updater) => {
              const [next] = functionalUpdate(updater, sorting);
              setSearch({
                sort: projectsSearchSchema.shape.sort.parse(next?.id),
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
              void navigate({ to: '/projects/$projectId', params: { projectId: row.id } });
            }}
            toolbar={toolbar}
            empty={empty}
          />
        </>
      )}
    </div>
  );
}
