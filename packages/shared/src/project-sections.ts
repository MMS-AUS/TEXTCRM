import { z } from 'zod';
import { optionalId, optionalText } from './contacts.ts';
import { moneyField } from './lead-details.ts';
import { businessToday } from './leads.ts';
import { optionalDate, wholeNumberField } from './projects.ts';

// The project workspace sections of §1.4 that follow the sale: EB verification, grid
// application, finance, warehouse, installation, STC claim and OpenSolar (Step 2.7).
// Dropdown fields hold option values; the server checks them against the option lists.

const option = optionalText(100);
const reference = optionalText(100);

type Issue = { code: 'custom'; path: string[]; message: string };
type Ctx = { addIssue: (issue: Issue) => void };

function notInFuture(ctx: Ctx, date: string | null, path: string, what: string) {
  if (date && date > businessToday()) {
    ctx.addIssue({ code: 'custom', path: [path], message: `The ${what} can't be in the future.` });
  }
}

/** `later` may not come before `earlier` (ISO dates compare as text). */
function notBefore(
  ctx: Ctx,
  later: string | null,
  earlier: string | null,
  path: string,
  message: string,
) {
  if (later && earlier && later < earlier) ctx.addIssue({ code: 'custom', path: [path], message });
}

function amountAddsUp(cents: (string | null)[]): string {
  return (
    cents.reduce((sum, value) => sum + Math.round(Number(value ?? 0) * 100), 0) / 100
  ).toFixed(2);
}

// ── EB (electricity bill) verification ───────────────────────────────────

export const ebVerificationSchema = z
  .object({
    customerNameMatch: option,
    addressMatch: option,
    meterMatch: option,
    meterPhase: option,
    openSolarSystemMatch: option,
    openSolarPricingMatch: option,
    docsReceived: option,
    docsReceivedDate: optionalDate,
  })
  .superRefine((eb, ctx) => {
    notInFuture(ctx, eb.docsReceivedDate, 'docsReceivedDate', 'date the documents arrived');
  });

export type EbVerificationInput = z.input<typeof ebVerificationSchema>;
export type EbVerificationValues = z.output<typeof ebVerificationSchema>;

type EbAnswerKey = Exclude<keyof EbVerificationValues, 'docsReceived' | 'docsReceivedDate'>;

/** The six checks, their option lists, and which answers count as passed. */
export const EB_CHECKS: readonly {
  key: EbAnswerKey;
  label: string;
  list: string;
  passes: readonly string[];
}[] = [
  {
    key: 'customerNameMatch',
    label: 'Customer name matches the bill',
    list: 'ebCustomerNameMatchOptions',
    passes: ['Yes'],
  },
  {
    key: 'addressMatch',
    label: 'Address matches the bill',
    list: 'ebAddressMatchOptions',
    passes: ['Yes'],
  },
  {
    key: 'meterMatch',
    label: 'Meter number matches',
    list: 'ebMeterMatchOptions',
    passes: ['Yes'],
  },
  // Passes when it agrees with the site's phase (Customer & site).
  { key: 'meterPhase', label: 'Meter phase', list: 'ebMeterPhaseOptions', passes: [] },
  {
    key: 'openSolarSystemMatch',
    label: 'OpenSolar system matches',
    list: 'ebOpenSolarSystemMatchOptions',
    passes: ['Yes', 'Variance Verified'],
  },
  {
    key: 'openSolarPricingMatch',
    label: 'OpenSolar pricing matches',
    list: 'ebOpenSolarPricingMatchOptions',
    passes: ['Yes', 'Discrepancy Adjusted'],
  },
];

export type EbCheckState = 'passed' | 'attention' | 'unanswered';

/** "Single Phase" / "Three Phase" / "Split Phase" / "Two Phase / Split" → one word. */
function phaseKind(phase: string | null): string | null {
  if (!phase) return null;
  const text = phase.toLowerCase();
  if (text.includes('three')) return 'three';
  if (text.includes('split') || text.includes('two')) return 'split';
  if (text.includes('single')) return 'single';
  return text;
}

