import {
  useTable,
  type ColumnVisibilityState,
  type OnChangeFn,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  SearchX,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button, IconButton } from './Button.tsx';
import { Checkbox } from './Checkbox.tsx';
import { cn, focusRing } from './cn.ts';
import {
  createDataTableColumns,
  dataTableFeatures,
  type DataTableColumns,
} from './data-table-columns.ts';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu.tsx';
import { EmptyState, Skeleton } from './Feedback.tsx';

export type DataTableProps<TData extends RowData> = {
  /** Accessible name of the table, e.g. "Leads". */
  label: string;
  /** Keep stable (module scope or useMemo) — a new array every render rebuilds the table. */
  columns: DataTableColumns<TData>;
  /** The current page only, already sorted by the server. Keep the reference stable. */
  data: TData[];
  /** Total rows on the server across all pages. */
  rowCount: number;
  getRowId: (row: TData) => string;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  /** Pass both to enable row selection (selection is by row id, so it survives paging). */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  initialColumnVisibility?: ColumnVisibilityState;
  /** First load, nothing to show yet: skeleton rows. */
  isLoading?: boolean;
  /** Refetching (new page/sort) while the old rows are shown: rows dim. */
  isFetching?: boolean;
  /** Left side of the toolbar: search, filters. */
  toolbar?: ReactNode;
  /** Shown in the footer while rows are selected: bulk actions. */
  selectionActions?: ReactNode;
  /** Replaces the default "No results" message. */
  empty?: ReactNode;
  pageSizeOptions?: number[];
  onRowClick?: (row: TData) => void;
};

const NO_SELECTION: RowSelectionState = {};
const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];
const formatCount = new Intl.NumberFormat('en-AU');

function selectionColumn<TData extends RowData>() {
  return createDataTableColumns<TData>().display({
    id: '_select',
    enableSorting: false,
    enableHiding: false,
    meta: { className: 'w-10 pr-0' },
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all rows on this page"
        checked={
          table.getIsAllPageRowsSelected()
            ? true
            : table.getIsSomePageRowsSelected()
              ? 'indeterminate'
              : false
        }
        onCheckedChange={(checked) => {
          table.toggleAllPageRowsSelected(checked === true);
        }}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label="Select row"
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onCheckedChange={(checked) => {
          row.toggleSelected(checked === true);
        }}
      />
    ),
  });
}

function SortIcon({ direction }: { direction: false | 'asc' | 'desc' }) {
  if (direction === 'asc') return <ArrowUp className="size-3.5 text-fg" />;
  if (direction === 'desc') return <ArrowDown className="size-3.5 text-fg" />;
  return (
    <ChevronsUpDown className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
  );
}

/**
 * Server-driven table: the parent owns sorting/pagination/selection state, puts it in the
 * query key, and passes back one sorted page plus the total row count.
 */
