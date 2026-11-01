import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { e164Check, id, lowercaseEmailCheck, money, timestamps, tstz } from './_columns.ts';
import { users } from './users.ts';

export const companies = pgTable(
  'companies',
  {
    id: id(),
    name: text().notNull(),
    /** Option value from `companyTypes`. */
    type: text(),
    /** 11 digits, no spaces. Validated with the ABN checksum in the API (abnValidator.ts). */
    abn: text(),
    abnVerified: boolean().notNull().default(false),
    phone: text(),
    email: text(),
    website: text(),
    streetAddress: text(),
    suburb: text(),
    state: text(),
    postcode: text(),
    country: text().notNull().default('Australia'),
    cecAccredited: boolean().notNull().default(false),
    creditLimitAud: money(),
    ownerUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    openSolarId: text(),
    notes: text(),
    archivedAt: tstz(),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('companies_name_idx').on(t.name),
    index('companies_abn_idx').on(t.abn),
    check('companies_abn_format', sql`${t.abn} ~ '^[0-9]{11}$'`),
    check('companies_email_lowercase', lowercaseEmailCheck(t.email)),
  ],
);

/** People. A contact can own several properties (contact_addresses) and have many leads/projects. */
export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    firstName: text().notNull(),
    lastName: text(),
    email: text(),
    /** E.164, e.g. +61412345678. */
    mobile: text(),
    secondaryMobile: text(),
    /** Option value from `contactTypes`. */
    type: text().notNull().default('Residential'),
    companyId: uuid().references(() => companies.id, { onDelete: 'set null' }),
    ownerUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Where the contact came from, e.g. 'Sheet import', 'Manual', 'OpenSolar'. */
    source: text(),
    openSolarContactId: text(),
    notes: text(),
    lastContactedAt: tstz(),
    archivedAt: tstz(),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('contacts_email_idx').on(t.email),
    index('contacts_mobile_idx').on(t.mobile),
    index('contacts_company_idx').on(t.companyId),
    index('contacts_name_idx').on(t.lastName, t.firstName),
    check('contacts_email_lowercase', lowercaseEmailCheck(t.email)),
    check('contacts_mobile_e164', e164Check(t.mobile)),
    check('contacts_secondary_mobile_e164', e164Check(t.secondaryMobile)),
  ],
);

export const contactAddresses = pgTable(
  'contact_addresses',
  {
    id: id(),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    /** e.g. 'Primary Residence', 'Investment Property'. */
    propertyType: text(),
    streetAddress: text().notNull(),
    suburb: text().notNull(),
    /** Option value from `states`. */
    state: text().notNull(),
    postcode: text(),
    /** Option value from `areas`. */
    area: text(),
    nearestBigCity: text(),
    /** True when confirmed via address autocomplete; false for manual entry. */
    addressVerified: boolean().notNull().default(false),
    isPrimary: boolean().notNull().default(false),
    notes: text(),
    ...timestamps,
  },
  (t) => [
    index('contact_addresses_contact_idx').on(t.contactId),
    uniqueIndex('contact_addresses_one_primary_idx')
      .on(t.contactId)
      .where(sql`${t.isPrimary}`),
  ],
);
