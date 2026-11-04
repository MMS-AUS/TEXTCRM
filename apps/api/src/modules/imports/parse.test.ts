import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_ROWS, parseSheetDate } from '@mms/shared';
import { parseSpreadsheetId, withExactDates } from './google-sheets.ts';
import { ImportFileError, readUpload, toTable } from './parse.ts';

describe('toTable', () => {
  it('uses the first non-empty row as headers and keeps sheet row numbers', () => {
    const table = toTable([
      [],
      ['Name', '', 'Name'],
      ['Olivia', '0412', 'x'],
      ['', '', ''],
      ['Jack'],
    ]);
    expect(table.headers).toEqual(['Name', 'Column 2', 'Name (2)']);
    expect(table.rows).toEqual([
      { rowNumber: 3, cells: ['Olivia', '0412', 'x'] },
      { rowNumber: 5, cells: ['Jack', '', ''] },
    ]);
  });

  it('refuses empty sheets and sheets over the row limit', () => {
    expect(() => toTable([[''], []])).toThrow(ImportFileError);
    const big = [['Name'], ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ['x'])];
    expect(() => toTable(big)).toThrow(/limit is 5000/);
  });
});

describe('readUpload', () => {
  it('reads CSV with a byte-order mark and quoted commas', async () => {
    const csv = Buffer.from(
      String.fromCharCode(0xfeff) + 'Name,Address\n"Olivia","12 Rose St, Parramatta"\n',
    );
    const { tabs, table } = await readUpload(csv, 'leads.CSV');
    expect(tabs).toEqual([]);
    expect(table).toEqual({
      headers: ['Name', 'Address'],
      rows: [{ rowNumber: 2, cells: ['Olivia', '12 Rose St, Parramatta'] }],
    });
  });

  it('reads any tab of an XLSX workbook as displayed text', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Notes').addRow(['ignore me']);
    const sheet = workbook.addWorksheet('Leads');
    sheet.addRow(['Name', 'Date', 'Size', 'Total']);
    sheet.addRow([
      'Olivia',
      new Date(Date.UTC(2026, 10, 3)),
      6.6,
      { formula: 'C2*2', result: 13.2 },
    ]);
    sheet.addRow([]);
    sheet.addRow([{ richText: [{ text: 'Ja' }, { text: 'ck' }] }]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const first = await readUpload(buffer, 'book.xlsx');
    expect(first.tabs).toEqual(['Notes', 'Leads']);
    expect(first.tab).toBe('Notes');

    const leads = await readUpload(buffer, 'book.xlsx', 'Leads');
    expect(leads.table.headers).toEqual(['Name', 'Date', 'Size', 'Total']);
    expect(leads.table.rows).toEqual([
      { rowNumber: 2, cells: ['Olivia', '2026-11-03', '6.6', '13.2'] },
      { rowNumber: 4, cells: ['Jack', '', '', ''] },
    ]);
    await expect(readUpload(buffer, 'book.xlsx', 'Missing')).rejects.toThrow(
      'There is no tab called "Missing".',
    );
  });

  it('refuses other file types', async () => {
    await expect(readUpload(Buffer.from('x'), 'leads.pdf')).rejects.toThrow(ImportFileError);
  });
});

describe('parseSpreadsheetId', () => {
  it('takes the ID from a link or as-is', () => {
    const id = '1mkYuqi8cuit0N2dPlraGi87OYwYFNK0Z55M3zlibu-c';
    expect(
      parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`),
    ).toBe(id);
    expect(parseSpreadsheetId(` ${id} `)).toBe(id);
    expect(parseSpreadsheetId('https://example.com/sheet')).toBeNull();
  });
});

describe('withExactDates', () => {
  it('uses the serial of real date cells, whatever the display format', () => {
    // 46198 = 25 June 2026; a US-locale sheet shows it month-first.
    expect(
      withExactDates(
        [
          ['Lead Date', 'Mobile', 'Typed'],
          ['06/25/2026', '0412 345 678', '06/25/2026'],
        ],
        [
          ['Lead Date', 412345678, '06/25/2026'],
          [46198.5, 412345678, '06/25/2026'],
        ],
      ),
    ).toEqual([
      ['Lead Date', 'Mobile', 'Typed'],
      ['46198', '0412 345 678', '06/25/2026'],
    ]);
    expect(parseSheetDate('46198')).toBe('2026-06-25');
  });
});
