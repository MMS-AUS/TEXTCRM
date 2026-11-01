import { numeric, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_columns.ts';

// Catalog items are never deleted (projects reference them) — superseded items get archivedAt.
// `source` records where a row came from: 'legacy-seed', 'cec-import' (Task T-12) or 'manual'.

export const hardwarePanels = pgTable(
  'hardware_panels',
  {
    id: id(),
    manufacturer: text().notNull(),
    model: text().notNull(),
    series: text(),
    sizeW: numeric({ precision: 8, scale: 2 }).notNull(),
    source: text().notNull().default('manual'),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [unique('hardware_panels_manufacturer_model_unique').on(t.manufacturer, t.model)],
);

export const hardwareInverters = pgTable(
  'hardware_inverters',
  {
    id: id(),
    manufacturer: text().notNull(),
    model: text().notNull(),
    series: text(),
    sizeKw: numeric({ precision: 8, scale: 3 }).notNull(),
    source: text().notNull().default('manual'),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [unique('hardware_inverters_manufacturer_model_unique').on(t.manufacturer, t.model)],
);

export const hardwareBatteries = pgTable(
  'hardware_batteries',
  {
    id: id(),
    manufacturer: text().notNull(),
    model: text().notNull(),
    series: text(),
    usableCapacityKwh: numeric({ precision: 8, scale: 2 }).notNull(),
    /** Free-text size description from the catalog, e.g. '9.6kWh System'. */
    sizeLabel: text(),
    source: text().notNull().default('manual'),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [unique('hardware_batteries_manufacturer_model_unique').on(t.manufacturer, t.model)],
);