/** Each check's state. The meter phase is compared with the site's phase. */
export function ebCheckResults(
  eb: Partial<Record<EbAnswerKey, string | null>>,
  sitePhase: string | null,
) {
  return EB_CHECKS.map((check) => {
    const answer = eb[check.key] ?? null;
    let state: EbCheckState;
    let note: string | null = null;
    if (!answer) state = 'unanswered';
    else if (check.key === 'meterPhase') {
      if (!sitePhase) {
        state = 'attention';
        note = "Set the site's phase in Customer & site to compare.";
      } else if (phaseKind(answer) === phaseKind(sitePhase)) state = 'passed';
      else {
        state = 'attention';
        note = `The site is recorded as ${sitePhase}.`;
      }
    } else state = check.passes.includes(answer) ? 'passed' : 'attention';
    return { key: check.key, label: check.label, answer, state, note };
  });
}

// ── Grid application ─────────────────────────────────────────────────────

export const GRID_APPROVED = 'Grid App Approved';
export const GRID_REJECTED = 'Grid Rejected';

export const gridApplicationSchema = z
  .object({
    electricityDistributor: option,
    applicationRef: reference,
    status: option,
    appliedDate: optionalDate,
    approvalDate: optionalDate,
    rejectedDate: optionalDate,
    energyRetailer: option,
    retailerRef: reference,
  })
  .superRefine((grid, ctx) => {
    notInFuture(ctx, grid.appliedDate, 'appliedDate', 'applied date');
    notInFuture(ctx, grid.approvalDate, 'approvalDate', 'approval date');
    notInFuture(ctx, grid.rejectedDate, 'rejectedDate', 'rejected date');
    for (const key of ['approvalDate', 'rejectedDate'] as const) {
      if (grid[key] && !grid.appliedDate) {
        ctx.addIssue({ code: 'custom', path: ['appliedDate'], message: 'When was it applied?' });
      }
      notBefore(ctx, grid[key], grid.appliedDate, key, 'This is before the applied date.');
    }
    if (grid.status === GRID_APPROVED && !grid.approvalDate) {
      ctx.addIssue({ code: 'custom', path: ['approvalDate'], message: 'When was it approved?' });
    }
    if (grid.status === GRID_REJECTED && !grid.rejectedDate) {
      ctx.addIssue({ code: 'custom', path: ['rejectedDate'], message: 'When was it rejected?' });
    }
  });

export type GridApplicationInput = z.input<typeof gridApplicationSchema>;
export type GridApplicationValues = z.output<typeof gridApplicationSchema>;

/** Whole days from one ISO date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** How long the DNSP took to decide, or has been deciding so far. */
export function gridTiming(
  grid: { appliedDate: string | null; approvalDate: string | null; rejectedDate: string | null },
  today: string = businessToday(),
): { days: number; decided: boolean } | null {
  if (!grid.appliedDate) return null;
  const decidedOn = grid.approvalDate ?? grid.rejectedDate;
  return { days: daysBetween(grid.appliedDate, decidedOn ?? today), decided: decidedOn !== null };
}

// ── Finance ──────────────────────────────────────────────────────────────

/** The `isFinanceOptions` value meaning the customer pays directly. */
export const FINANCE_NONE = 'No (Cash / Direct Payment)';

export const isOnFinance = (financeOption: string | null) =>
  financeOption !== null && financeOption !== FINANCE_NONE;

