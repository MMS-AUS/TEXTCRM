import { inArray, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * A condition matching any of these addresses on a record's primary email or its extra emails
 * (a text[] column). Undefined when there are no addresses, so it drops out of `or(...)`.
 */
export function anyEmailMatches(
  emailColumn: AnyColumn,
  extraEmailsColumn: AnyColumn,
  emails: readonly (string | null | undefined)[],
): SQL | undefined {
  const wanted = [...new Set(emails.filter((email): email is string => Boolean(email)))];
  if (wanted.length === 0) return undefined;
  return or(
    inArray(emailColumn, wanted),
    sql`${extraEmailsColumn} && array[${sql.join(
      wanted.map((email) => sql`${email}`),
      sql`, `,
    )}]::text[]`,
  );
}

/** Search text found in any extra email of a record. */
export const extraEmailsLike = (extraEmailsColumn: AnyColumn, pattern: string): SQL =>
  sql`array_to_string(${extraEmailsColumn}, ' ') ilike ${pattern}`;
