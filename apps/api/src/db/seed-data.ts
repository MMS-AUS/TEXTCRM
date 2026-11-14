import { z } from 'zod';

/**
 * Pure transforms from the legacy JSON files to seed rows (no database access), so they can be
 * unit tested. See §1.6 review notes and Step 0.5 for what is skipped and why.
 */

/** Lists that become user references or are derived from the hardware catalog / a date field. */
export const SKIPPED_OPTION_LISTS: ReadonlySet<string> = new Set([
  'salesPersons',
  'installationBookedByOptions',
  'installationMonths',
  'panelBrands',
  'inverterBrands',
  'batteryBrands',
]);

const dropdownFileSchema = z.record(z.string(), z.array(z.string()));

const panelSchema = z.object({
  manufacturer: z.string().trim().min(1),
  model: z.string().trim().min(1),
  series: z.string().optional(),
  sizeW: z.number().positive(),
});

const inverterSchema = z.object({
  manufacturer: z.string().trim().min(1),
  model: z.string().trim().min(1),
  series: z.string().optional(),
  sizeKw: z.number().positive(),
});

const batterySchema = z.object({
  manufacturer: z.string().trim().min(1),
  model: z.string().trim().min(1),
  series: z.string().optional(),
  usableCapacityKwh: z.number().positive(),
  size: z.string().optional(),
});

const hardwareFileSchema = z.object({
  panelHierarchy: z.array(panelSchema),
  inverterHierarchy: z.array(inverterSchema),
  batteryHierarchy: z.array(batterySchema),
});

export interface OptionListSeed {
  key: string;
  name: string;
  options: { value: string; label: string; sortOrder: number }[];
}

export interface HardwareSeed {
  panels: { manufacturer: string; model: string; series: string | null; sizeW: string }[];
  inverters: { manufacturer: string; model: string; series: string | null; sizeKw: string }[];
  batteries: {
    manufacturer: string;
    model: string;
    series: string | null;
    usableCapacityKwh: string;
    sizeLabel: string | null;
  }[];
}

/** 'ebCustomerNameMatchOptions' → 'Eb customer name match options'; 'dnspsNSW' → 'Dnsps NSW'. */
export function listNameFromKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((w) => (w === w.toUpperCase() ? w : w.toLowerCase()));
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function buildOptionLists(raw: unknown): OptionListSeed[] {
  const parsed = dropdownFileSchema.parse(raw);
  // The old "platforms" list is part of Lead Source now: its choices follow the source choices.
  const { platforms, ...file } = parsed;
  if (platforms) file.leadSources = [...(file.leadSources ?? []), ...platforms];
  return Object.entries(file)
    .filter(([key]) => !SKIPPED_OPTION_LISTS.has(key))
    .map(([key, values]) => {
      const unique = [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
      return {
        key,
        name: listNameFromKey(key),
        options: unique.map((value, i) => ({ value, label: value, sortOrder: (i + 1) * 10 })),
      };
    });
}

function cleanSeries(series: string | undefined): string | null {
  const s = series?.trim();
  return s && s !== 'N/A' ? s : null;
}

/** Keeps the first row per manufacturer + model (the legacy catalog has repeats). */
function dedupe<T extends { manufacturer: string; model: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.manufacturer}\u0000${r.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildHardware(raw: unknown): HardwareSeed {
  const file = hardwareFileSchema.parse(raw);
  return {
    panels: dedupe(file.panelHierarchy).map((p) => ({
      manufacturer: p.manufacturer,
      model: p.model,
      series: cleanSeries(p.series),
      sizeW: String(p.sizeW),
    })),
    inverters: dedupe(file.inverterHierarchy).map((i) => ({
      manufacturer: i.manufacturer,
      model: i.model,
      series: cleanSeries(i.series),
      sizeKw: String(i.sizeKw),
    })),
    batteries: dedupe(file.batteryHierarchy).map((b) => ({
      manufacturer: b.manufacturer,
      model: b.model,
      series: cleanSeries(b.series),
      usableCapacityKwh: String(b.usableCapacityKwh),
      sizeLabel: b.size?.trim() || null,
    })),
  };
}
