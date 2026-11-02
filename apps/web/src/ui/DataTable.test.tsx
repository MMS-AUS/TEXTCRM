import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDataTableColumns,
  DataTable,
  type DataTableProps,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from './index.ts';

type Person = { id: string; name: string; age: number };

const col = createDataTableColumns<Person>();
const columns = col.columns([
  col.accessor('name', { header: 'Name' }),
  col.accessor('age', { header: 'Age', meta: { align: 'end' } }),
]);

const PEOPLE: Person[] = [
  { id: 'p1', name: 'Ada', age: 36 },
  { id: 'p2', name: 'Grace', age: 45 },
];

type Recorded = {
  sorting: SortingState;
  pagination: PaginationState;
  rowSelection: RowSelectionState;
};

/** Owns the state like a real screen would, and exposes the latest values to the test. */
function Harness({ recorded, ...props }: Partial<DataTableProps<Person>> & { recorded: Recorded }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 2 });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  Object.assign(recorded, { sorting, pagination, rowSelection });
  return (
    <DataTable
      label="People"
      columns={columns}
      data={PEOPLE}
      rowCount={5}
      getRowId={(person) => person.id}
      sorting={sorting}
      onSortingChange={setSorting}
      pagination={pagination}
      onPaginationChange={setPagination}
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      {...props}
    />
  );
}

function renderTable(props: Partial<DataTableProps<Person>> = {}) {
  const recorded: Recorded = {
    sorting: [],
    pagination: { pageIndex: 0, pageSize: 2 },
    rowSelection: {},
  };
  render(<Harness recorded={recorded} {...props} />);
  return recorded;
}

describe('DataTable', () => {
  afterEach(cleanup);

  it('renders the page it is given with the server total', () => {
    renderTable();
    const table = screen.getByRole('table', { name: 'People' });
    expect(within(table).getByText('Ada')).toBeDefined();
    expect(within(table).getByText('Grace')).toBeDefined();
    expect(screen.getByText('1–2 of 5')).toBeDefined();
    expect(screen.getByText('Page 1 of 3')).toBeDefined();
  });

  it('asks for sorting by column, cycling ascending → descending, and marks aria-sort', () => {
    const recorded = renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(recorded.sorting).toEqual([{ id: 'name', desc: false }]);
    expect(screen.getByRole('columnheader', { name: 'Name' }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(recorded.sorting).toEqual([{ id: 'name', desc: true }]);
  });

  it('pages forward and back, and a new sort returns to the first page', () => {
    const recorded = renderTable();
    const previous = screen.getByRole('button', { name: 'Previous page' });
    expect(previous.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(recorded.pagination.pageIndex).toBe(1);
    expect(screen.getByText('3–4 of 5')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Age' }));
    expect(recorded.pagination.pageIndex).toBe(0);
  });

  it('selects rows by id and offers select-all for the page', () => {
    const recorded = renderTable();
    const [first] = screen.getAllByRole('checkbox', { name: 'Select row' });
    if (!first) throw new Error('no row checkbox');
    fireEvent.click(first);
    expect(recorded.rowSelection).toEqual({ p1: true });
    expect(screen.getByText('1 selected')).toBeDefined();
    const all = screen.getByRole('checkbox', { name: 'Select all rows on this page' });
    expect(all.getAttribute('aria-checked')).toBe('mixed');
    fireEvent.click(all);
    expect(recorded.rowSelection).toEqual({ p1: true, p2: true });
  });

  it('shows skeleton rows on first load and an empty state when there are no rows', () => {
    renderTable({ isLoading: true });
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('Ada')).toBeNull();
    cleanup();

    renderTable({ data: [], rowCount: 0 });
    expect(screen.getByText('No results')).toBeDefined();
    expect(screen.getByText('0–0 of 0')).toBeDefined();
  });
});
