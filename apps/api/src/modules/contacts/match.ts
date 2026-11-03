import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.ts';
import { contacts } from '../../db/schema/index.ts';

/** An active contact with the same email or mobile (§1.4 duplicate rules), if any. */
export async function findMatchingContact(
  db: Db | Tx,
  details: { email: string | null; mobile: string | null },
) {
  const same = or(
    details.email ? eq(contacts.email, details.email) : undefined,
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
