import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { companies, contacts, leads, projects, tickets } from '../db/schema/index.ts';

/** Every record type that timelines and files can attach to. */
export type EntityType = 'lead' | 'contact' | 'company' | 'project' | 'ticket';

const TABLES = {
  lead: leads,
  contact: contacts,
  company: companies,
  project: projects,
  ticket: tickets,
};

/**
 * Rejects work on a record that doesn't exist. Activities and files point at records
 * polymorphically (no foreign key), so the API checks instead.
 */
export async function assertEntityExists(
  db: Db | Tx,
  entityType: EntityType,
  entityId: string,
): Promise<void> {
  const table = TABLES[entityType];
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, entityId));
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `This ${entityType} does not exist.` });
  }
}
