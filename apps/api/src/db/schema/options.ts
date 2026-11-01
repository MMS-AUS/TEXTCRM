import { index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_columns.ts';

/** Admin-managed dropdown lists (§1.6), e.g. key 'leadStatuses'. */
export const optionLists = pgTable('option_lists', {
  id: id(),
  key: text().notNull().unique(),
  name: text().notNull(),
  description: text(),
  ...timestamps,
});

/**
 * Records store the option `value` (stable), the UI shows `label` (renameable).
 * Archived options stay valid on old records but are hidden from pickers.
 */
export const options = pgTable(
  'options',
  {
    id: id(),
    listId: uuid()
      .notNull()
      .references(() => optionLists.id, { onDelete: 'cascade' }),
    value: text().notNull(),
    label: text().notNull(),
    sortOrder: integer().notNull().default(0),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('options_list_value_unique').on(t.listId, t.value),
    index('options_list_sort_idx').on(t.listId, t.sortOrder),
  ],
);
