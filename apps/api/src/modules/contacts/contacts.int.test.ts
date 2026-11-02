import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix, type PermissionMatrix } from '@mms/shared';
import { auditLog, contactAddresses } from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';

const createCaller = createCallerFactory(appRouter);

describe('contacts', () => {
  const db = createTestDb();
  let userId = '';

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: userId } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
  });
  afterAll(() => db.$client.end());

  function callerWith(permissions: PermissionMatrix = allPermissions()) {
    const user = fakeUser({ id: userId, permissions });
    return createCaller(fakeContext({ status: 'authenticated', user, firebaseUid: 'uid' }, { db }));
  }

  const olivia = {
    firstName: 'Olivia',
    lastName: 'Nguyen',
    email: 'Olivia@Example.com',
    mobile: '0412 345 678',
    type: 'Residential',
  };

  const parramatta = {
    streetAddress: '12 Church St',
    suburb: 'Parramatta',
    state: 'NSW' as const,
    postcode: '2150',
  };

  it('creates a normalised contact and records who did it', async () => {
    const api = callerWith();
    const { id } = await api.contacts.create(olivia);
    const contact = await api.contacts.get({ id });
    expect(contact).toMatchObject({
      email: 'olivia@example.com',
      mobile: '+61412345678',
      source: 'Manual',
      createdByName: 'Micky',
    });
    expect(contact.history[0]).toMatchObject({ action: 'create', actorName: 'Micky' });
  });

  it('refuses a duplicate email or mobile with a helpful message', async () => {
    const api = callerWith();
    await api.contacts.create(olivia);
    const duplicate = api.contacts.create({
      firstName: 'O',
      mobile: '+61 412 345 678',
      type: 'Residential',
    });
    await expect(duplicate).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(duplicate).rejects.toThrow(/Olivia Nguyen already has this mobile/);
  });

  it('only accepts contact types from the option list', async () => {
    await expect(callerWith().contacts.create({ ...olivia, type: 'Alien' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('searches by name, phone digits and suburb, and sorts and pages server-side', async () => {
    const api = callerWith();
    const { id } = await api.contacts.create(olivia);
    await api.contacts.addAddress({ contactId: id, address: parramatta });
    await api.contacts.create({
      firstName: 'Jack',
      lastName: 'Patel',
      email: 'jack@example.com',
      type: 'Commercial',
    });
    await api.contacts.create({
      firstName: 'Amelia',
      email: 'amelia@example.com',
      type: 'Residential',
    });

    const names = async (input: Parameters<typeof api.contacts.list>[0]) =>
      (await api.contacts.list(input)).rows.map((row) => row.firstName);

    expect(await names({ search: 'olivia ngu' })).toEqual(['Olivia']);
    expect(await names({ search: '0412 345' })).toEqual(['Olivia']);
    expect(await names({ search: 'parra' })).toEqual(['Olivia']);
    expect(await names({ type: 'Commercial' })).toEqual(['Jack']);
    expect(await names({ sort: { id: 'name', desc: false } })).toEqual([
      'Amelia',
      'Jack',
      'Olivia',
    ]);

    const page = await api.contacts.list({
      sort: { id: 'name', desc: false },
      page: 1,
      pageSize: 2,
    });
    expect(page).toMatchObject({ total: 3, rows: [{ firstName: 'Olivia', suburb: 'Parramatta' }] });
  });

  it('records only changed fields on update, and blocks edits once archived', async () => {
    const api = callerWith();
    const { id } = await api.contacts.create(olivia);
    await api.contacts.update({ id, values: { ...olivia, lastName: 'Tran' } });

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'update')));
    expect(entry?.changes).toEqual({ before: { lastName: 'Nguyen' }, after: { lastName: 'Tran' } });

    await api.contacts.archive({ id });
    expect((await api.contacts.list({})).total).toBe(0);
    expect((await api.contacts.list({ archived: true })).total).toBe(1);
    await expect(api.contacts.update({ id, values: olivia })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await api.contacts.restore({ id });
    expect((await api.contacts.list({})).total).toBe(1);
  });

  it('keeps exactly one primary address and works out area and nearest city', async () => {
    const api = callerWith();
    const { id } = await api.contacts.create(olivia);
    const first = await api.contacts.addAddress({ contactId: id, address: parramatta });
    await api.contacts.addAddress({
      contactId: id,
      address: {
        streetAddress: '3 Ruthven St',
        suburb: 'Toowoomba',
        state: 'QLD',
        postcode: '4350',
        isPrimary: true,
      },
    });

    let addresses = (await api.contacts.get({ id })).addresses;
    expect(addresses.map((a) => [a.suburb, a.isPrimary, a.area, a.nearestBigCity])).toEqual([
      ['Toowoomba', true, 'Regional', 'Toowoomba'],
      ['Parramatta', false, 'Metro', 'Sydney'],
    ]);

    const toowoomba = addresses[0];
    if (!toowoomba) throw new Error('missing address');
    await api.contacts.removeAddress({ id: toowoomba.id });
    addresses = (await api.contacts.get({ id })).addresses;
    expect(addresses).toMatchObject([{ id: first.id, isPrimary: true }]);

    const stored = await db
      .select()
      .from(contactAddresses)
      .where(eq(contactAddresses.contactId, id));
    expect(stored).toHaveLength(1);
  });

  it('rejects a postcode from another state', async () => {
    const api = callerWith();
    const { id } = await api.contacts.create(olivia);
    await expect(
      api.contacts.addAddress({ contactId: id, address: { ...parramatta, state: 'VIC' } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('enforces permissions per action', async () => {
    const viewOnly = emptyPermissionMatrix();
    viewOnly.contacts = { ...viewOnly.contacts, view: true };
    const api = callerWith(viewOnly);
    expect((await api.contacts.list({})).total).toBe(0);
    await expect(api.contacts.create(olivia)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('only shows linked records the user may see', async () => {
    const permissions = allPermissions();
    permissions.projects = { ...permissions.projects, view: false };
    const { id } = await callerWith().contacts.create(olivia);
    const contact = await callerWith(permissions).contacts.get({ id });
    expect(contact.leads).toEqual([]);
    expect(contact.projects).toBeNull();
  });
});
