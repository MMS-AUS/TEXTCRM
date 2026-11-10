import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { IMPORT_TARGETS, templateHeaders, templateMapping } from '@mms/shared';
import { readUpload } from './parse.ts';
import { buildImportTemplate } from './template.ts';

describe('import templates', () => {
  it('reads back as exactly the template headings, with no rows', async () => {
    for (const target of IMPORT_TARGETS) {
      const { fileName, base64 } = await buildImportTemplate(target);
      expect(fileName).toMatch(/\.xlsx$/);
      const { table } = await readUpload(Buffer.from(base64, 'base64'), fileName);
      expect(table.headers).toEqual(templateHeaders(target));
      expect(table.rows).toEqual([]);
      expect(templateMapping(target, table.headers)).not.toBeNull();
    }
  });

  it('keeps phone and postcode columns as text, with notes on tricky headings', async () => {
    const { base64 } = await buildImportTemplate('leads');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(base64, 'base64') as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    const column = (label: string) => templateHeaders('leads').indexOf(label) + 1;
    expect(sheet?.name).toBe('Leads');
    expect(sheet?.getColumn(column('Primary Mobile')).numFmt).toBe('@');
    expect(sheet?.getColumn(column('Postcode')).numFmt).toBe('@');
    expect(sheet?.getRow(1).getCell(column('Full Name')).note).toBeTruthy();
  });
});
