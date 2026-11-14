import { z } from 'zod';
import { optionalId, optionalText } from './contacts.ts';
import { businessToday } from './leads.ts';

// System requirements and pricing on a lead (Step 2.3). Money travels as a decimal string with
// two places ("12345.00") so cents stay exact end to end — the database column is numeric(12,2).

/** "$12,345.6", "12345.60", 12345.6 → "12345.60". Empty → null. */
export function decimalField({ max, scale, label }: { max: number; scale: number; label: string }) {
  return z
    .union([z.string(), z.number()])
    .nullish()
    .transform((value, ctx) => {
      if (value === null || value === undefined || value === '') return null;
      const text = String(value).replace(/[$,\s]/g, '');
      if (!/^\d+(\.\d+)?$/.test(text)) {
        ctx.addIssue({ code: 'custom', message: `Enter ${label} as a number.` });
        return z.NEVER;
      }
      const number = Number(text);
      if (number > max) {
        ctx.addIssue({ code: 'custom', message: `That's more than ${String(max)} — check it.` });
        return z.NEVER;
      }
      return number.toFixed(scale);
    });
}

export const moneyField = (label: string) => decimalField({ max: 10_000_000, scale: 2, label });

const countField = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value, ctx) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 2000) {
      ctx.addIssue({ code: 'custom', message: 'Enter a whole number.' });
      return z.NEVER;
    }
    return number;
  });

const HARDWARE = [
  ['panelId', 'panelCount', 'panel'],
  ['batteryId', 'batteryCount', 'battery'],
] as const;

export const INVERTER_TYPES = ['grid', 'hybrid'] as const;
export type InverterType = (typeof INVERTER_TYPES)[number];
export const INVERTER_TYPE_LABELS: Record<InverterType, string> = {
  grid: 'Grid Inverter',
  hybrid: 'Hybrid Inverter',
};
export const MAX_INVERTERS = 10;

/** One inverter line on a system: a catalog model, how many, and whether it is grid or hybrid. */
export const systemInverterSchema = z.object({
  inverterId: z.uuid({ error: 'Choose the inverter model.' }),
  count: z.union([z.string(), z.number()]).transform((value, ctx) => {
    const number = value === '' ? 1 : Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 2000) {
      ctx.addIssue({ code: 'custom', message: 'Enter a whole number, 1 or more.' });
      return z.NEVER;
    }
    return number;
  }),
  type: z.enum(INVERTER_TYPES, { error: 'Choose Grid or Hybrid.' }),
});
export type SystemInverterValues = z.output<typeof systemInverterSchema>;

/** Total inverter capacity in kW ("10.00") from each model's size and how many there are. */
export function inverterCapacityKw(
  inverters: readonly { sizeKw: string | number; count: number }[],
): string {
  return inverters.reduce((total, row) => total + Number(row.sizeKw) * row.count, 0).toFixed(2);
}

export const leadSystemSchema = z
  .object({
    systemSizeKw: decimalField({ max: 1000, scale: 2, label: 'the system size' }),
    batteryRequired: z.boolean().default(false),
    propertyType: optionalText(100),
    /** Option values from `roofTypes`, `houseStoreys`, `phases`. */
    roofType: optionalText(100),
    houseStorey: optionalText(100),
    phase: optionalText(100),
    existingSystemDetails: optionalText(2000),
    quarterlyBillAud: moneyField('the bill amount'),
    panelId: optionalId,
    panelCount: countField,
    /** Every inverter on the system. When there are any, the system size is their total capacity. */
    inverters: z.array(systemInverterSchema).max(MAX_INVERTERS).default([]),
    batteryId: optionalId,
    batteryCount: countField,
  })
  .superRefine((system, ctx) => {
    for (const [idKey, countKey, noun] of HARDWARE) {
      if (system[idKey] && !system[countKey]) {
        ctx.addIssue({ code: 'custom', path: [countKey], message: `How many ${noun}s?` });
      }
      if (!system[idKey] && system[countKey]) {
        ctx.addIssue({ code: 'custom', path: [idKey], message: `Choose the ${noun} model.` });
      }
    }
  });

export type LeadSystemInput = z.input<typeof leadSystemSchema>;
export type LeadSystemValues = z.output<typeof leadSystemSchema>;

export const leadPricingSchema = z
  .object({
    systemPriceAud: moneyField('the system price'),
    /** After rebates (STCs, battery rebates). */
    sellingPriceAud: moneyField('the selling price'),
    depositAud: moneyField('the deposit'),
    depositReceivedDate: z.iso
      .date()
      .nullish()
      .or(z.literal(''))
      .transform((value) => value || null),
  })
  .superRefine((pricing, ctx) => {
    const total = pricing.sellingPriceAud ?? pricing.systemPriceAud;
    if (pricing.depositAud && total && Number(pricing.depositAud) > Number(total)) {
      ctx.addIssue({
        code: 'custom',
        path: ['depositAud'],
        message: 'The deposit is more than the price.',
      });
    }
    if (pricing.depositReceivedDate && !pricing.depositAud) {
      ctx.addIssue({
        code: 'custom',
        path: ['depositAud'],
        message: 'Enter the deposit amount that was received.',
      });
    }
    if (pricing.depositReceivedDate && pricing.depositReceivedDate > businessToday()) {
      ctx.addIssue({
        code: 'custom',
        path: ['depositReceivedDate'],
        message: "A deposit can't be received in the future.",
      });
    }
  });

export type LeadPricingInput = z.input<typeof leadPricingSchema>;
export type LeadPricingValues = z.output<typeof leadPricingSchema>;

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

/** "12345.00" → "$12,345.00"; null → "". */
export function formatAud(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return aud.format(Number(value));
}

const longDate = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "2026-11-03" → "3 November 2026" (calendar date, no time-zone shift). */
export function formatDateLong(isoDate: string): string {
  return longDate.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Panels × watts → kW, two decimals ("10.56"). */
export function systemSizeKw(panelCount: number, panelWatts: string | number): string {
  return ((panelCount * Number(panelWatts)) / 1000).toFixed(2);
}
