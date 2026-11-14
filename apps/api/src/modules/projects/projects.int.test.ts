import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix, type LeadInput, type PermissionMatrix } from '@mms/shared';
import { auditLog, contactAddresses, contacts, projects } from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';

const createCaller = createCallerFactory(appRouter);
const DOMAIN = 'makemysolar.com.au';

describe('lead → project conversion and projects', () => {
  const db = createTestDb();
  let micky = '';

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: micky } = await upsertUser(
      db,
      { email: `micky@${DOMAIN}`, name: 'Micky', roleKey: 'admin' },
      DOMAIN,
    ));
  });
  afterAll(() => db.$client.end());

  function as(permissions: PermissionMatrix = allPermissions()) {
    return createCaller(
      fakeContext(
        { status: 'authenticated', user: fakeUser({ id: micky, permissions }), firebaseUid: 'uid' },
        { db },
      ),
    );
  }

  const olivia: LeadInput = {
    firstName: 'Olivia',
    lastName: 'Nguyen',
    mobile: '0412 345 678',
    email: 'olivia@example.com',
    streetAddress: '12 Church St',
    suburb: 'Parramatta',
    state: 'NSW',
    postcode: '2150',
    source: 'Meta',
    notes: 'Dog in the yard',
  };

  /** A lead with system requirements and pricing, ready to convert. */
  async function readyLead(values: LeadInput = olivia) {
    const api = as();
    const { id } = await api.leads.create({ values: { ...values, ownerUserId: micky } });
    const [panel] = await api.hardware.search({ kind: 'panel', search: '' });
    const [battery] = await api.hardware.search({ kind: 'battery', search: '' });
    if (!panel || !battery) throw new Error('empty catalog');
    await api.leads.updateSystem({
      id,
      values: {
        panelId: panel.id,
        panelCount: 24,
        batteryId: battery.id,
        batteryCount: 1,
        roofType: 'Concrete Tile',
      },
    });
    await api.leads.updatePricing({
      id,
      values: {
        systemPriceAud: '21990',
        sellingPriceAud: '14990',
        depositAud: '2000',
        depositReceivedDate: '2026-11-02',
      },
    });
    return { id, panel, battery };
  }

  it('previews what will be created', async () => {
    const { id } = await readyLead();
    const preview = await as().projects.conversionPreview({ leadId: id });
    expect(preview).toMatchObject({
      problems: [],
      contact: { mode: 'new', name: 'Olivia Nguyen' },
      project: {
        address: '12 Church St, Parramatta, NSW, 2150',
        stage: 'Engineering & DNSP Approval',
        salesPerson: 'Micky',
        sellingPriceAud: '14990.00',
      },
    });
    expect(preview.project.title).toMatch(/kW solar \+ battery$/);
  });

  it('converts: creates the contact, copies site, system and pricing, links both ways and logs on both', async () => {
    const { id: leadId, panel, battery } = await readyLead();
    const { id, projectNumber } = await as().projects.convertLead({ leadId });
    expect(projectNumber).toMatch(/^MMS-\d{4}-0001$/);

    const project = await as().projects.get({ id });
    expect(project).toMatchObject({
      leadId,
      stage: 'Engineering & DNSP Approval',
      status: 'Active',
      streetAddress: '12 Church St',
      suburb: 'Parramatta',
      state: 'NSW',
      postcode: '2150',
      area: 'Metro',
      roofType: 'Concrete Tile',
      notes: 'Dog in the yard',
      salesUserId: micky,
      contact: { firstName: 'Olivia', email: 'olivia@example.com', mobile: '+61412345678' },
      system: { panelId: panel.id, panelCount: 24, batteryId: battery.id, batteryCount: 1 },
      pricing: {
        systemPriceAud: '21990.00',
        sellingPriceAud: '14990.00',
        depositAud: '2000.00',
        depositReceivedDate: '2026-11-02',
        balancePayableAud: '12990.00',
      },
    });

    // A contact was created, with the property as its primary address.
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, project.contactId));
    expect(contact).toMatchObject({ firstName: 'Olivia', source: 'Lead conversion' });
    const addresses = await db
      .select()
      .from(contactAddresses)
      .where(eq(contactAddresses.contactId, project.contactId));
    expect(addresses).toMatchObject([{ streetAddress: '12 Church St', isPrimary: true }]);

    // The lead is converted and points both ways.
    const lead = await as().leads.get({ id: leadId });
    expect(lead).toMatchObject({
      status: 'Converted to Project',
      contactId: project.contactId,
      project: { id, projectNumber },
    });
    expect(lead.convertedAt).not.toBeNull();

    // Activity on both records, audit on both.
    const leadTimeline = await as().activities.list({ entityType: 'lead', entityId: leadId });
    expect(leadTimeline[0]?.subject).toBe(`Converted to project ${projectNumber}`);
    const projectTimeline = await as().activities.list({ entityType: 'project', entityId: id });
    expect(projectTimeline[0]?.subject).toBe(
      "Project created from Olivia Nguyen's lead ($14,990.00)",
    );
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'convert_to_project'));
    expect(audits).toHaveLength(1);
  });

  /** Two different inverter models from the catalog and each one's size in kW. */
  async function twoInverters() {
    const found = await as().hardware.search({ kind: 'inverter', search: '' });
    const [first, second] = found;
    if (!first || !second) throw new Error('need two inverters in the catalog');
    return [
      { ...first, kw: Number.parseFloat(first.spec) },
      { ...second, kw: Number.parseFloat(second.spec) },
    ] as const;
  }

  it('copies every inverter of the lead to the project exactly: model, count, type and order', async () => {
    const { id: leadId } = await readyLead();
    const [a, b] = await twoInverters();
    await as().leads.updateSystem({
      id: leadId,
      values: {
        inverters: [
          { inverterId: b.id, count: 2, type: 'hybrid' },
          { inverterId: a.id, count: 1, type: 'grid' },
        ],
      },
    });
    const lead = await as().leads.get({ id: leadId });
    const kw = (2 * b.kw + a.kw).toFixed(2);
    expect(lead.system?.systemSizeKw).toBe(kw);

    const { id } = await as().projects.convertLead({ leadId });
    const project = await as().projects.get({ id });
    expect(project.system?.inverters.map((l) => [l.inverterId, l.count, l.type])).toEqual([
      [b.id, 2, 'hybrid'],
      [a.id, 1, 'grid'],
    ]);
    expect(project.system?.inverters[0]?.inverter?.label).toBe(b.label);
    expect(project.system?.systemSizeKw).toBe(kw);

    // The project's lines are its own copy: changing the lead afterwards leaves them alone.
    await as().leads.updateSystem({ id: leadId, values: { inverters: [] } });
    expect((await as().projects.get({ id })).system?.inverters).toHaveLength(2);
  });

  it('a lead with no inverter converts to a project with none', async () => {
    const { id: leadId } = await readyLead();
    const { id } = await as().projects.convertLead({ leadId });
    expect((await as().projects.get({ id })).system?.inverters).toEqual([]);
  });

  it('edits a project’s inverters: add, change, remove; the size follows and the change is audited', async () => {
    const { id: leadId } = await readyLead();
    const { id } = await as().projects.convertLead({ leadId });
    const [a, b] = await twoInverters();
    const base = { panelId: null, panelCount: null, batteryId: null, batteryCount: null };

    await as().projects.updateSystem({
      id,
      values: {
        ...base,
        inverters: [
          { inverterId: a.id, count: 1, type: 'grid' },
          { inverterId: b.id, count: 3, type: 'hybrid' },
        ],
      },
    });
    let project = await as().projects.get({ id });
    expect(project.system?.inverters).toHaveLength(2);
    expect(project.system?.systemSizeKw).toBe((a.kw + 3 * b.kw).toFixed(2));

    await as().projects.updateSystem({
      id,
      values: { ...base, inverters: [{ inverterId: b.id, count: 1, type: 'grid' }] },
    });
    project = await as().projects.get({ id });
    expect(project.system?.inverters.map((l) => [l.inverterId, l.count, l.type])).toEqual([
      [b.id, 1, 'grid'],
    ]);
    expect(project.system?.systemSizeKw).toBe(b.kw.toFixed(2));
    expect(project.history.filter((h) => h.action === 'update_system').length).toBe(2);

    // Saving the same lines again changes nothing and adds no history.
    await as().projects.updateSystem({
      id,
      values: { ...base, inverters: [{ inverterId: b.id, count: 1, type: 'grid' }] },
    });
    expect(
      (await as().projects.get({ id })).history.filter((h) => h.action === 'update_system'),
    ).toHaveLength(2);

    await expect(
      as().projects.updateSystem({
        id,
        values: {
          ...base,
          inverters: [
            { inverterId: '00000000-0000-4000-8000-000000000000', count: 1, type: 'grid' },
          ],
        },
      }),
    ).rejects.toThrow();
  });

  it('blocks a second conversion, also when two run at the same time', async () => {
    const { id: leadId } = await readyLead();
    const results = await Promise.allSettled([
      as().projects.convertLead({ leadId }),
      as().projects.convertLead({ leadId }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.select().from(projects)).toHaveLength(1);
    await expect(as().projects.convertLead({ leadId })).rejects.toMatchObject({ code: 'CONFLICT' });
    const preview = await as().projects.conversionPreview({ leadId });
    expect(preview.problems[0]).toMatch(/^Already converted to project MMS-/);
  });

  it('links an existing contact instead of creating a duplicate, and adds the new property', async () => {
    const contact = await as().contacts.create({
      firstName: 'Olivia',
      email: 'olivia@example.com',
      type: 'Residential',
    });
    await as().contacts.addAddress({
      contactId: contact.id,
      address: {
        streetAddress: '3 Ruthven St',
        suburb: 'Toowoomba',
        state: 'QLD',
        postcode: '4350',
      },
    });
    const { id: leadId } = await readyLead();
    expect((await as().projects.conversionPreview({ leadId })).contact).toMatchObject({
      mode: 'existing',
      id: contact.id,
    });
    const { id } = await as().projects.convertLead({ leadId });
    expect((await as().projects.get({ id })).contactId).toBe(contact.id);
    expect(await db.select().from(contacts)).toHaveLength(1);
    const addresses = await db
      .select()
      .from(contactAddresses)
      .where(eq(contactAddresses.contactId, contact.id));
    expect(addresses.map((a) => [a.suburb, a.isPrimary])).toEqual(
      expect.arrayContaining([
        ['Toowoomba', true],
        ['Parramatta', false],
      ]),
    );
  });

  it('refuses leads without a full address, lost leads and missing permissions', async () => {
    const { id: noAddress } = await as().leads.create({
      values: { firstName: 'Jack', email: 'jack@example.com' },
    });
    await expect(as().projects.convertLead({ leadId: noAddress })).rejects.toThrow(
      /full property address/,
    );

    const { id: lost } = await readyLead({
      ...olivia,
      email: 'grace@example.com',
      mobile: '0423 456 789',
      firstName: 'Grace',
    });
    await as().leads.setStatus({ id: lost, status: 'Lost' });
    await expect(as().projects.convertLead({ leadId: lost })).rejects.toThrow(/marked Lost/);

    const salesOnly = emptyPermissionMatrix();
    salesOnly.leads = { view: true, create: true, edit: true, delete: false, export: false };
    await expect(as(salesOnly).projects.convertLead({ leadId: lost })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('numbers projects in sequence', async () => {
    const one = await readyLead();
    const two = await readyLead({
      ...olivia,
      firstName: 'Jack',
      email: 'jack@example.com',
      mobile: '0423 456 789',
      suburb: 'Penrith',
      postcode: '2750',
    });
    const first = await as().projects.convertLead({ leadId: one.id });
    const second = await as().projects.convertLead({ leadId: two.id });
    expect(Number(second.projectNumber.slice(-4))).toBe(Number(first.projectNumber.slice(-4)) + 1);
  });

  it('moves stages with timeline and audit; the final stage completes the job, and closed jobs stay put', async () => {
    const { id: leadId } = await readyLead();
    const { id } = await as().projects.convertLead({ leadId });
    await as().projects.setStage({ id, stage: 'Install Scheduled' });
    await as().projects.setStage({ id, stage: 'Completed' });
    expect(await as().projects.get({ id })).toMatchObject({
      stage: 'Completed',
      status: 'Completed',
    });
    await as().projects.setStage({ id, stage: 'Installation Completed' });
    const reopened = await as().projects.get({ id });
    expect(reopened).toMatchObject({ status: 'Active', closedAt: null });

    const timeline = (await as().activities.list({ entityType: 'project', entityId: id })).map(
      (a) => a.subject,
    );
    expect(timeline).toContain('Stage moved from Engineering & DNSP Approval to Install Scheduled');
    expect(timeline).toContain('Status changed from Completed to Active');

    await as().projects.setStatus({ id, status: 'Lost' });
    await expect(as().projects.setStage({ id, stage: 'Install Scheduled' })).rejects.toThrow(
      /Set it back to Active/,
    );
  });

  it('lists, filters and boards projects', async () => {
    const one = await readyLead();
    const two = await readyLead({
      ...olivia,
      firstName: 'Jack',
      lastName: 'Patel',
      email: 'jack@example.com',
      mobile: '0423 456 789',
      suburb: 'Brisbane',
      state: 'QLD',
      postcode: '4000',
    });
    const p1 = await as().projects.convertLead({ leadId: one.id });
    const p2 = await as().projects.convertLead({ leadId: two.id });
    await as().projects.setStage({ id: p2.id, stage: 'Install Scheduled' });

    const numbers = async (input: Parameters<ReturnType<typeof as>['projects']['list']>[0]) =>
      (await as().projects.list(input)).rows.map((row) => row.projectNumber);

    expect(await numbers({ search: 'patel' })).toEqual([p2.projectNumber]);
    expect(await numbers({ search: p1.projectNumber })).toEqual([p1.projectNumber]);
    expect(await numbers({ state: 'QLD' })).toEqual([p2.projectNumber]);
    expect(await numbers({ stages: ['Install Scheduled'] })).toEqual([p2.projectNumber]);
    expect(await numbers({ sort: { id: 'stage', desc: false } })).toEqual([
      p1.projectNumber,
      p2.projectNumber,
    ]);
    expect(await numbers({ sales: 'me' })).toHaveLength(2);
    expect(await numbers({ dnsp: 'Ausgrid' })).toEqual([]);

    const board = await as().projects.board({ status: 'Active' });
    expect(board.rows.map((row) => [row.projectNumber, row.stage, row.customerName])).toEqual(
      expect.arrayContaining([
        [p1.projectNumber, 'Engineering & DNSP Approval', 'Olivia Nguyen'],
        [p2.projectNumber, 'Install Scheduled', 'Jack Patel'],
      ]),
    );
    expect(board.truncated).toBe(false);
  });

  it('edits site, system and pricing with validation and audit', async () => {
    const { id: leadId } = await readyLead();
    const { id } = await as().projects.convertLead({ leadId });
    await as().projects.updateSite({
      id,
      values: {
        streetAddress: '14 Church St',
        suburb: 'Parramatta',
        state: 'NSW',
        postcode: '2150',
        nmi: '4103123456',
      },
    });
    await expect(
      as().projects.updateSite({
        id,
        values: { streetAddress: 'x', suburb: 'y', state: 'QLD', postcode: '2150' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await as().projects.updatePricing({
      id,
      values: { contractValueAud: '15500', depositAud: '2000' },
    });
    const project = await as().projects.get({ id });
    expect(project).toMatchObject({ streetAddress: '14 Church St', nmi: '4103123456' });
    expect(project.pricing?.balancePayableAud).toBe('13500.00');
    expect(project.history.map((h) => h.action)).toEqual(
      expect.arrayContaining(['update_site', 'update_pricing']),
    );
  });
});