export const financeSchema = z
  .object({
    financeOption: option,
    financeCompany: option,
    status: option,
    appliedDate: optionalDate,
    approvedDate: optionalDate,
    approvedAmountAud: moneyField('the approved amount'),
  })
  .superRefine((finance, ctx) => {
    const details =
      finance.financeCompany ??
      finance.status ??
      finance.appliedDate ??
      finance.approvedDate ??
      finance.approvedAmountAud;
    if (!isOnFinance(finance.financeOption) && details) {
      ctx.addIssue({
        code: 'custom',
        path: ['financeOption'],
        message: 'The job is not on finance — choose a finance option or clear the details.',
      });
    }
    notInFuture(ctx, finance.appliedDate, 'appliedDate', 'applied date');
    notInFuture(ctx, finance.approvedDate, 'approvedDate', 'approved date');
    notBefore(
      ctx,
      finance.approvedDate,
      finance.appliedDate,
      'approvedDate',
      'This is before the applied date.',
    );
  });

export type FinanceInput = z.input<typeof financeSchema>;
export type FinanceValues = z.output<typeof financeSchema>;

// ── Warehouse & stock ────────────────────────────────────────────────────

export const warehouseSchema = z
  .object({
    warehouse: option,
    salesOrderNumber: reference,
    stockStatus: option,
    stockUsedProject: optionalText(200),
    invoiceNumber: reference,
    invoiceDate: optionalDate,
    invoiceAmountAud: moneyField('the invoice amount'),
    invoiceStatus: option,
    invoicePaidDate: optionalDate,
  })
  .superRefine((warehouse, ctx) => {
    notInFuture(ctx, warehouse.invoicePaidDate, 'invoicePaidDate', 'paid date');
    notBefore(
      ctx,
      warehouse.invoicePaidDate,
      warehouse.invoiceDate,
      'invoicePaidDate',
      'This is before the invoice date.',
    );
  });

export type WarehouseInput = z.input<typeof warehouseSchema>;
export type WarehouseValues = z.output<typeof warehouseSchema>;

// ── Installation ─────────────────────────────────────────────────────────

export const installationSchema = z
  .object({
    status: option,
    installerCompanyId: optionalId,
    installerQuotedAud: moneyField('the quote'),
    bookingDate: optionalDate,
    bookedByUserId: optionalId,
    completedDate: optionalDate,
    docsStatus: option,
    docsReceivedDate: optionalDate,
    installerInvoiceNumber: reference,
    installerInvoiceDate: optionalDate,
    installerInvoiceAmountAud: moneyField('the invoice amount'),
    installerInvoiceStatus: option,
  })
  .superRefine((install, ctx) => {
    notInFuture(ctx, install.completedDate, 'completedDate', 'completion date');
    notInFuture(ctx, install.docsReceivedDate, 'docsReceivedDate', 'date the documents arrived');
    notBefore(
      ctx,
      install.completedDate,
      install.bookingDate,
      'completedDate',
      'This is before the installation date.',
    );
  });

export type InstallationInput = z.input<typeof installationSchema>;
export type InstallationValues = z.output<typeof installationSchema>;

