import { z } from 'zod';
import { optionalEmail, optionalId, optionalText } from './contacts.ts';
import { moneyField } from './lead-details.ts';
import { businessToday, ownerFilterSchema } from './leads.ts';
import { optionalDate } from './projects.ts';

// Service tickets (Step 2.8, §1.4): triage — issue recorded → initial check → work required →
// resolution — plus existing/replaced hardware, warranty claims and installer visits.
// Dropdown fields hold option values from the ticket* lists; the server checks them.

/** Values match the `ticketPriorities` option list, lowest first. */
export const TICKET_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** The `ticketIssueResolutionStatuses` values that end a ticket. */
export const TICKET_CLOSED_STATUSES = [
  'Resolved - Complete Handover',
  'Claim Denied by Manufacturer',
  'Customer Closed',
] as const;

export const TICKET_DEFAULT_STATUS = 'Under Investigation';

export function isTicketClosed(status: string | null | undefined): boolean {
  return (TICKET_CLOSED_STATUSES as readonly string[]).includes(status ?? '');
}

/** The four triage steps in order, with the option list each one picks from. */
export const TICKET_TRIAGE_STEPS = [
  { key: 'issueRecorded', label: 'Issue recorded', list: 'ticketIssueRecordedOptions' },
  { key: 'initialCheck', label: 'Initial check', list: 'ticketInitialCheckOptions' },
  { key: 'workRequired', label: 'Work required', list: 'ticketWorkRequiredOptions' },
  { key: 'resolutionStatus', label: 'Resolution', list: 'ticketIssueResolutionStatuses' },
] as const;

const option = optionalText(150);

function notInFuture(
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
  date: string | null,
  path: string,
  what: string,
) {
  if (date && date > businessToday()) {
    ctx.addIssue({ code: 'custom', path: [path], message: `The ${what} can't be in the future.` });
  }
}

/** Opening a ticket, and editing its core details. */
export const ticketInputSchema = z.object({
  contactId: z.uuid({ error: 'Choose the customer.' }),
  projectId: optionalId,
  title: z.string().trim().min(1, 'Describe the problem in a few words.').max(200),
  description: optionalText(5000),
  category: option,
  priority: z.enum(TICKET_PRIORITIES).default('Medium'),
  assignedUserId: optionalId,
});
export type TicketInput = z.input<typeof ticketInputSchema>;
export type TicketValues = z.output<typeof ticketInputSchema>;

/** The triage flow and the resolution. */
export const ticketTriageSchema = z
  .object({
    issueRecorded: option,
    initialCheck: option,
    workRequired: option,
    resolutionStatus: z.string().trim().min(1, 'Choose the resolution status.').max(150),
    serviceIssueNotes: optionalText(5000),
    resolvedDate: optionalDate,
    serviceChargeAud: moneyField('the service charge'),
  })
  .superRefine((triage, ctx) => {
    notInFuture(ctx, triage.resolvedDate, 'resolvedDate', 'resolved date');
  });
export type TicketTriageInput = z.input<typeof ticketTriageSchema>;
export type TicketTriageValues = z.output<typeof ticketTriageSchema>;

export const TICKET_HARDWARE_KINDS = ['panel', 'inverter', 'battery'] as const;
export const TICKET_HARDWARE_ROLES = ['existing', 'replaced'] as const;
export const HARDWARE_KIND_LABELS: Record<(typeof TICKET_HARDWARE_KINDS)[number], string> = {
  panel: 'Panel',
  inverter: 'Inverter',
  battery: 'Battery',
};

/** Serial numbers typed one per line or separated by commas. */
export const serialNumbersField = z
  .union([z.string(), z.array(z.string())])
  .nullish()
  .transform((value) => {
    const parts = Array.isArray(value) ? value : (value ?? '').split(/[\n,;]+/);
    return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].slice(0, 500);
  })
  .refine((serials) => serials.every((serial) => serial.length <= 100), {
    message: 'A serial number can be up to 100 characters.',
  });

