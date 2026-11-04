import type { ImportField } from '@mms/shared';
import { Select, Table, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/index.ts';

const NOT_MAPPED = '__none';

/**
 * CRM field → spreadsheet column, with the first value found for each, for the import wizard
 * and the live sheet sync. The API validates the mapping again.
 */
export function ColumnMappingTable({
  fields,
  headers,
  sampleRows,
  mapping,
  onChange,
  disabled = false,
}: {
  fields: readonly ImportField[];
  headers: readonly string[];
  sampleRows: readonly (readonly string[])[];
  mapping: Record<string, string>;
  onChange: (mapping: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const options = [
    { value: NOT_MAPPED, label: '— Not imported —' },
    ...headers.map((header) => ({ value: header, label: header })),
  ];
  const sample = (header: string | undefined) => {
    if (!header) return null;
    const index = headers.indexOf(header);
    return sampleRows.map((row) => row[index]).find((value) => value) ?? null;
  };
  return (
    <Table aria-label="Column mapping">
      <TableHead>
        <tr>
          <TableHeaderCell>CRM field</TableHeaderCell>
          <TableHeaderCell>Spreadsheet column</TableHeaderCell>
          <TableHeaderCell>First value</TableHeaderCell>
        </tr>
      </TableHead>
      <tbody>
        {fields.map((field) => {
          const header = mapping[field.key];
          const example = sample(header);
          return (
            <TableRow key={field.key}>
              <TableCell wrap>
                <span className="block font-medium">{field.label}</span>
                {field.hint && <span className="text-xs text-fg-muted">{field.hint}</span>}
              </TableCell>
              <TableCell>
                <Select
                  aria-label={`Column for ${field.label}`}
                  className="w-56"
                  value={header ?? NOT_MAPPED}
                  disabled={disabled}
                  onValueChange={(value) => {
                    const rest = Object.fromEntries(
                      Object.entries(mapping).filter(([key]) => key !== field.key),
                    );
                    onChange(value === NOT_MAPPED ? rest : { ...rest, [field.key]: value });
                  }}
                  options={options}
                />
              </TableCell>
              <TableCell wrap className="max-w-xs text-fg-muted">
                {example ?? (header ? <span className="text-fg-subtle">empty</span> : '')}
              </TableCell>
            </TableRow>
          );
        })}
      </tbody>
    </Table>
  );
}
