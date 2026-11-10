import ExcelJS from 'exceljs';
import { IMPORT_FIELDS, type ImportTarget } from '@mms/shared';

// The empty Excel template offered on Settings → Import. Its headings are exactly the target's
// field labels, so a filled-in copy is matched automatically (templateMapping) and goes
// straight to the preview.

const SHEET_NAMES: Record<ImportTarget, string> = {
  leads: 'Leads',
  contacts: 'Contacts',
  panels: 'Panels',
  inverters: 'Inverters',
  batteries: 'Batteries',
};

/** Columns kept as text so Excel doesn't drop leading zeros (0412…, 0800). */
const TEXT_COLUMNS = new Set(['sheetLeadId', 'mobile', 'secondaryMobile', 'postcode']);

/** Header notes where the import field's own hint doesn't fit a template. */
const NOTES: Record<string, string> = {
  fullName: 'Fill this, or First Name and Last Name.',
  leadDate: 'Day/month/year, e.g. 3/11/2026. Empty = today.',
  state: 'NSW, QLD, VIC, WA, SA, TAS, ACT or NT.',
};

export async function buildImportTemplate(
  target: ImportTarget,
): Promise<{ fileName: string; base64: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MMS CRM';
  const sheet = workbook.addWorksheet(SHEET_NAMES[target], {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const fields = IMPORT_FIELDS[target];
  sheet.columns = fields.map((field) => ({
    header: field.label,
    key: field.key,
    width: Math.max(14, field.label.length + 4),
    ...(TEXT_COLUMNS.has(field.key) ? { style: { numFmt: '@' } } : {}),
  }));
  const header = sheet.getRow(1);
  fields.forEach((field, index) => {
    const cell = header.getCell(index + 1);
    cell.font = { bold: true };
    cell.numFmt = 'General';
    const note = NOTES[field.key] ?? field.hint;
    if (note) cell.note = note;
  });
  const bytes = await workbook.xlsx.writeBuffer();
  return {
    fileName: `MMS CRM ${SHEET_NAMES[target].toLowerCase()} import template.xlsx`,
    base64: Buffer.from(bytes).toString('base64'),
  };
}
