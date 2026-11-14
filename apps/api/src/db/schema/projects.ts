import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { day, id, money, timestamps, tstz } from './_columns.ts';
import { companies, contacts } from './contacts.ts';
import { hardwareBatteries, hardwareInverters, hardwarePanels } from './hardware.ts';
import { leads } from './leads.ts';
import { users } from './users.ts';

/**
 * Project core + customer & site (§1.4). The old 170-field record is split into one 1:1 table
 * per workspace section below. Customer name/email/phone come from the linked contact.
 * Computed values (balance payable, remaining payment, total STC received, completed month)
 * are derived on the server, not stored.
 */
export const projects = pgTable(
  'projects',
  {
    id: id(),
    projectNumber: text().notNull().unique('projects_project_number_unique'),
    title: text(),
    /** Unique: converting a lead twice is impossible (§1.4). */
    leadId: uuid()
      .unique('projects_lead_id_unique')
      .references(() => leads.id, { onDelete: 'set null' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    companyId: uuid().references(() => companies.id, { onDelete: 'set null' }),

    /** Option value from `projectStatuses`. */
    status: text().notNull().default('Active'),
    /** Option value from `projectStages`. */
    stage: text().notNull().default('Engineering & DNSP Approval'),
    salesUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    saleDate: day(),
    closedAt: tstz(),

    // Customer & site
    streetAddress: text().notNull(),
    suburb: text().notNull(),
    state: text().notNull(),
    postcode: text(),
    area: text(),
    nearestBigCity: text(),
    houseStorey: text(),
    roofType: text(),
    phase: text(),
    existingSystemDetails: text(),
    managerRenteeFirstName: text(),
    managerRenteeLastName: text(),
    nmi: text(),
    notes: text(),

    // Meta attribution (for Conversions API later).
    metaLeadgenId: text(),
    fbclid: text(),
    fbp: text(),
    soldAt: tstz(),

    deletedAt: tstz(),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('projects_status_idx').on(t.status),
    index('projects_stage_idx').on(t.stage),
    // Dashboard (Step 2.9): revenue by sale month.
    index('projects_sale_date_idx').on(t.saleDate),
    index('projects_contact_idx').on(t.contactId),
    index('projects_sales_user_idx').on(t.salesUserId),
  ],
);

const projectIdPk = () =>
  uuid()
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' });

export const projectSystemDesign = pgTable(
  'project_system_design',
  {
    projectId: projectIdPk(),
    systemSizeKw: numeric({ precision: 8, scale: 2 }),
    panelId: uuid().references(() => hardwarePanels.id, { onDelete: 'restrict' }),
    panelCount: integer(),
    batteryId: uuid().references(() => hardwareBatteries.id, { onDelete: 'restrict' }),
    batteryCount: integer(),
    ...timestamps,
  },
  (t) => [
    check(
      'project_system_design_counts_non_negative',
      sql`coalesce(${t.panelCount}, 0) >= 0 and coalesce(${t.batteryCount}, 0) >= 0`,
    ),
  ],
);

/** An inverter on a project's system design: a copy of the lead's lines, editable afterwards. */
export const projectSystemInverters = pgTable(
  'project_system_inverters',
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    position: integer().notNull().default(0),
    inverterId: uuid()
      .notNull()
      .references(() => hardwareInverters.id, { onDelete: 'restrict' }),
    count: integer().notNull().default(1),
    /** 'grid' or 'hybrid'. */
    type: text().notNull().default('grid'),
    ...timestamps,
  },
  (t) => [
    index('project_system_inverters_project_idx').on(t.projectId, t.position),
    check('project_system_inverters_count_positive', sql`${t.count} > 0`),
    check('project_system_inverters_type', sql`${t.type} in ('grid', 'hybrid')`),
  ],
);

export const projectPricing = pgTable('project_pricing', {
  projectId: projectIdPk(),
  systemPriceAud: money(),
  sellingPriceAud: money(),
  contractValueAud: money(),
  depositAud: money(),
  depositReceivedDate: day(),
  balanceDueDate: day(),
  customerInvoiceNumber: text(),
  xeroInvoiceId: text(),
  xeroInvoiceNumber: text(),
  xeroInvoiceStatus: text(),
  ...timestamps,
});

/** Electricity-bill verification: the six checks (§1.4). Values from the eb*Options lists. */
export const projectEbVerification = pgTable('project_eb_verification', {
  projectId: projectIdPk(),
  customerNameMatch: text(),
  addressMatch: text(),
  meterMatch: text(),
  meterPhase: text(),
  openSolarSystemMatch: text(),
  openSolarPricingMatch: text(),
  docsReceived: text(),
  docsReceivedDate: day(),
  verifiedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
  verifiedAt: tstz(),
  ...timestamps,
});

export const projectGridApplications = pgTable('project_grid_applications', {
  projectId: projectIdPk(),
  /** DNSP — option value from `electricityDistributors`. */
  electricityDistributor: text(),
  applicationRef: text(),
  /** Option value from `gridApplicationStatuses`. */
  status: text(),
  appliedDate: day(),
  approvalDate: day(),
  rejectedDate: day(),
  energyRetailer: text(),
  retailerRef: text(),
  ...timestamps,
});

export const projectFinance = pgTable('project_finance', {
  projectId: projectIdPk(),
  /** Option value from `isFinanceOptions`. */
  financeOption: text(),
  financeCompany: text(),
  status: text(),
  appliedDate: day(),
  approvedDate: day(),
  approvedAmountAud: money(),
  ...timestamps,
});

export const projectWarehouse = pgTable('project_warehouse', {
  projectId: projectIdPk(),
  warehouse: text(),
  salesOrderNumber: text(),
  invoiceDate: day(),
  invoiceNumber: text(),
  invoiceAmountAud: money(),
  invoiceStatus: text(),
  invoicePaidDate: day(),
  stockStatus: text(),
  /** Legacy `stockUsedProject` free text — meaning to confirm with Operations. */
  stockUsedProject: text(),
  ...timestamps,
});

export const projectInstallation = pgTable(
  'project_installation',
  {
    projectId: projectIdPk(),
    /** Option value from `installationStatuses`. */
    status: text(),
    bookingDate: day(),
    bookedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** The legacy "completed month" is derived from this date. */
    completedDate: day(),
    /** Subcontractor installer = a company of type 'Subcontractor Installer'. */
    installerCompanyId: uuid().references(() => companies.id, { onDelete: 'set null' }),
    installerQuotedAud: money(),
    docsStatus: text(),
    docsReceivedDate: day(),
    installerInvoiceDate: day(),
    installerInvoiceNumber: text(),
    installerInvoiceAmountAud: money(),
    installerInvoiceStatus: text(),
    ...timestamps,
  },
  // Dashboard (Step 2.9): installs this month.
  (t) => [index('project_installation_completed_idx').on(t.completedDate, t.bookingDate)],
);

export const projectStcClaims = pgTable('project_stc_claims', {
  projectId: projectIdPk(),
  /** Option value from `stcPortals`. */
  portal: text(),
  jobNumber: text(),
  /** Option value from `stcStatuses`. */
  status: text(),
  submittedDate: day(),
  solarStcs: integer(),
  solarStcsAmountAud: money(),
  solarStcsReceivedDate: day(),
  batteryStcs: integer(),
  batteryStcsAmountAud: money(),
  batteryStcsReceivedDate: day(),
  adminChargesAud: money(),
  customerStcRateAud: money(),
  internalStcRateAud: money(),
  bridgeselectSyncStatus: text(),
  bridgeselectSyncedAt: tstz(),
  bridgeselectError: text(),
  ...timestamps,
});

export const projectOpenSolar = pgTable('project_opensolar', {
  projectId: projectIdPk(),
  openSolarProjectId: text(),
  proposalId: text(),
  signedUrl: text(),
  contractSigned: boolean().notNull().default(false),
  contractSignedAt: tstz(),
  lastSyncedAt: tstz(),
  ...timestamps,
});
