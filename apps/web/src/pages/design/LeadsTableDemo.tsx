import { MoreHorizontal, Search, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  createDataTableColumns,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  type BadgeTone,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from '../../ui/index.ts';
import { querySampleLeads, type SampleLead, type SampleStatus } from './sample-leads.ts';

const STATUS_TONES: Record<SampleStatus, BadgeTone> = {
  New: 'info',
  Contacted: 'accent',
  Quoted: 'warning',
  Won: 'success',
  Lost: 'neutral',
};

const money = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});
const date = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

const col = createDataTableColumns<SampleLead>();
const columns = col.columns([
  col.accessor('name', {
    header: 'Name',
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  col.accessor('suburb', {
    header: 'Location',
    cell: (info) => (
      <span className="text-fg-muted">
        {info.getValue()}, {info.row.original.state}
      </span>
    ),
  }),
  col.accessor('source', {
    header: 'Source',
    cell: (info) => <span className="text-fg-muted">{info.getValue()}</span>,
  }),
  col.accessor('systemKw', {
    header: 'System',
    meta: { align: 'end' },
    cell: (info) => `${info.getValue().toFixed(2)} kW`,
  }),
  col.accessor('quote', {
    header: 'Quote',
    meta: { align: 'end' },
    cell: (info) => money.format(info.getValue()),
  }),
  col.accessor('status', {
    header: 'Status',
    cell: (info) => (
      <Badge tone={STATUS_TONES[info.getValue()]} dot>
        {info.getValue()}
      </Badge>
    ),
  }),
  col.accessor('createdAt', {
    header: 'Created',
    cell: (info) => <span className="text-fg-muted">{date.format(new Date(info.getValue()))}</span>,
  }),
  col.display({
    id: 'actions',
    enableHiding: false,
    meta: { className: 'w-12 text-right' },
    cell: () => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Row actions" size="sm">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem>
            <UserPlus />
            Assign
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }),
]);

const NO_ROWS: SampleLead[] = [];

type Result = { key: string; rows: SampleLead[]; total: number };

/** Fakes a 450 ms server round-trip so the loading and refetching states are visible. */
function useSampleLeads(search: string, sorting: SortingState, pagination: PaginationState) {
  const key = JSON.stringify({ search, sorting, pagination });
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setResult({ key, ...querySampleLeads({ search, sorting, pagination }) });
    }, 450);
    return () => {
      clearTimeout(timer);
    };
  }, [key, search, sorting, pagination]);

  return {
    rows: result?.rows ?? NO_ROWS,
    total: result?.total ?? 0,
    isLoading: result === null,
    isFetching: result !== null && result.key !== key,
  };
}

export function LeadsTableDemo() {
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [forceLoading, setForceLoading] = useState(false);
  const [forceEmpty, setForceEmpty] = useState(false);

  const query = useSampleLeads(search, sorting, pagination);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg-muted">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={forceLoading}
            onCheckedChange={(checked) => {
              setForceLoading(checked === true);
            }}
          />
          Show first-load state
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={forceEmpty}
            onCheckedChange={(checked) => {
              setForceEmpty(checked === true);
            }}
          />
          Show empty result
        </label>
      </div>
      <DataTable
        label="Sample leads"
        columns={columns}
        data={forceEmpty ? NO_ROWS : query.rows}
        rowCount={forceEmpty ? 0 : query.total}
        getRowId={(lead) => lead.id}
        sorting={sorting}
        onSortingChange={setSorting}
        pagination={pagination}
        onPaginationChange={setPagination}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        isLoading={forceLoading || query.isLoading}
        isFetching={query.isFetching}
        toolbar={
          <div className="w-full sm:w-64">
            <Input
              leading={<Search />}
              placeholder="Search name or suburb"
              aria-label="Search leads"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPagination((old) => ({ ...old, pageIndex: 0 }));
              }}
            />
          </div>
        }
        selectionActions={
          <>
            <Button size="sm">
              <UserPlus />
              Assign
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRowSelection({});
              }}
            >
              Clear
            </Button>
          </>
        }
      />
    </div>
  );
}
