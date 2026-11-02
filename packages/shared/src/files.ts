import { z } from 'zod';
import type { Feature } from './permissions.ts';

export const FILE_ENTITY_TYPES = ['lead', 'contact', 'company', 'project', 'ticket'] as const;
export type FileEntityType = (typeof FILE_ENTITY_TYPES)[number];

/** Which permission guards the files of each record type. */
export const FILE_ENTITY_FEATURE: Record<FileEntityType, Feature> = {
  lead: 'leads',
  contact: 'contacts',
  company: 'companies',
  project: 'projects',
  ticket: 'tickets',
};

export const FILE_CATEGORIES = ['bill', 'photo', 'contract', 'saa_doc', 'other'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  bill: 'Electricity bill',
  photo: 'Photo',
  contract: 'Contract',
  saa_doc: 'SAA document',
  other: 'Other',
};

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 300 * 1024;

/**
 * Accepted uploads. Deliberately no SVG/HTML (they can carry scripts) and no executables.
 * `inline` types may be opened in the browser; everything else downloads.
 */
export const ALLOWED_FILE_TYPES: Record<string, { label: string; inline: boolean }> = {
  'application/pdf': { label: 'PDF', inline: true },
  'image/jpeg': { label: 'JPEG image', inline: true },
  'image/png': { label: 'PNG image', inline: true },
  'image/webp': { label: 'WebP image', inline: true },
  'image/heic': { label: 'HEIC photo', inline: false },
  'image/heif': { label: 'HEIF photo', inline: false },
  'application/msword': { label: 'Word document', inline: false },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    label: 'Word document',
    inline: false,
  },
  'application/vnd.ms-excel': { label: 'Excel spreadsheet', inline: false },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    label: 'Excel spreadsheet',
    inline: false,
  },
  'text/csv': { label: 'CSV', inline: false },
};

/** For the file picker's `accept` attribute. */
export const FILE_ACCEPT = [
  ...Object.keys(ALLOWED_FILE_TYPES),
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
].join(',');

/** Browsers often report HEIC (iPhone photos) and some Office files with an empty type. */
const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

/** The content type to store: what the browser reported, or what the extension implies. */
export function resolveContentType(fileName: string, reported: string): string | null {
  const type = reported.toLowerCase().split(';')[0]?.trim() ?? '';
  if (type in ALLOWED_FILE_TYPES) return type;
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  return EXTENSION_TYPES[extension] ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const fileUploadRequestSchema = z.object({
  entityType: z.enum(FILE_ENTITY_TYPES),
  entityId: z.uuid(),
  category: z.enum(FILE_CATEGORIES),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200, 'The file name is too long — rename it and try again.'),
  contentType: z.string().max(200),
  sizeBytes: z
    .number()
    .int()
    .positive('The file is empty.')
    .max(MAX_FILE_BYTES, `Files can be up to ${formatBytes(MAX_FILE_BYTES)}.`),
  /** The browser made a JPEG preview (images only) and will upload it too. */
  withThumbnail: z.boolean().default(false),
});

export type FileUploadRequest = z.input<typeof fileUploadRequestSchema>;
