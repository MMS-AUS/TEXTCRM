import { formatAbn, formatPhone } from '@mms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { functionalUpdate, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Building2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/PageHeader.tsx';
import { SearchBox } from '../../components/SearchBox.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { formatDate, formatRelative } from '../../lib/format.ts';
import { useBatchedPatch, useCan, useOptions } from '../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Alert,
  Badge,
  Button,
  createDataTableColumns,
  DataTable,
  EmptyState,
  Select,
  Tooltip,
  type PaginationState,
  type SortingState,
} from '../../ui/index.ts';
import { companiesSearchSchema, type CompaniesSearch } from '../list-search.ts';
import { CompanyFormDialog } from './CompanyFormDialog.tsx';

type CompanyRow = RouterOutputs['companies']['list']['rows'][number];

const dash = <span className="text-fg-subtle">—</span>;
const ALL = '__all';

const col = createDataTableColumns<CompanyRow>();
// Column ids match the API's sort keys (COMPANY_SORTS).
const columns = col.columns([
  col.accessor('name', {
    id: 'name',
    header: 'Name',
    enableHiding: false,
    cell: ({ row }) => (
      <Link
        to="/companies/$companyId"
        params={{ companyId: row.original.id }}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="font-medium hover:text-accent-text hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  }),
  col.accessor('type', {
    id: 'type',
    header: 'Type',
    cell: (info) => {
      const type = info.getValue();
      return type ? <Badge>{type}</Badge> : dash;
    },
  }),
  col.accessor('abn', {
    header: 'ABN',
    enableSorting: false,
    meta: { className: 'tabular-nums' },
    cell: (info) => formatAbn(info.getValue()) || dash,
  }),
  col.accessor('phone', {
    header: 'Phone',
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
  col.accessor('contacts', {
    id: 'contacts',
    header: 'Contacts',
    meta: { align: 'end' },
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

export function CompaniesPage() {
  const trpc = useTRPC();
  const can = useCan();
  const navigate = useNavigate();
  const search = companiesSearchSchema.parse(useSearch({ strict: false }));
  const [creating, setCreating] = useState(false);
  const types = useOptions(['companyTypes']);

  const setSearch = useBatchedPatch<CompaniesSearch>((patch) => {
    void navigate({ to: '/companies', search: { ...search, ...patch }, replace: true });
  });

  const sorting: SortingState = useMemo(
    () => [{ id: search.sort ?? 'name', desc: search.desc ?? false }],
    [search.sort, search.desc],
  );
  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: search.page ?? 0, pageSize: search.size ?? 25 }),
    [search.page, search.size],
  );
  const archived = search.archived ?? false;

  const query = useQuery({
    ...trpc.companies.list.queryOptions({
      search: search.q ?? '',
      type: search.type,
      archived,
      page: pagination.pageIndex,
      pageSize: pagination.pageSize,
      sort: { id: search.sort ?? 'name', desc: search.desc ?? false },
    }),
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(search.q || search.type || archived);
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const newButton = can('companies', 'create') && (
    <Button
      variant="primary"
      onClick={() => {
        setCreating(true);
      }}
    >
      <Plus />
      New company
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Companies"
        description="Commercial customers, installers, suppliers and other businesses."
        actions={newButton}
      />
      {query.isError && <Alert tone="danger">{errorMessage(query.error)}</Alert>}
      <DataTable
        label="Companies"
        columns={columns}
        data={rows}
        rowCount={query.data?.total ?? 0}
        getRowId={(row) => row.id}
        sorting={sorting}
        onSortingChange={(updater) => {
          const [next] = functionalUpdate(updater, sorting);
          setSearch({
            sort: companiesSearchSchema.shape.sort.parse(next?.id),
            desc: next?.desc,
            page: 0,
          });
        }}
        pagination={pagination}
        onPaginationChange={(updater) => {
          const next = functionalUpdate(updater, pagination);
          setSearch({ page: next.pageIndex, size: next.pageSize });
        }}
        isLoading={query.isPending}
        isFetching={query.isFetching && query.isPlaceholderData}
        onRowClick={(row) => {
          void navigate({ to: '/companies/$companyId', params: { companyId: row.id } });
        }}
        toolbar={
          <>
            <SearchBox
              value={search.q ?? ''}
              onChange={(q) => {
                setSearch({ q: q || undefined, page: 0 });
              }}
              placeholder="Search name, ABN, phone, suburb"
              label="Search companies"
            />
            <div className="w-48">
              <Select
                aria-label="Type"
                value={search.type ?? ALL}
                onValueChange={(type) => {
                  setSearch({ type: type === ALL ? undefined : type, page: 0 });
                }}
                options={[{ value: ALL, label: 'All types' }, ...types.options('companyTypes')]}
              />
            </div>
            <div className="w-32">
              <Select
                aria-label="Status"
                value={archived ? 'archived' : 'active'}
                onValueChange={(status) => {
                  setSearch({ archived: status === 'archived' || undefined, page: 0 });
                }}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'archived', label: 'Archived' },
                ]}
              />
            </div>
          </>
        }
        empty={
          filtered ? undefined : (
            <EmptyState
              icon={<Building2 />}
              title="No companies yet"
              description="Add commercial customers, installers and suppliers."
              action={newButton}
            />
          )
        }
      />
      <CompanyFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(id) => {
          void navigate({ to: '/companies/$companyId', params: { companyId: id } });
        }}
      />
    </div>
  );
}
