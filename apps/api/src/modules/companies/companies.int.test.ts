import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';

const createCaller = createCallerFactory(appRouter);

describe('companies', () => {
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

  const api = () =>
    createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id: userId, permissions: allPermissions() }),
          firebaseUid: 'uid',
        },
        { db },
      ),
    );

  const brightSolar = {
    name: 'Bright Solar Installs',
    type: 'Subcontractor Installer',
    abn: '51 824 753 556',
    phone: '(02) 9876 5432',
    website: 'brightsolar.com.au',
    state: 'NSW' as const,
  };

  it('creates a company with a checked ABN and normalised details', async () => {
    const { id } = await api().companies.create(brightSolar);
    const company = await api().companies.get({ id });
    expect(company).toMatchObject({
      abn: '51824753556',
      abnVerified: false,
      phone: '+61298765432',
      website: 'https://brightsolar.com.au',
      createdByName: 'Micky',
    });
  });

  it('keeps several emails as tags and finds the company by any of them', async () => {
    const { id } = await api().companies.create({
      ...brightSolar,
      email: 'Info@Bright.example accounts@bright.example',
    });
    expect(await api().companies.get({ id })).toMatchObject({
      email: 'info@bright.example',
      extraEmails: ['accounts@bright.example'],
    });
    const found = await api().companies.list({ search: 'accounts@bright' });
    expect(found.rows.map((row) => row.id)).toEqual([id]);
    await api().companies.update({
      id,
      values: { ...brightSolar, email: 'info@bright.example' },
    });
    expect((await api().companies.get({ id })).extraEmails).toEqual([]);
  });

  it('rejects an invalid ABN and a second company with the same ABN', async () => {
    await expect(
      api().companies.create({ ...brightSolar, abn: '51 824 753 557' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await api().companies.create(brightSolar);
    await expect(api().companies.create({ ...brightSolar, name: 'Copy' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('counts active contacts, finds by ABN digits and links people', async () => {
    const { id } = await api().companies.create(brightSolar);
    await api().contacts.create({
      firstName: 'Dan',
      email: 'dan@bright.com.au',
      type: 'Subcontractor',
      companyId: id,
    });
    const archived = await api().contacts.create({
      firstName: 'Ex',
      email: 'ex@bright.com.au',
      type: 'Subcontractor',
      companyId: id,
    });
    await api().contacts.archive({ id: archived.id });

    const list = await api().companies.list({ search: '824 753' });
    expect(list).toMatchObject({
      total: 1,
      rows: [{ name: 'Bright Solar Installs', contacts: 1 }],
    });
    expect((await api().companies.get({ id })).contacts.map((c) => c.firstName)).toEqual(['Dan']);
    expect((await api().contacts.list({ companyId: id })).total).toBe(1);
    expect((await api().companies.search({ search: 'bright' })).map((c) => c.name)).toEqual([
      'Bright Solar Installs',
    ]);
  });

  it('archives and restores', async () => {
    const { id } = await api().companies.create(brightSolar);
    await api().companies.archive({ id });
    expect((await api().companies.list({})).total).toBe(0);
    expect(await api().companies.search({ search: '' })).toEqual([]);
    await api().companies.restore({ id });
    expect((await api().companies.list({})).total).toBe(1);
  });

  it('serves form options to any signed-in user', async () => {
    const options = await api().optionLists.options({ keys: ['contactTypes', 'companyTypes'] });
    expect(options.contactTypes?.map((o) => o.value)).toContain('Residential');
    expect(options.companyTypes?.map((o) => o.value)).toContain('Subcontractor Installer');
  });
});
