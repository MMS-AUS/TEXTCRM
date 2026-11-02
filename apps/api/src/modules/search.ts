import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** `%term%` with LIKE wildcards in the user's text escaped. */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Matches stored E.164 phone numbers against whatever the user typed: "0412 345", "412345",
 * "+61 412". Needs at least 4 digits, otherwise returns undefined (no phone condition).
 */
export function phoneContains(column: AnyPgColumn, term: string): SQL | undefined {
  let digits = term.replace(/\D/g, '');
  if (digits.length < 4) return undefined;
  if (digits.startsWith('61')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return sql`${column} like ${containsPattern(digits)}`;
}
