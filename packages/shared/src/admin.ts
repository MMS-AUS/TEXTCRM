import { z } from 'zod';
import { AU_STATES, parseAbn } from './au.ts';
import { optionalEmail, optionalText } from './contacts.ts';
import { decimalField } from './lead-details.ts';
import {
  FEATURES,
  PERMISSION_ACTIONS,
  type Feature,
  type PermissionAction,
} from './permissions.ts';

// Settings → admin (Step 2.10): users, roles & permissions, option lists, hardware catalog,
// company profile. Every rule is enforced on the server; these schemas are shared with forms.

export const FEATURE_LABELS: Record<Feature, string> = {
  dashboard: 'Dashboard',
  leads: 'Leads',
  contacts: 'Contacts',
  companies: 'Companies',
  projects: 'Projects',
  tickets: 'Tickets',
  files: 'Files',
  reports: 'Reports',
  users: 'Users',
  roles: 'Roles & permissions',
  option_lists: 'Option lists',
  hardware: 'Hardware catalogue',
  integrations: 'Integrations, imports & jobs',
  audit_log: 'Audit log',
};

export const PERMISSION_ACTION_LABELS: Record<PermissionAction, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  export: 'Export',
};

// ── Users ────────────────────────────────────────────────────────────────

const personName = z.string().trim().min(1, 'Enter their name.').max(100);

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter their work email.')),
  name: personName,
  roleId: z.uuid({ error: 'Choose a role.' }),
});
export type InviteUserInput = z.input<typeof inviteUserSchema>;

export const updateUserSchema = z.object({
  name: personName,
  roleId: z.uuid({ error: 'Choose a role.' }),
  phone: optionalText(50),
  department: optionalText(100),
});
export type UpdateUserInput = z.input<typeof updateUserSchema>;

// ── Roles ────────────────────────────────────────────────────────────────

export const roleInputSchema = z.object({
  name: z.string().trim().min(1, 'Name the role.').max(60),
  description: optionalText(300),
});
export type RoleInput = z.input<typeof roleInputSchema>;

const actionsSchema = z.object(
  Object.fromEntries(PERMISSION_ACTIONS.map((a) => [a, z.boolean()])) as Record<
    PermissionAction,
    z.ZodBoolean
  >,
);

export const permissionMatrixSchema = z.object(
  Object.fromEntries(FEATURES.map((f) => [f, actionsSchema])) as Record<
    Feature,
    typeof actionsSchema
  >,
);

/**
 * Any create/edit/delete/export needs view (you can't change what you can't see). Returns the
 * matrix with view switched on where another action is on.
 */
export function normaliseMatrix<T extends Record<string, Record<PermissionAction, boolean>>>(
  matrix: T,
): T {
  const copy = structuredClone(matrix);
  for (const perms of Object.values(copy)) {
    if (perms.create || perms.edit || perms.delete || perms.export) perms.view = true;
  }
  return copy;
}

// ── Option lists ─────────────────────────────────────────────────────────

export const optionLabelSchema = z.object({
  label: z.string().trim().min(1, 'Type the option.').max(150),
});

// ── Hardware catalogue ───────────────────────────────────────────────────

export const HARDWARE_CATALOG_KINDS = ['panel', 'inverter', 'battery'] as const;
export type HardwareCatalogKind = (typeof HARDWARE_CATALOG_KINDS)[number];

const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `Enter the ${label}.`).max(max);
const sizeField = (label: string, max: number, scale: number) =>
  decimalField({ max, scale, label }).refine((value) => value !== null && Number(value) > 0, {
    message: `Enter the ${label}.`,
  });

const hardwareBase = {
  manufacturer: requiredText('manufacturer', 150),
  model: requiredText('model', 200),
  series: optionalText(150),
};

export const hardwareItemSchemas = {
  panel: z.object({ ...hardwareBase, sizeW: sizeField('panel size (W)', 2000, 2) }),
  inverter: z.object({ ...hardwareBase, sizeKw: sizeField('inverter size (kW)', 1000, 3) }),
  battery: z.object({
    ...hardwareBase,
    usableCapacityKwh: sizeField('usable capacity (kWh)', 1000, 2),
    sizeLabel: optionalText(100),
  }),
} as const;

export const hardwareSaveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('panel'),
    id: z.uuid().optional(),
    values: hardwareItemSchemas.panel,
  }),
  z.object({
    kind: z.literal('inverter'),
    id: z.uuid().optional(),
    values: hardwareItemSchemas.inverter,
  }),
  z.object({
    kind: z.literal('battery'),
    id: z.uuid().optional(),
    values: hardwareItemSchemas.battery,
  }),
]);
export type HardwareSaveInput = z.input<typeof hardwareSaveSchema>;

export const hardwareListInputSchema = z.object({
  kind: z.enum(HARDWARE_CATALOG_KINDS),
  search: z.string().trim().max(100).default(''),
  archived: z.boolean().default(false),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(50),
});

// ── Company profile ──────────────────────────────────────────────────────

export const companyProfileSchema = z.object({
  legalName: z.string().trim().min(1, 'Enter the legal business name.').max(200),
  tradingName: optionalText(200),
  abn: z
    .string()
    .trim()
    .nullish()
    .transform((value, ctx) => {
      if (!value) return null;
      const parsed = parseAbn(value);
      if (!parsed.ok) {
        ctx.addIssue({ code: 'custom', message: parsed.error });
        return z.NEVER;
      }
      return parsed.abn;
    }),
  phone: optionalText(50),
  email: optionalEmail,
  website: optionalText(200),
  streetAddress: optionalText(200),
  suburb: optionalText(100),
  state: z
    .enum(AU_STATES)
    .nullish()
    .or(z.literal(''))
    .transform((value) => value || null),
  postcode: z
    .string()
    .trim()
    .nullish()
    .or(z.literal(''))
    .transform((value) => value || null)
    .refine((value) => !value || /^\d{4}$/.test(value), 'A postcode has 4 digits.'),
  electricalLicence: optionalText(100),
  cecAccreditation: optionalText(100),
});
export type CompanyProfileInput = z.input<typeof companyProfileSchema>;
export type CompanyProfileValues = z.output<typeof companyProfileSchema>;

// ── Option list rules ────────────────────────────────────────────────────

/**
 * Lists whose values are fixed in code (a pipeline the app understands, or a legal set):
 * labels can be reworded, but options can't be added or archived.
 */
export const FIXED_OPTION_LISTS: readonly string[] = [
  'projectStages',
  'projectStatuses',
  'ticketPriorities',
  'states',
];

/** Values the app's rules rely on — they can be reworded but never archived. */
export const PROTECTED_OPTION_VALUES: Readonly<Record<string, readonly string[]>> = {
  leadStatuses: ['New', 'Converted to Project', 'Lost'],
  ticketIssueResolutionStatuses: [
    'Under Investigation',
    'Resolved - Complete Handover',
    'Claim Denied by Manufacturer',
    'Customer Closed',
  ],
  contactTypes: ['Residential'],
  companyTypes: ['Subcontractor Installer'],
  gridApplicationStatuses: ['Grid App Approved', 'Grid Rejected'],
  isFinanceOptions: ['No (Cash / Direct Payment)'],
};

export function optionProtection(listKey: string, value: string) {
  if (FIXED_OPTION_LISTS.includes(listKey)) return 'fixed-list' as const;
  if (PROTECTED_OPTION_VALUES[listKey]?.includes(value)) return 'protected' as const;
  return null;
}
