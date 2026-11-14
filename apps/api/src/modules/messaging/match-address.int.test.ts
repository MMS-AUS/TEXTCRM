import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { contacts, leads } from '../../db/schema/index.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { matchAddress } from './inbox.ts';

describe('matching an email address to a customer', () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it('finds a contact by its primary or any extra email, and a lead by its extra email', async () => {
    const [contact] = await db
      .insert(contacts)
      .values({
        firstName: 'Mia',
        email: 'mia@home.example',
        extraEmails: ['mia@work.example'],
        type: 'Residential',
      })
      .returning({ id: contacts.id });
    const [lead] = await db
      .insert(leads)
      .values({
        firstName: 'Ned',
        email: 'ned@home.example',
        extraEmails: ['ned@work.example'],
      })
      .returning({ id: leads.id });

    expect(await matchAddress(db, 'mia@home.example')).toMatchObject({
      entityType: 'contact',
      entityId: contact?.id,
    });
    expect(await matchAddress(db, 'mia@work.example')).toMatchObject({
      entityType: 'contact',
      entityId: contact?.id,
    });
    expect(await matchAddress(db, 'ned@work.example')).toMatchObject({
      entityType: 'lead',
      entityId: lead?.id,
    });
    expect(await matchAddress(db, 'stranger@example.com')).toBeNull();
  });
});