export const ticketHardwareSchema = z
  .object({
    role: z.enum(TICKET_HARDWARE_ROLES),
    kind: z.enum(TICKET_HARDWARE_KINDS),
    quantity: z.coerce.number().int().min(0, 'Enter 0 or more.').max(1000).default(1),
    brand: optionalText(150),
    model: optionalText(200),
    size: optionalText(50),
    serialNumbers: serialNumbersField,
    notes: optionalText(2000),
  })
  .superRefine((row, ctx) => {
    if (row.serialNumbers.length > row.quantity && row.quantity > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['serialNumbers'],
        message: `${String(row.serialNumbers.length)} serial numbers for ${String(row.quantity)} item(s).`,
      });
    }
  });
export type TicketHardwareInput = z.input<typeof ticketHardwareSchema>;
export type TicketHardwareValues = z.output<typeof ticketHardwareSchema>;

export const warrantyClaimSchema = z
  .object({
    claimDate: optionalDate,
    claimReference: optionalText(100),
    status: option,
    invoiceNumber: optionalText(100),
    invoiceAmountAud: moneyField('the invoice amount'),
    invoiceStatus: option,
    brandNotes: optionalText(5000),
  })
  .superRefine((claim, ctx) => {
    notInFuture(ctx, claim.claimDate, 'claimDate', 'claim date');
  });
export type WarrantyClaimInput = z.input<typeof warrantyClaimSchema>;
export type WarrantyClaimValues = z.output<typeof warrantyClaimSchema>;

export const installerVisitSchema = z
  .object({
    isSubcontractor: z.boolean().default(true),
    installerCompanyId: optionalId,
    installerName: optionalText(150),
    phone: optionalText(50),
    email: optionalEmail,
    visitDate: optionalDate,
    notes: optionalText(5000),
    invoiceDate: optionalDate,
    invoiceNumber: optionalText(100),
    invoiceAmountAud: moneyField('the invoice amount'),
    invoiceStatus: option,
  })
  .superRefine((visit, ctx) => {
    if (!visit.installerCompanyId && !visit.installerName) {
      ctx.addIssue({
        code: 'custom',
        path: ['installerName'],
        message: 'Choose the installer company or type who attended.',
      });
    }
  });
export type InstallerVisitInput = z.input<typeof installerVisitSchema>;
export type InstallerVisitValues = z.output<typeof installerVisitSchema>;

// ── Lists ─────────────────────────────────────────────────────────────────

export const TICKET_SORTS = [
  'ticketNumber',
  'customer',
  'priority',
  'status',
  'age',
  'updatedAt',
] as const;

/** Open for less than a week, a week to a month, longer. */
export const TICKET_AGES = ['week', 'month', 'older'] as const;
export const TICKET_AGE_LABELS: Record<(typeof TICKET_AGES)[number], string> = {
  week: 'Under 7 days',
  month: '7–30 days',
  older: 'Over 30 days',
};

export const ticketFiltersSchema = z.object({
  search: z.string().trim().max(100).default(''),
  /** open (default) | closed | all. */
  state: z.enum(['open', 'closed', 'all']).default('open'),
  status: z.string().trim().min(1).max(150).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  category: z.string().trim().min(1).max(150).optional(),
  assigned: ownerFilterSchema.optional(),
  age: z.enum(TICKET_AGES).optional(),
  contactId: z.uuid().optional(),
  projectId: z.uuid().optional(),
});

export const ticketListInputSchema = ticketFiltersSchema.extend({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  sort: z
    .object({ id: z.enum(TICKET_SORTS), desc: z.boolean() })
    .default({ id: 'ticketNumber', desc: true }),
});
export type TicketListInput = z.input<typeof ticketListInputSchema>;

/** Whole days a ticket has been open (until it closed). */
export function ticketAgeDays(createdAt: string, closedAt: string | null, now = new Date()) {
  const end = closedAt ? new Date(closedAt) : now;
  return Math.max(0, Math.floor((end.getTime() - new Date(createdAt).getTime()) / 86_400_000));
}