export function DataTable<TData extends RowData>({
  label,
  columns,
  data,
  rowCount,
  getRowId,
  sorting,
  onSortingChange,
  pagination,
  onPaginationChange,
  rowSelection,
  onRowSelectionChange,
  initialColumnVisibility,
  isLoading = false,
  isFetching = false,
  toolbar,
  selectionActions,
  empty,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  onRowClick,
}: DataTableProps<TData>) {
  const selectable = onRowSelectionChange !== undefined;
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(
    initialColumnVisibility ?? {},
  );

  const allColumns = useMemo<DataTableColumns<TData>>(
    () => (selectable ? [selectionColumn<TData>(), ...columns] : columns),
    [columns, selectable],
  );

  // A new sort order starts again from the first page.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    onSortingChange(updater);
    onPaginationChange((old) => ({ ...old, pageIndex: 0 }));
  };

  const table = useTable({
    features: dataTableFeatures,
    columns: allColumns,
    data,
    getRowId,
    rowCount,
    manualSorting: true,
    manualPagination: true,
    enableRowSelection: selectable,
    state: {
      sorting,
      pagination,
      rowSelection: rowSelection ?? NO_SELECTION,
      columnVisibility,
    },
    onSortingChange: handleSortingChange,
    onPaginationChange,
    onRowSelectionChange,
    onColumnVisibilityChange: setColumnVisibility,
  });

  const rows = table.getRowModel().rows;
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const hideableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide());
  const selectedCount = Object.keys(rowSelection ?? NO_SELECTION).length;
  const { pageIndex, pageSize } = pagination;
  const firstRow = rowCount === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min(rowCount, (pageIndex + 1) * pageSize);
  const pageCount = Math.max(1, table.getPageCount());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
        {hideableColumns.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Columns3 />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {hideableColumns.map((column) => {
                const header = column.columnDef.header;
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(checked) => {
                      column.toggleVisibility(checked);
                    }}
                    onSelect={(event) => {
                      event.preventDefault();
                    }}
                  >
                    {column.columnDef.meta?.label ??
                      (typeof header === 'string' ? header : column.id)}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
        {isFetching && !isLoading && (
          <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-accent-subtle">
            <div className="h-full w-1/3 animate-pulse bg-accent" />
          </div>
        )}
        <div className="overflow-x-auto">
          <table
            aria-label={label}
            aria-busy={isLoading || isFetching || undefined}
            className="w-full border-collapse text-sm"
          >
            <thead className="bg-surface-2/70">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    const direction = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={
                          direction === 'asc'
                            ? 'ascending'
                            : direction === 'desc'
                              ? 'descending'
                              : undefined
                        }
                        className={cn(
                          'h-9 border-b border-line px-3 text-left text-xs font-medium whitespace-nowrap text-fg-muted',
                          meta?.align === 'end' && 'text-right',
                          meta?.className,
                        )}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              'group -mx-1.5 inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 hover:bg-surface-3 hover:text-fg',
                              meta?.align === 'end' && 'flex-row-reverse',
                              focusRing,
                            )}
                          >
                            <table.FlexRender header={header} />
                            <SortIcon direction={direction} />
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className={cn('transition-opacity', isFetching && !isLoading && 'opacity-60')}>
              {isLoading ? (
                Array.from({ length: Math.min(pageSize, 8) }, (_, index) => (
                  <tr key={index} className="border-b border-line last:border-0">
                    {Array.from({ length: visibleColumnCount }, (_, cellIndex) => (
                      <td key={cellIndex} className="h-10 px-3">
                        <Skeleton className={cn('h-3.5', cellIndex === 0 ? 'w-4' : 'w-3/4')} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumnCount}>
                    {empty ?? (
                      <EmptyState
                        icon={<SearchX />}
                        title="No results"
                        description="Nothing matches the current search and filters."
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    onClick={
                      onRowClick
                        ? () => {
                            onRowClick(row.original);
                          }
                        : undefined
                    }
                    className={cn(
                      'border-b border-line transition-colors last:border-0 hover:bg-surface-2/70',
                      'data-[state=selected]:bg-accent-subtle/50',
                      onRowClick && 'cursor-pointer',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            'h-10 px-3 whitespace-nowrap text-fg',
                            meta?.align === 'end' && 'text-right tabular-nums',
                            meta?.className,
                          )}
                        >
                          <table.FlexRender cell={cell} />
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-3 py-2 text-sm text-fg-muted">
          <div className="flex min-h-7 items-center gap-3" aria-live="polite">
            {selectedCount > 0 ? (
              <>
                <span className="font-medium text-fg">
                  {formatCount.format(selectedCount)} selected
                </span>
                {selectionActions}
              </>
            ) : (
              <span className="tabular-nums">
                {formatCount.format(firstRow)}–{formatCount.format(lastRow)} of{' '}
                {formatCount.format(rowCount)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="hidden items-center gap-2 sm:flex">
              Rows
              <select
                value={pageSize}
                onChange={(event) => {
                  onPaginationChange({ pageIndex: 0, pageSize: Number(event.target.value) });
                }}
                className={cn(
                  'h-7 cursor-pointer rounded-md border border-line-strong bg-surface px-1.5 text-sm text-fg shadow-xs',
                  focusRing,
                )}
              >
                {pageSizeOptions.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <span className="tabular-nums">
              Page {pageIndex + 1} of {pageCount}
            </span>
            <div className="flex items-center gap-1">
              <IconButton
                label="Previous page"
                size="sm"
                variant="secondary"
                disabled={!table.getCanPreviousPage()}
                onClick={() => {
                  table.previousPage();
                }}
              >
                <ChevronLeft />
              </IconButton>
              <IconButton
                label="Next page"
                size="sm"
                variant="secondary"
                disabled={!table.getCanNextPage()}
                onClick={() => {
                  table.nextPage();
                }}
              >
                <ChevronRight />
              </IconButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
