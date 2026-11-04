import { readFile } from 'node:fs/promises';
import { auth, sheets } from '@googleapis/sheets';

/** Read-only access to Google Sheets shared with the service account (§2.2 Google Sheets API). */
export interface SheetsReader {
  /** The address people share their sheet with (as Viewer). */
  serviceAccountEmail: string;
  describe(spreadsheetId: string): Promise<{ title: string; tabs: string[] }>;
  /** Every cell of one tab, as displayed in the sheet. */
  read(spreadsheetId: string, tab: string): Promise<string[][]>;
}

/** A problem the user can fix (sharing, link, tab name); shown as-is. */
export class SheetAccessError extends Error {}

/** The spreadsheet ID from a docs.google.com link, or a bare ID. */
export function parseSpreadsheetId(input: string): string | null {
  const text = input.trim();
  const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(text);
  if (fromUrl?.[1]) return fromUrl[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(text) ? text : null;
}

const cellText = (cell: unknown) =>
  typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean'
    ? String(cell)
    : '';

/** Text that a date-formatted cell displays: 25/06/2026, 06-25-26, 2026-06-25 10:00… */
const LOOKS_LIKE_DATE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/;

/**
 * The displayed cells, except that a cell stored as a date (a serial number underneath, shown
 * as a date) becomes its exact serial — parseSheetDate reads serials without guessing whether
 * the day or the month comes first.
 */
export function withExactDates(
  shown: readonly (readonly unknown[])[],
  raw: readonly (readonly unknown[])[],
): string[][] {
  return shown.map((row, r) =>
    row.map((cell, c) => {
      const text = cellText(cell);
      const value = raw[r]?.[c];
      return typeof value === 'number' && LOOKS_LIKE_DATE.test(text.trim())
        ? String(Math.floor(value))
        : text;
    }),
  );
}

function httpStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = 'status' in error ? error.status : 'code' in error ? error.code : null;
  return typeof status === 'number' ? status : null;
}

function explain(error: unknown, serviceAccountEmail: string, tab?: string): never {
  const status = httpStatus(error);
  if (status === 403) {
    throw new SheetAccessError(
      `The sheet isn't shared with ${serviceAccountEmail}. In Google Sheets choose Share, add that address as Viewer, then try again.`,
    );
  }
  if (status === 404) {
    throw new SheetAccessError('No Google Sheet was found at that link. Check it and try again.');
  }
  if (status === 400 && tab) {
    throw new SheetAccessError(`The sheet has no tab called "${tab}".`);
  }
  throw error;
}

/**
 * The real reader, or null when GOOGLE_SERVICE_ACCOUNT_PATH isn't set. The key file stays
 * outside the repo and is read once at startup; its client email is shown in the "share with"
 * instructions.
 */
export async function createSheetsReader(
  keyPath: string | undefined,
): Promise<SheetsReader | null> {
  if (!keyPath) return null;
  const key: unknown = JSON.parse(await readFile(keyPath, 'utf8'));
  const field = (name: string) =>
    typeof key === 'object' && key !== null && name in key
      ? (key as Record<string, unknown>)[name]
      : null;
  const email = field('client_email');
  const privateKey = field('private_key');
  if (typeof email !== 'string' || typeof privateKey !== 'string') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_PATH does not point to a service-account JSON key.');
  }
  const client = sheets({
    version: 'v4',
    auth: new auth.JWT({
      email,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    }),
  });

  return {
    serviceAccountEmail: email,
    async describe(spreadsheetId) {
      try {
        const { data } = await client.spreadsheets.get({
          spreadsheetId,
          fields: 'properties.title,sheets.properties.title',
        });
        return {
          title: data.properties?.title ?? 'Untitled spreadsheet',
          tabs: (data.sheets ?? []).flatMap((sheet) =>
            sheet.properties?.title ? [sheet.properties.title] : [],
          ),
        };
      } catch (error) {
        explain(error, email);
      }
    },
    async read(spreadsheetId, tab) {
      // Quoted so tab names with spaces or punctuation work.
      const range = `'${tab.replace(/'/g, "''")}'`;
      try {
        // The displayed text (what people see), plus the raw values so real date cells can be
        // read exactly whatever the sheet's locale (a US-locale sheet shows 06/25/2026).
        const [shown, raw] = await Promise.all([
          client.spreadsheets.values.get({
            spreadsheetId,
            range,
            valueRenderOption: 'FORMATTED_VALUE',
          }),
          client.spreadsheets.values.get({
            spreadsheetId,
            range,
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'SERIAL_NUMBER',
          }),
        ]);
        return withExactDates(shown.data.values ?? [], raw.data.values ?? []);
      } catch (error) {
        explain(error, email, tab);
      }
    },
  };
}
