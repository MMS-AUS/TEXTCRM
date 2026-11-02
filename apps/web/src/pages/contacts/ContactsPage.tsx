import { formatPhone } from '@mms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { functionalUpdate, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Plus, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/PageHeader.tsx';
import { SearchBox } from '../../components/SearchBox.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { fullName, formatDate, formatRelative } from '../../lib/format.ts';
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
import { contactsSearchSchema, type ContactsSearch } from '../list-search.ts';
import { ContactFormDialog } from './ContactFormDialog.tsx';

type ContactRow = RouterOutputs['contacts']['list']['rows'][number];

const dash = <span className="text-fg-subtle">—</span>;
const ALL = '__all';

const col = createDataTableColumns<ContactRow>();
// Column ids match the API's sort keys (CONTACT_SORTS).
const columns = col.columns([
  col.accessor('firstName', {
    id: 'name',
    header: 'Name',
    enableHiding: false,
    cell: ({ row }) => (
      <Link
        to="/contacts/$contactId"
        params={{ contactId: row.original.id }}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="font-medium hover:text-accent-text hover:underline"
      >
        {fullName(row.original)}
      </Link>
    ),
  }),
  col.accessor('mobile', {
    header: 'Mobile',
    enableSorting: false,
    meta: { className: 'tabular-nums' },
    cell: (info) => formatPhone(info.getValue()) || dash,
  }),
  col.accessor('email', {
    id: 'email',
    header: 'Email',
    cell: (info) => <span className="text-fg-muted">{info.getValue() ?? dash}</span>,
  }),
  col.accessor('type', {
    id: 'type',
    header: 'Type',
    cell: (info) => <Badge>{info.getValue()}</Badge>,
  }),
  col.accessor('companyName', {
    id: 'company',
    header: 'Company',
    cell: ({ row }) =>
      row.original.companyId && row.original.companyName ? (
        <Link
          to="/companies/$companyId"
          params={{ companyId: row.original.companyId }}
          onClick={(event) => {
            event.stopPropagation();
          }}
          className="hover:text-accent-text hover:underline"
        >
          {row.original.companyName}
        </Link>
      ) : (
        dash
      ),
  }),
  col.accessor('suburb', {
    id: 'location',
    header: 'Location',
    cell: ({ row }) =>
      row.original.suburb ? (
        <span className="text-fg-muted">
          {row.original.suburb}, {row.original.state}
        </span>
      ) : (
        dash
      ),
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

export function ContactsPage() {
  const trpc = useTRPC();
  const can = useCan();
  const navigate = useNavigate();
  const search = contactsSearchSchema.parse(useSearch({ strict: false }));
  const [creating, setCreating] = useState(false);
  const types = useOptions(['contactTypes']);

  const setSearch = useBatchedPatch<ContactsSearch>((patch) => {
    void navigate({ to: '/contacts', search: { ...search, ...patch }, replace: true });
  });

  const sorting: SortingState = useMemo(
    () => [{ id: search.sort ?? 'updatedAt', desc: search.desc ?? true }],
    [search.sort, search.desc],
  );
  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: search.page ?? 0, pageSize: search.size ?? 25 }),
    [search.page, search.size],
  );
  const archived = search.archived ?? false;

  const query = useQuery({
    ...trpc.contacts.list.queryOptions({
      search: search.q ?? '',
      type: search.type,
      archived,
      page: pagination.pageIndex,
      pageSize: pagination.pageSize,
      sort: { id: search.sort ?? 'updatedAt', desc: search.desc ?? true },
    }),
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(search.q || search.type || archived);
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contacts"
        description="Customers, subcontractors and other people you deal with."
        actions={
          can('contacts', 'create') && (
            <Button
              variant="primary"
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus />
              New contact
            </Button>
          )
        }
      />
      {query.isError && <Alert tone="danger">{errorMessage(query.error)}</Alert>}
      <DataTable
        label="Contacts"
        columns={columns}
        data={rows}
        rowCount={query.data?.total ?? 0}
        getRowId={(row) => row.id}
        sorting={sorting}
        onSortingChange={(updater) => {
          const [next] = functionalUpdate(updater, sorting);
          setSearch({
            sort: contactsSearchSchema.shape.sort.parse(next?.id),
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
          void navigate({ to: '/contacts/$contactId', params: { contactId: row.id } });
        }}
        toolbar={
          <>
            <SearchBox
              value={search.q ?? ''}
              onChange={(q) => {
                setSearch({ q: q || undefined, page: 0 });
              }}
              placeholder="Search name, phone, email, suburb"
              label="Search contacts"
            />
            <div className="w-40">
              <Select
                aria-label="Type"
                value={search.type ?? ALL}
                onValueChange={(type) => {
                  setSearch({ type: type === ALL ? undefined : type, page: 0 });
                }}
                options={[{ value: ALL, label: 'All types' }, ...types.options('contactTypes')]}
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
              icon={<UsersRound />}
              title="No contacts yet"
              description="Contacts are created here, and from leads once they arrive."
              action={
                can('contacts', 'create') && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setCreating(true);
                    }}
                  >
                    <Plus />
                    New contact
                  </Button>
                )
              }
            />
          )
        }
      />
      <ContactFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(id) => {
          void navigate({ to: '/contacts/$contactId', params: { contactId: id } });
        }}
      />
    </div>
  );
}
