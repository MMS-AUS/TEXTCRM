import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { day, id, money, timestamps, tstz } from './_columns.ts';
import { companies, contacts } from './contacts.ts';
import { projects } from './projects.ts';
import { users } from './users.ts';

/**
 * Service ticket core (§1.4 workflow). Customer and installation details come from the linked
 * contact/project. Triage fields hold option values from the ticket* lists.
 */
export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    ticketNumber: text().notNull().unique('tickets_ticket_number_unique'),
    projectId: uuid().references(() => projects.id, { onDelete: 'set null' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    title: text().notNull(),
    description: text(),
    category: text(),
    priority: text().notNull().default('Medium'),

    issueRecorded: text(),
    initialCheck: text(),
    workRequired: text(),
    resolutionStatus: text().notNull().default('Under Investigation'),
    serviceIssueNotes: text(),

    /** Service handler / technician. */
    assignedUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    resolvedDate: day(),
    closedAt: tstz(),
    serviceChargeAud: money(),

    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('tickets_project_idx').on(t.projectId),
    index('tickets_contact_idx').on(t.contactId),
    index('tickets_priority_idx').on(t.priority),
    index('tickets_resolution_status_idx').on(t.resolutionStatus),
    index('tickets_assigned_user_idx').on(t.assignedUserId),
    // Open tickets by priority and age (list default, dashboard).
    index('tickets_open_idx').on(t.closedAt, t.priority, t.createdAt),
  ],
);

export const hardwareKind = pgEnum('hardware_kind', ['panel', 'inverter', 'battery']);
export const ticketHardwareRole = pgEnum('ticket_hardware_role', ['existing', 'replaced']);

/**
 * Existing / replaced equipment rows. Free text, not catalog references: what is on the roof
 * may predate or sit outside the catalog.
 */
export const ticketHardware = pgTable(
  'ticket_hardware',
  {
    id: id(),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    role: ticketHardwareRole().notNull(),
    kind: hardwareKind().notNull(),
    quantity: integer().notNull().default(1),
    brand: text(),
    model: text(),
    size: text(),
    serialNumbers: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text(),
    ...timestamps,
  },
  (t) => [
    index('ticket_hardware_ticket_idx').on(t.ticketId),
    check('ticket_hardware_quantity_non_negative', sql`${t.quantity} >= 0`),
  ],
);

export const ticketWarrantyClaims = pgTable(
  'ticket_warranty_claims',
  {
    id: id(),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    claimDate: day(),
    claimReference: text(),
    /** Option value from `ticketWarrantyClaimStatuses`. */
    status: text(),
    invoiceNumber: text(),
    invoiceAmountAud: money(),
    /** Option value from `ticketWarrantyClaimInvoiceStatuses`. */
    invoiceStatus: text(),
    brandNotes: text(),
    ...timestamps,
  },
  (t) => [index('ticket_warranty_claims_ticket_idx').on(t.ticketId)],
);

export const ticketInstallerVisits = pgTable(
  'ticket_installer_visits',
  {
    id: id(),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    isSubcontractor: boolean().notNull().default(true),
    installerCompanyId: uuid().references(() => companies.id, { onDelete: 'set null' }),
    installerName: text(),
    phone: text(),
    email: text(),
    visitDate: day(),
    notes: text(),
    invoiceDate: day(),
    invoiceNumber: text(),
    invoiceAmountAud: money(),
    invoiceStatus: text(),
    ...timestamps,
  },
  (t) => [index('ticket_installer_visits_ticket_idx').on(t.ticketId)],
);
