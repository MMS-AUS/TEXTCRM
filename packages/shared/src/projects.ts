import { z } from 'zod';
import { AU_STATES, stateForPostcode } from './au.ts';
import { optionalId, optionalText } from './contacts.ts';
import { decimalField, moneyField, MAX_INVERTERS, systemInverterSchema } from './lead-details.ts';
import { ownerFilterSchema } from './leads.ts';

/** §1.4 project stages, in order. Values match the `projectStages` option list. */
export const PROJECT_STAGES = [
  'Engineering & DNSP Approval',
  'Sales Order Created (Warehouse)',
  'Subcontractor RFQ / Quoting',
  'Install Scheduled',
  'Installation in Progress',
  'Installation Completed',
  'Clean Energy Regulator (STC Claim)',
  'DNSP Grid Inspection & Metering',
  'Completed',
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];
export const PROJECT_FINAL_STAGE: ProjectStage = 'Completed';

/** Values match the `projectStatuses` option list. */
export const PROJECT_STATUSES = ['Active', 'Completed', 'Closed', 'Lost'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const optionalDate = z.iso
  .date()
  .nullish()
  .or(z.literal(''))
  .transform((value) => value || null);

/** Empty → null; otherwise a whole number from 0 to `max`. */
export const wholeNumberField = (max: number) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((value, ctx) => {
      if (value === null || value === undefined || value === '') return null;
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0 || number > max) {
        ctx.addIssue({ code: 'custom', message: 'Enter a whole number.' });
        return z.NEVER;
      }
      return number;
    });

const countField = wholeNumberField(2000);

// ── Sections ──────────────────────────────────────────────────────────────

export const projectSiteSchema = z
  .object({
    title: optionalText(200),
    streetAddress: z.string().trim().min(1, 'Enter the street address.').max(200),
    suburb: z.string().trim().min(1, 'Enter the suburb.').max(100),
    state: z.enum(AU_STATES, { error: 'Choose a state.' }),
    postcode: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'A postcode has 4 digits.'),
    /** Option values from `houseStoreys`, `roofTypes`, `phases`. */
    houseStorey: optionalText(100),
    roofType: optionalText(100),
    phase: optionalText(100),
    existingSystemDetails: optionalText(2000),
    managerRenteeFirstName: optionalText(100),
    managerRenteeLastName: optionalText(100),
    /** National Metering Identifier: 10 characters + optional checksum digit. */
    nmi: z
      .string()
      .trim()
      .toUpperCase()
      .nullish()
      .transform((value, ctx) => {
        if (!value) return null;
        if (!/^[A-Z0-9]{10,11}$/.test(value)) {
          ctx.addIssue({ code: 'custom', message: 'An NMI has 10 or 11 letters and digits.' });
          return z.NEVER;
        }
        return value;
      }),
    saleDate: optionalDate,
    notes: optionalText(5000),
  })
  .superRefine((site, ctx) => {
    const postcodeState = stateForPostcode(site.postcode);
    if (postcodeState && postcodeState !== site.state) {
      ctx.addIssue({
        code: 'custom',
        path: ['postcode'],
        message: `${site.postcode} is a ${postcodeState} postcode, not ${site.state}.`,
      });
    }
  });

export type ProjectSiteInput = z.input<typeof projectSiteSchema>;
export type ProjectSiteValues = z.output<typeof projectSiteSchema>;

const HARDWARE = [
  ['panelId', 'panelCount', 'panel'],
  ['batteryId', 'batteryCount', 'battery'],
] as const;

export const projectSystemSchema = z
  .object({
    systemSizeKw: decimalField({ max: 1000, scale: 2, label: 'the system size' }),
    panelId: optionalId,
    panelCount: countField,
    /** Every inverter on the system, copied from the lead at conversion and editable here. */
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

export type ProjectSystemInput = z.input<typeof projectSystemSchema>;
export type ProjectSystemValues = z.output<typeof projectSystemSchema>;

export const projectPricingSchema = z
  .object({
    systemPriceAud: moneyField('the system price'),
    sellingPriceAud: moneyField('the selling price'),
    /** The signed contract amount, if it differs from the selling price. */
    contractValueAud: moneyField('the contract value'),
    depositAud: moneyField('the deposit'),
    depositReceivedDate: optionalDate,
    balanceDueDate: optionalDate,
    customerInvoiceNumber: optionalText(50),
  })
  .superRefine((pricing, ctx) => {
    const total = pricing.contractValueAud ?? pricing.sellingPriceAud ?? pricing.systemPriceAud;
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
  });

export type ProjectPricingInput = z.input<typeof projectPricingSchema>;
export type ProjectPricingValues = z.output<typeof projectPricingSchema>;

/**
 * What the customer still owes: contract value (or selling price) minus the deposit, in exact
 * cents. Null when there's no price yet. Computed, never stored (§1.4).
 */
export function balancePayable(pricing: {
  contractValueAud: string | null;
  sellingPriceAud: string | null;
  depositAud: string | null;
}): string | null {
  const total = pricing.contractValueAud ?? pricing.sellingPriceAud;
  if (total === null) return null;
  const cents = Math.round(Number(total) * 100) - Math.round(Number(pricing.depositAud ?? 0) * 100);
  return (cents / 100).toFixed(2);
}

// ── Lists ─────────────────────────────────────────────────────────────────

export const PROJECT_SORTS = [
  'projectNumber',
  'customer',
  'stage',
  'status',
  'saleDate',
  'sellingPrice',
  'updatedAt',
] as const;

export const projectFiltersSchema = z.object({
  search: z.string().trim().max(100).default(''),
  stages: z.array(z.enum(PROJECT_STAGES)).max(20).default([]),
  status: z.enum(PROJECT_STATUSES).optional(),
  sales: ownerFilterSchema.optional(),
  state: z.enum(AU_STATES).optional(),
  /** Option values: `electricityDistributors`, `isFinanceOptions`, `stcStatuses`. */
  dnsp: z.string().trim().min(1).max(100).optional(),
  finance: z.string().trim().min(1).max(100).optional(),
  stcStatus: z.string().trim().min(1).max(100).optional(),
  installerCompanyId: z.uuid().optional(),
  saleDateFrom: z.iso.date().optional(),
  saleDateTo: z.iso.date().optional(),
});

export const projectListInputSchema = projectFiltersSchema.extend({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  sort: z
    .object({ id: z.enum(PROJECT_SORTS), desc: z.boolean() })
    .default({ id: 'projectNumber', desc: true }),
});

export type ProjectListInput = z.input<typeof projectListInputSchema>;
