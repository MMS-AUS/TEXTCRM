import { z } from 'zod';
import { columnMappingSchema } from './imports.ts';

// Settings → Live sheet sync (Step 3.3): a live leads sheet and its column mapping.

export const sheetLinkSchema = z.object({
  url: z.string().trim().min(1, 'Paste the link to the Google Sheet.').max(500),
});

export const sheetColumnsInputSchema = z.object({
  spreadsheetId: z.string().trim().min(20).max(200),
  tab: z.string().trim().min(1).max(200),
});

export const sheetSourceInputSchema = z.object({
  /** Absent when adding a sheet. */
  id: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give the sheet a name.').max(100),
  spreadsheetId: z.string().trim().min(20).max(200),
  tab: z.string().trim().min(1).max(200),
  mapping: columnMappingSchema,
  enabled: z.boolean(),
});
export type SheetSourceInput = z.infer<typeof sheetSourceInputSchema>;

export const sheetSyncRunsInputSchema = z.object({
  sourceId: z.uuid(),
  page: z.number().int().min(0).max(1000).default(0),
});

export const SHEET_SYNC_RUNS_PAGE_SIZE = 20;

export const SHEET_SYNC_RUN_STATUSES = ['running', 'completed', 'failed'] as const;
