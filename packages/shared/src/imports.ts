import { z } from 'zod';

// Spreadsheet imports (Step 3.2) and the live leads sync (Step 3.3): which CRM fields a column
// can fill, how headers are matched automatically, and how cell text is cleaned up.

export const IMPORT_TARGETS = ['leads', 'contacts', 'panels', 'inverters', 'batteries'] as const;
/** Hardware catalogue targets (Step 2.10) — import with preview and de-duplication. */
export const HARDWARE_IMPORT_TARGETS = ['panels', 'inverters', 'batteries'] as const;
export const isHardwareTarget = (target: string) =>
  (HARDWARE_IMPORT_TARGETS as readonly string[]).includes(target);
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const IMPORT_FILE_TYPES = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

export type ImportField = {
  key: string;
  label: string;
  /** Header spellings recognised automatically (compared lower-case, letters and digits only). */
  aliases: readonly string[];
  hint?: string;
};

const field = (key: string, label: string, aliases: string[], hint?: string): ImportField => ({
  key,
  label,
  aliases: [label, ...aliases],
  ...(hint ? { hint } : {}),
});

const PERSON_FIELDS = [
  field('firstName', 'First Name', ['firstname', 'given name']),
  field('lastName', 'Last Name', ['lastname', 'surname', 'family name']),
  field(
    'fullName',
    'Full Name',
    ['name', 'customer name', 'customer'],
    'Split into first and last name when those columns are not mapped',
  ),
  field('mobile', 'Primary Mobile', [
    'mobile',
    'phone',
    'mobile number',
    'phone number',
    'contact number',
    'primary phone',
  ]),
  field('secondaryMobile', 'Secondary Mobile', [
    'secondary phone',
    'other phone',
    'alternate mobile',
  ]),
  field('email', 'Email', ['email address', 'e-mail']),
  field('streetAddress', 'Street Address', ['address', 'street', 'address line 1']),
  field('suburb', 'Suburb', ['city', 'town', 'locality']),
  field('state', 'State', []),
  field('postcode', 'Postcode', ['post code', 'zip', 'postal code']),
];

/** §1.8 "Expected columns" — the old intake sheet's headers are recognised as-is. */
export const LEAD_IMPORT_FIELDS: readonly ImportField[] = [
  field(
    'sheetLeadId',
    'Lead ID',
    ['leadid', 'id'],
    'Needed for the live sync; lets re-imports find the same lead',
  ),
  field('leadDate', 'Lead Date', ['date', 'created', 'date created', 'enquiry date']),
  field('platform', 'Platform', ['channel']),
  field('source', 'Lead Source', ['source']),
  field(
    'ownerName',
    'Sales Rep',
    ['sales person', 'salesperson', 'owner', 'rep', 'assigned to'],
    'Matched to a user by name or email',
  ),
  field('status', 'Status', ['lead status']),
  ...PERSON_FIELDS,
  field('systemSizeKw', 'System Size kW', ['system size', 'kw', 'system kw']),
  field('batteryRequired', 'Battery Required', ['battery'], 'Yes / No'),
  field('propertyType', 'Property Type', []),
  field('roofType', 'Roof Type', ['roof']),
  field('systemPriceAud', 'System Price AUD', ['system price']),
  field('sellingPriceAud', 'Selling Price AUD', ['selling price', 'price']),
  field('depositAud', 'Deposit AUD', ['deposit']),
  field('notes', 'Sales Notes', ['notes', 'comments']),
];

export const CONTACT_IMPORT_FIELDS: readonly ImportField[] = [
  ...PERSON_FIELDS,
  field('type', 'Contact Type', ['type'], 'Residential when empty'),
  field('notes', 'Notes', ['comments']),
];

const HARDWARE_BASE_FIELDS = [
  field('manufacturer', 'Manufacturer', ['brand', 'make', 'maker']),
  field('model', 'Model', ['model number', 'model no', 'product']),
  field('series', 'Series', ['range', 'family']),
];

export const IMPORT_FIELDS: Record<ImportTarget, readonly ImportField[]> = {
  leads: LEAD_IMPORT_FIELDS,
  contacts: CONTACT_IMPORT_FIELDS,
  panels: [
    ...HARDWARE_BASE_FIELDS,
    field(
      'sizeW',
      'Size W',
      ['size', 'watts', 'power', 'panel size w', 'size (w)'],
      'Panel rating in watts',
    ),
  ],
  inverters: [
    ...HARDWARE_BASE_FIELDS,
    field(
      'sizeKw',
      'Size kW',
      ['size', 'kw', 'rated power', 'size (kw)', 'ac power'],
      'Rated output in kW',
    ),
  ],
  batteries: [
    ...HARDWARE_BASE_FIELDS,
    field(
      'usableCapacityKwh',
      'Usable capacity kWh',
      ['usable capacity', 'capacity', 'kwh', 'capacity (kwh)'],
      'Usable energy in kWh',
    ),
    field('sizeLabel', 'Size label', ['size'], 'Free text, e.g. 9.6kWh System'),
  ],
};

/**
 * Lead fields the live sync keeps updating until someone edits the lead in the CRM (§1.8
 * rule 2). Status, sales rep and notes are used only when the lead is created (rule 3).
 */
export const LEAD_CREATE_ONLY_FIELDS: readonly string[] = ['status', 'ownerName', 'notes'];

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Field → header for every field whose name or alias matches a header. */
export function suggestMapping(target: ImportTarget, headers: readonly string[]) {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const importField of IMPORT_FIELDS[target]) {
    const names = new Set(importField.aliases.map(squash));
    const header = headers.find((h) => !used.has(h) && names.has(squash(h)));
    if (header) {
      mapping[importField.key] = header;
      used.add(header);
    }
  }
  return mapping;
}

