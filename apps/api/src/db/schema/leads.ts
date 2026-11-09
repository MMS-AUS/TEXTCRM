import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  day,
  e164Check,
  emailFormatCheck,
  id,
  lowercaseEmailCheck,
  money,
  timestamps,
  tstz,
} from './_columns.ts';
import { companies, contacts } from './contacts.ts';
import { hardwareBatteries, hardwareInverters, hardwarePanels } from './hardware.ts';
import { sheetSyncSources } from './imports.ts';
import { users } from './users.ts';

/**
 * Lead core. Person + property fields are the intake snapshot used by duplicate detection;
 * `contactId` links the lead to the de-duplicated person (same person, new property = new lead).
 * The project link lives on projects.lead_id (unique), so a lead converts at most once.
 */
export const leads = pgTable(
  'leads',
  {
    id: id(),
    contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    companyId: uuid().references(() => companies.id, { onDelete: 'set null' }),

    leadDate: day()
      .notNull()
      .default(sql`current_date`),
    /** Option value from `platforms`. */
    platform: text(),
    /** Option value from `leadSources`. */
    source: text(),
    /** Option value from `leadStatuses`. */
    status: text().notNull().default('New'),
    /** Sales person. */
    ownerUserId: uuid().references(() => users.id, { onDelete: 'set null' }),

    firstName: text().notNull(),
    lastName: text(),
    email: text(),
    /** A second address for the same customer (e.g. personal + work). */
    secondaryEmail: text(),
    mobile: text(),
    secondaryMobile: text(),
    managerRenteeFirstName: text(),
    managerRenteeLastName: text(),

    streetAddress: text(),
    suburb: text(),
    state: text(),
    postcode: text(),
    area: text(),
    nearestBigCity: text(),
    addressVerified: boolean().notNull().default(false),

    /** Option value from `docsReceivedOptions`. */
    docsReceived: text(),
    docsReceivedDate: day(),
    saleDate: day(),
    notes: text(),
    convertedAt: tstz(),

    /** Google Sheets `Lead ID` (§1.8); also kept when a one-off import maps a Lead ID column. */
    sheetLeadId: text(),
    /** The live sheet that owns `sheetLeadId` (Step 3.3); null for imported or typed-in leads. */
    sheetSourceId: uuid().references(() => sheetSyncSources.id, { onDelete: 'set null' }),
    /** Set on the first CRM edit — after that the sheet sync never touches this lead (§1.8 rule 2). */
    crmEditedAt: tstz(),

    // Meta attribution (for Conversions API later).
    metaLeadgenId: text(),
    fbclid: text(),
    fbp: text(),

    deletedAt: tstz(),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('leads_status_idx').on(t.status),
    index('leads_owner_idx').on(t.ownerUserId),
    index('leads_lead_date_idx').on(t.leadDate),
    index('leads_platform_idx').on(t.platform),
    // Dashboard (Step 2.9): conversions by salesperson.
    index('leads_converted_at_idx').on(t.convertedAt),
    index('leads_contact_idx').on(t.contactId),
    index('leads_email_idx').on(t.email),
    index('leads_mobile_idx').on(t.mobile),
    index('leads_sheet_lead_id_idx').on(t.sheetLeadId),
    // One lead per Lead ID per live sheet (§1.8 rule 1).
    uniqueIndex('leads_sheet_source_lead_id_unique')
      .on(t.sheetSourceId, t.sheetLeadId)
      .where(sql`${t.sheetSourceId} is not null`),
    check('leads_email_lowercase', lowercaseEmailCheck(t.email)),
    check('leads_secondary_email_lowercase', lowercaseEmailCheck(t.secondaryEmail)),
    check('leads_secondary_email_format', emailFormatCheck(t.secondaryEmail)),
    check('leads_mobile_e164', e164Check(t.mobile)),
    check('leads_secondary_mobile_e164', e164Check(t.secondaryMobile)),
  ],
);

export const leadSystemRequirements = pgTable(
  'lead_system_requirements',
  {
    leadId: uuid()
      .primaryKey()
      .references(() => leads.id, { onDelete: 'cascade' }),
    systemSizeKw: numeric({ precision: 8, scale: 2 }),
    batteryRequired: boolean().notNull().default(false),
    propertyType: text(),
    /** Option values from `roofTypes`, `houseStoreys`, `phases`. */
    roofType: text(),
    houseStorey: text(),
    phase: text(),
    existingSystemDetails: text(),
    quarterlyBillAud: money(),
    panelId: uuid().references(() => hardwarePanels.id, { onDelete: 'restrict' }),
    panelCount: integer(),
    inverterId: uuid().references(() => hardwareInverters.id, { onDelete: 'restrict' }),
    inverterCount: integer(),
    batteryId: uuid().references(() => hardwareBatteries.id, { onDelete: 'restrict' }),
    batteryCount: integer(),
    ...timestamps,
  },
  (t) => [
    check(
      'lead_system_requirements_counts_non_negative',
      sql`coalesce(${t.panelCount}, 0) >= 0 and coalesce(${t.inverterCount}, 0) >= 0 and coalesce(${t.batteryCount}, 0) >= 0`,
    ),
  ],
);

export const leadPricing = pgTable('lead_pricing', {
  leadId: uuid()
    .primaryKey()
    .references(() => leads.id, { onDelete: 'cascade' }),
  systemPriceAud: money(),
  /** After rebates. */
  sellingPriceAud: money(),
  depositAud: money(),
  depositReceivedDate: day(),
  ...timestamps,
});