/** "November 2026" — the legacy "installation completed month", derived from the date. */
export function completedMonth(completedDate: string | null): string | null {
  if (!completedDate) return null;
  return new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${completedDate}T00:00:00Z`));
}

// ── STC claim ────────────────────────────────────────────────────────────

const stcCount = wholeNumberField(10_000);

export const stcClaimSchema = z
  .object({
    portal: option,
    jobNumber: reference,
    status: option,
    submittedDate: optionalDate,
    solarStcs: stcCount,
    solarStcsAmountAud: moneyField('the solar STC amount'),
    solarStcsReceivedDate: optionalDate,
    batteryStcs: stcCount,
    batteryStcsAmountAud: moneyField('the battery STC amount'),
    batteryStcsReceivedDate: optionalDate,
    adminChargesAud: moneyField('the admin charges'),
    customerStcRateAud: moneyField('the customer rate'),
    internalStcRateAud: moneyField('the internal rate'),
  })
  .superRefine((stc, ctx) => {
    notInFuture(ctx, stc.submittedDate, 'submittedDate', 'submitted date');
    for (const kind of ['solar', 'battery'] as const) {
      const received = stc[`${kind}StcsReceivedDate`];
      const path = `${kind}StcsReceivedDate`;
      notInFuture(ctx, received, path, 'received date');
      notBefore(ctx, received, stc.submittedDate, path, 'This is before the submitted date.');
      if (received && !stc[`${kind}StcsAmountAud`]) {
        ctx.addIssue({
          code: 'custom',
          path: [`${kind}StcsAmountAud`],
          message: 'Enter the amount that was received.',
        });
      }
    }
  });

export type StcClaimInput = z.input<typeof stcClaimSchema>;
export type StcClaimValues = z.output<typeof stcClaimSchema>;

/**
 * STC money worked out on the server (§1.4): what has been received (amounts with a received
 * date), what is still to come, the net after admin charges, and the customer/internal values
 * (rate × certificates). Exact cents; null when there's nothing to add up.
 */
export function stcTotals(stc: {
  solarStcs: number | null;
  solarStcsAmountAud: string | null;
  solarStcsReceivedDate: string | null;
  batteryStcs: number | null;
  batteryStcsAmountAud: string | null;
  batteryStcsReceivedDate: string | null;
  adminChargesAud: string | null;
  customerStcRateAud: string | null;
  internalStcRateAud: string | null;
}) {
  const certificates =
    stc.solarStcs === null && stc.batteryStcs === null
      ? null
      : (stc.solarStcs ?? 0) + (stc.batteryStcs ?? 0);
  const received = [
    stc.solarStcsReceivedDate ? stc.solarStcsAmountAud : null,
    stc.batteryStcsReceivedDate ? stc.batteryStcsAmountAud : null,
  ];
  const anyAmount = stc.solarStcsAmountAud !== null || stc.batteryStcsAmountAud !== null;
  const totalReceivedAud = anyAmount ? amountAddsUp(received) : null;
  const outstanding = [
    stc.solarStcsReceivedDate ? null : stc.solarStcsAmountAud,
    stc.batteryStcsReceivedDate ? null : stc.batteryStcsAmountAud,
  ];
  const value = (rate: string | null) =>
    rate !== null && certificates !== null
      ? ((Math.round(Number(rate) * 100) * certificates) / 100).toFixed(2)
      : null;
  return {
    totalStcs: certificates,
    totalReceivedAud,
    outstandingAud: anyAmount ? amountAddsUp(outstanding) : null,
    netReceivedAud:
      totalReceivedAud !== null && stc.adminChargesAud !== null
        ? amountAddsUp([totalReceivedAud, `-${stc.adminChargesAud}`])
        : totalReceivedAud,
    customerValueAud: value(stc.customerStcRateAud),
    internalValueAud: value(stc.internalStcRateAud),
  };
}

// ── OpenSolar ────────────────────────────────────────────────────────────

const openSolarId = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    if (!/^[A-Za-z0-9-]{1,50}$/.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'Use the ID exactly as OpenSolar shows it.' });
      return z.NEVER;
    }
    return value;
  });

export const openSolarSchema = z
  .object({
    openSolarProjectId: openSolarId,
    proposalId: openSolarId,
    signedUrl: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .transform((value, ctx) => {
        if (!value) return null;
        if (!z.url({ protocol: /^https$/ }).safeParse(value).success) {
          ctx.addIssue({ code: 'custom', message: 'Paste the full https:// link.' });
          return z.NEVER;
        }
        return value;
      }),
    contractSigned: z.boolean().default(false),
    contractSignedDate: optionalDate,
  })
  .superRefine((openSolar, ctx) => {
    if (openSolar.contractSigned && !openSolar.contractSignedDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['contractSignedDate'],
        message: 'When was it signed?',
      });
    }
    if (!openSolar.contractSigned && openSolar.contractSignedDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['contractSigned'],
        message: 'Tick "Contract signed" or clear the date.',
      });
    }
    notInFuture(ctx, openSolar.contractSignedDate, 'contractSignedDate', 'signed date');
  });

export type OpenSolarInput = z.input<typeof openSolarSchema>;
export type OpenSolarValues = z.output<typeof openSolarSchema>;
