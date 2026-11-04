import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns.ts';
import { users } from './users.ts';

/**
 * The business's own details (Step 2.10): one row, used on documents and emails later.
 * `id` is always true, so a second row can't exist.
 */
export const companyProfile = pgTable(
  'company_profile',
  {
    id: boolean().primaryKey().default(true),
    legalName: text().notNull(),
    tradingName: text(),
    abn: text(),
    phone: text(),
    email: text(),
    website: text(),
    streetAddress: text(),
    suburb: text(),
    state: text(),
    postcode: text(),
    /** Electrical contractor licence number(s). */
    electricalLicence: text(),
    /** Clean Energy Council retailer / installer accreditation. */
    cecAccreditation: text(),
    updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [check('company_profile_single_row', sql`${t.id}`)],
);