export const columnMappingSchema = z
  .record(z.string().max(50), z.string().trim().min(1).max(200))
  .refine((mapping) => Object.keys(mapping).length <= 60, 'Too many columns.');

/** Problems with a mapping that would make every row fail. */
export function mappingProblems(
  target: ImportTarget,
  mapping: Record<string, string>,
  options: { requireLeadId?: boolean } = {},
): string[] {
  const problems: string[] = [];
  const known = new Set(IMPORT_FIELDS[target].map((f) => f.key));
  for (const key of Object.keys(mapping)) {
    if (!known.has(key)) problems.push(`"${key}" is not a field you can import.`);
  }
  if (isHardwareTarget(target)) {
    const size = { panels: 'sizeW', inverters: 'sizeKw', batteries: 'usableCapacityKwh' }[
      target as (typeof HARDWARE_IMPORT_TARGETS)[number]
    ];
    if (!mapping.manufacturer || !mapping.model)
      problems.push('Map the Manufacturer and Model columns.');
    if (!mapping[size]) problems.push('Map the size column.');
  } else {
    if (!mapping.firstName && !mapping.fullName) {
      problems.push('Map a First Name or Full Name column.');
    }
    if (!mapping.mobile && !mapping.email) {
      problems.push('Map a mobile or an email column so customers can be reached.');
    }
  }
  if (options.requireLeadId && !mapping.sheetLeadId) {
    problems.push('Map the Lead ID column — the live sync needs it to recognise each row.');
  }
  const headers = Object.values(mapping);
  if (new Set(headers).size !== headers.length) {
    problems.push('Each column can fill only one field.');
  }
  return problems;
}

// ── Cleaning cell text ───────────────────────────────────────────────────

/** Days from 1899-12-30 (the spreadsheet epoch) for serial dates like 45964. */
const SPREADSHEET_EPOCH = Date.UTC(1899, 11, 30);

function isoIfValid(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * A date as Australians type it: 3/11/2026, 03-11-26, 2026-11-03, "2026-11-03T10:00:00Z" or a
 * spreadsheet serial number. Day comes before month. Returns 'YYYY-MM-DD', null when empty, or
 * false when it can't be read.
 */
export function parseSheetDate(text: string): string | null | false {
  const value = text.trim();
  if (!value) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(value);
  if (iso) return isoIfValid(Number(iso[1]), Number(iso[2]), Number(iso[3])) ?? false;
  const au = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/.exec(value);
  if (au) {
    const year = Number(au[3]) < 100 ? 2000 + Number(au[3]) : Number(au[3]);
    return isoIfValid(year, Number(au[2]), Number(au[1])) ?? false;
  }
  if (/^\d{5}(\.\d+)?$/.test(value)) {
    const date = new Date(SPREADSHEET_EPOCH + Math.floor(Number(value)) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  return false;
}

/** Yes/No in the forms people type it. Null when empty, undefined when unreadable. */
export function parseYesNo(text: string): boolean | null | undefined {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  if (['yes', 'y', 'true', '1', 'required'].includes(value)) return true;
  if (['no', 'n', 'false', '0', 'not required'].includes(value)) return false;
  return undefined;
}

/** "Olivia Nguyen" → Olivia / Nguyen; "Mary Anne de Silva" → Mary / Anne de Silva. */
export function splitFullName(text: string): { firstName: string; lastName: string | null } {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') || null };
}

/** The option whose value or label matches, ignoring case and punctuation. */
export function matchOption(
  text: string,
  options: readonly { value: string; label: string }[],
): string | null {
  const wanted = squash(text);
  if (!wanted) return null;
  return (
    options.find((option) => squash(option.value) === wanted || squash(option.label) === wanted)
      ?.value ?? null
  );
}

/** Mapped cell values of one row: { firstName: 'Olivia', … } (only mapped, non-empty cells). */
export function mapRow(
  headers: readonly string[],
  row: readonly string[],
  mapping: Record<string, string>,
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const [key, header] of Object.entries(mapping)) {
    const index = headers.indexOf(header);
    const value = index >= 0 ? (row[index] ?? '').trim() : '';
    if (value) data[key] = value;
  }
  return data;
}

export const IMPORT_ACTIONS = ['create', 'update', 'skip', 'error'] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

/** uploading → ready (source read) → previewed → queued → running → completed | failed. */
export const IMPORT_STATUSES = [
  'uploading',
  'ready',
  'previewed',
  'queued',
  'running',
  'completed',
  'failed',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_ROWS_PAGE_SIZE = 50;

export const importUploadRequestSchema = z.object({
  target: z.enum(IMPORT_TARGETS),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/\.(csv|xlsx)$/i, 'Upload a .csv or .xlsx file.'),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_IMPORT_BYTES, `Files can be up to ${String(MAX_IMPORT_BYTES / 1024 / 1024)} MB.`),
});

export const importSheetRequestSchema = z.object({
  target: z.enum(IMPORT_TARGETS),
  url: z.string().trim().min(1, 'Paste the link to the Google Sheet.').max(500),
});

export const importIdSchema = z.object({ id: z.uuid() });

export const importTabSchema = z.object({ id: z.uuid(), tab: z.string().trim().min(1).max(200) });

export const importPreviewSchema = z.object({ id: z.uuid(), mapping: columnMappingSchema });

export const importRowsInputSchema = z.object({
  id: z.uuid(),
  action: z.enum(IMPORT_ACTIONS).optional(),
  page: z.number().int().min(0).max(1000).default(0),
});
