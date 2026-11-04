import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { MAX_IMPORT_ROWS } from '@mms/shared';

/** A spreadsheet tab as text: the header row and the data rows with their sheet row numbers. */
export type Table = {
  headers: string[];
  rows: { rowNumber: number; cells: string[] }[];
};

export class ImportFileError extends Error {}

/**
 * Header = the first non-empty row; blank headers become "Column 3"; fully blank rows are
 * dropped. Row numbers stay as the user sees them in the sheet (header row = 1, usually).
 */
export function toTable(raw: readonly (readonly string[])[]): Table {
  const headerIndex = raw.findIndex((row) => row.some((cell) => cell.trim() !== ''));
  if (headerIndex < 0) throw new ImportFileError('The sheet is empty.');
  const width = Math.max(...raw.map((row) => row.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    const text = (raw[headerIndex]?.[i] ?? '').trim() || `Column ${String(i + 1)}`;
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return count > 1 ? `${text} (${String(count)})` : text;
  });
  const rows: Table['rows'] = [];
  raw.forEach((row, index) => {
    if (index <= headerIndex || !row.some((cell) => cell.trim() !== '')) return;
    rows.push({ rowNumber: index + 1, cells: headers.map((_, i) => (row[i] ?? '').trim()) });
  });
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportFileError(
      `The sheet has ${String(rows.length)} rows; the limit is ${String(MAX_IMPORT_ROWS)}. Split it into smaller files.`,
    );
  }
  return { headers, rows };
}

function readCsv(buffer: Buffer): string[][] {
  try {
    return parseCsv(buffer, { bom: true, relax_column_count: true, skip_empty_lines: false });
  } catch (error) {
    throw new ImportFileError(
      `This CSV file can't be read (${error instanceof Error ? error.message : 'unknown error'}).`,
    );
  }
}

/** A cell as the text a person would read in Excel. Dates become YYYY-MM-DD. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return value.text;
    if ('error' in value) return '';
    return '';
  }
  return String(value);
}

async function readXlsx(buffer: Buffer, tab: string | undefined) {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS's own Buffer type predates Node's generic Buffer.
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ImportFileError("This file can't be read as an Excel workbook (.xlsx).");
  }
  const tabs = workbook.worksheets.map((sheet) => sheet.name);
  const sheet = tab ? workbook.getWorksheet(tab) : workbook.worksheets[0];
  if (!sheet)
    throw new ImportFileError(
      tab ? `There is no tab called "${tab}".` : 'The workbook has no sheets.',
    );
  const raw: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cells[column - 1] = cellText(cell.value);
    });
    // eachCell skips nothing here, but the array is filled by index, so holes become ''.
    raw[rowNumber - 1] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? '');
  });
  return {
    tabs,
    sheetName: sheet.name,
    raw: Array.from({ length: raw.length }, (_, i) => raw[i] ?? []),
  };
}

/** Reads an uploaded CSV or XLSX file. XLSX files may have several tabs; CSV has one. */
export async function readUpload(
  buffer: Buffer,
  fileName: string,
  tab?: string,
): Promise<{ tabs: string[]; tab: string | null; table: Table }> {
  if (/\.csv$/i.test(fileName)) {
    return { tabs: [], tab: null, table: toTable(readCsv(buffer)) };
  }
  if (/\.xlsx$/i.test(fileName)) {
    const { tabs, sheetName, raw } = await readXlsx(buffer, tab);
    return { tabs, tab: sheetName, table: toTable(raw) };
  }
  throw new ImportFileError('Upload a .csv or .xlsx file.');
}
