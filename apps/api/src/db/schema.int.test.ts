import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, truncateAll } from '../test/db.ts';
import { contactAddresses, contacts, leads, projects } from './schema/index.ts';

// Database-level guarantees the API relies on (§1.4).
describe('schema constraints', () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function newContact() {
    const [c] = await db.insert(contacts).values({ firstName: 'Test' }).returning();
    if (!c) throw new Error('insert failed');
    return c;
  }

  it('rejects emails that are not trimmed and lower-cased', async () => {
    await expect(
      db.insert(contacts).values({ firstName: 'A', email: 'Someone@Example.com' }),
    ).rejects.toThrow();
    await expect(
      db.insert(contacts).values({ firstName: 'A', email: 'someone@example.com' }),
    ).resolves.toBeDefined();
  });

  it('rejects phone numbers that are not E.164', async () => {
    await expect(
      db.insert(leads).values({ firstName: 'A', mobile: '0412 345 678' }),
    ).rejects.toThrow();
    await expect(
      db.insert(leads).values({ firstName: 'A', mobile: '+61412345678' }),
    ).resolves.toBeDefined();
  });

  it('allows only one primary address per contact', async () => {
    const c = await newContact();
    const address = { contactId: c.id, streetAddress: '1 Main St', suburb: 'Sydney', state: 'NSW' };
    await db.insert(contactAddresses).values({ ...address, isPrimary: true });
    await db.insert(contactAddresses).values({ ...address, isPrimary: false });
    await expect(
      db.insert(contactAddresses).values({ ...address, isPrimary: true }),
    ).rejects.toThrow();
  });

  it('makes converting the same lead twice impossible', async () => {
    const c = await newContact();
    const [lead] = await db.insert(leads).values({ firstName: 'A', contactId: c.id }).returning();
    if (!lead) throw new Error('insert failed');
    const project = {
      contactId: c.id,
      leadId: lead.id,
      streetAddress: '1 Main St',
      suburb: 'Sydney',
      state: 'NSW',
    };
    await db.insert(projects).values({ ...project, projectNumber: 'P-1' });
    await expect(
      db.insert(projects).values({ ...project, projectNumber: 'P-2' }),
    ).rejects.toThrow();
  });

  it('applies workflow defaults', async () => {
    const c = await newContact();
    const [lead] = await db.insert(leads).values({ firstName: 'A' }).returning();
    const [project] = await db
      .insert(projects)
      .values({
        contactId: c.id,
        projectNumber: 'P-1',
        streetAddress: 'x',
        suburb: 'y',
        state: 'NSW',
      })
      .returning();
    expect(lead?.status).toBe('New');
    expect(project?.status).toBe('Active');
    expect(project?.stage).toBe('Engineering & DNSP Approval');
  });
});
