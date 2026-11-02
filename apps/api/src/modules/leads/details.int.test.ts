import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';

const createCaller = createCallerFactory(appRouter);

describe('lead system requirements and pricing', () => {
  const db = createTestDb();
  let api: ReturnType<typeof createCaller>;
  let leadId = '';

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    const { id } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    );
    api = createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id, permissions: allPermissions() }),
          firebaseUid: 'uid',
        },
        { db },
      ),
    );
    ({ id: leadId } = await api.leads.create({
      values: { firstName: 'Olivia', email: 'o@x.com' },
    }));
  });
  afterAll(() => db.$client.end());

  it('searches the hardware catalog by manufacturer and model words', async () => {
    const panels = await api.hardware.search({ kind: 'panel', search: '' });
    expect(panels.length).toBeGreaterThan(0);
    const first = panels[0];
    if (!first) throw new Error('empty catalog');
    const word = first.label.split(' ')[0] ?? '';
    const found = await api.hardware.search({ kind: 'panel', search: word.toLowerCase() });
    expect(found.map((p) => p.id)).toContain(first.id);
    expect(first.spec).toMatch(/^\d+(\.\d+)? W$/);
  });

  it('saves system requirements and works out the size from the panels', async () => {
    const [panel] = await api.hardware.search({ kind: 'panel', search: '' });
    const [battery] = await api.hardware.search({ kind: 'battery', search: '' });
    if (!panel || !battery) throw new Error('empty catalog');
    await api.leads.updateSystem({
      id: leadId,
      values: {
        panelId: panel.id,
        panelCount: '20',
        batteryId: battery.id,
        batteryCount: 1,
        roofType: '',
        quarterlyBillAud: '$650',
      },
    });
    const lead = await api.leads.get({ id: leadId });
    const watts = Number(panel.spec.replace(' W', ''));
    expect(lead.system).toMatchObject({
      panelCount: 20,
      systemSizeKw: ((20 * watts) / 1000).toFixed(2),
      batteryRequired: true,
      quarterlyBillAud: '650.00',
      panel: { id: panel.id, label: panel.label },
      battery: { id: battery.id },
    });
    expect(lead.history[0]?.action).toBe('update_system');
  });

  it('rejects incomplete hardware and unknown options', async () => {
    const [panel] = await api.hardware.search({ kind: 'panel', search: '' });
    if (!panel) throw new Error('empty catalog');
    await expect(
      api.leads.updateSystem({ id: leadId, values: { panelId: panel.id } }),
    ).rejects.toThrow(/How many panels/);
    await expect(
      api.leads.updateSystem({ id: leadId, values: { roofType: 'Thatch' } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('saves pricing in exact cents and logs the deposit on the timeline once', async () => {
    await expect(
      api.leads.updatePricing({
        id: leadId,
        values: { sellingPriceAud: '9000', depositAud: '10000' },
      }),
    ).rejects.toThrow(/more than the price/);

    const values = {
      systemPriceAud: '$14,990.50',
      sellingPriceAud: '11990.5',
      depositAud: '2000',
      depositReceivedDate: '2026-11-02',
    };
    await api.leads.updatePricing({ id: leadId, values });
    await api.leads.updatePricing({ id: leadId, values });
    const lead = await api.leads.get({ id: leadId });
    expect(lead.pricing).toEqual({
      systemPriceAud: '14990.50',
      sellingPriceAud: '11990.50',
      depositAud: '2000.00',
      depositReceivedDate: '2026-11-02',
    });
    const timeline = await api.activities.list({ entityType: 'lead', entityId: leadId });
    expect(timeline.filter((a) => a.subject?.startsWith('Deposit of'))).toHaveLength(1);
    expect(timeline[0]?.subject).toBe('Deposit of $2,000.00 received on 2 November 2026');
  });
});
