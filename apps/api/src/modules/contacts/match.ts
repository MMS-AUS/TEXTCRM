import { and, eq, isNull, or } from 'drizzle-orm';
import { anyEmailMatches } from '../emails.ts';
import type { Db, Tx } from '../../db/client.ts';
import { contacts } from '../../db/schema/index.ts';

/** An active contact with the same email (primary or extra) or mobile (§1.4 duplicate rules), if any. */
export async function findMatchingContact(
  db: Db | Tx,
  details: { email: string | null; extraEmails?: readonly string[] | null; mobile: string | null },
) {
  const same = or(
    anyEmailMatches(contacts.email, contacts.extraEmails, [
      details.email,
      ...(details.extraEmails ?? []),
    ]),
    details.mobile ? eq(contacts.mobile, details.mobile) : undefined,
  );
  if (!same) return null;
  const [contact] = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(and(isNull(contacts.archivedAt), same))
    .limit(1);
  return contact ?? null;
}
