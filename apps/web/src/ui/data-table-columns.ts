import {
  columnVisibilityFeature,
  createColumnHelper,
  metaHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table';

export type DataTableColumnMeta = {
  /** Name in the "Columns" menu when the header isn't plain text. */
  label?: string;
  /** Right-align numbers and money. */
  align?: 'start' | 'end';
  /** Extra classes for this column's header and cells, e.g. a fixed width. */
  className?: string;
};

/** The TanStack Table v9 features every DataTable registers. */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});
export type DataTableFeatures = typeof dataTableFeatures;

/** Column helper for DataTable: `const col = createDataTableColumns<Lead>()`. */
export function createDataTableColumns<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

export type DataTableColumns<TData extends RowData> = Array<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each column keeps its own value type; this is exactly what createColumnHelper().columns() returns
  ColumnDef<DataTableFeatures, TData, any>
>;
