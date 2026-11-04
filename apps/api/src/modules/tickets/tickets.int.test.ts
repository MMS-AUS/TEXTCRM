import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix, type PermissionMatrix } from '@mms/shared';
import { activities, tickets } from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';

const createCaller = createCallerFactory(appRouter);

describe('service tickets (Step 2.8)', () => {
  const db = createTestDb();
  let userId = '';
  let techId = '';
  let contactId = '';
  let otherContactId = '';
  let projectId = '';

  function as(permissions: PermissionMatrix = allPermissions(), id = userId) {
    return createCaller(
      fakeContext(
        { status: 'authenticated', user: fakeUser({ id, permissions }), firebaseUid: 'uid' },
        { db },
      ),
    );
  }

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: userId } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
    ({ id: techId } = await upsertUser(
      db,
      { email: 'neivedha@makemysolar.com.au', name: 'Neivedha', roleKey: 'service' },
      'makemysolar.com.au',
    ));
    const { id: leadId } = await as().leads.create({
      values: {
        firstName: 'Olivia',
        lastName: 'Nguyen',
        email: 'olivia@example.com',
        mobile: '0412 345 678',
        streetAddress: '12 Rose St',
        suburb: 'Parramatta',
        state: 'NSW',
        postcode: '2150',
      },
    });
    const converted = await as().projects.convertLead({ leadId });
    projectId = converted.id;
    contactId = (await as().projects.get({ id: projectId })).contactId;
    ({ id: otherContactId } = await as().contacts.create({
      firstName: 'Jack',
      mobile: '0423 456 789',
      type: 'Residential',
    }));
  });
  afterAll(() => db.$client.end());

  const open = (overrides: object = {}) =>
    as().tickets.create({
      contactId,
      projectId,
      title: 'Inverter showing red alarm',
      category: 'Inverter Fault / Error Code',
      priority: 'High',
      ...overrides,
    });

  it('opens a ticket with a yearly number, on the ticket and project timelines', async () => {
    const first = await open();
    const second = await open({ title: 'WiFi drop', priority: 'Low' });
    expect(first.ticketNumber).toMatch(/^TKT-\d{4}-0001$/);
    expect(second.ticketNumber).toMatch(/^TKT-\d{4}-0002$/);
    const ticket = await as().tickets.get({ id: first.id });
    expect(ticket).toMatchObject({
      resolutionStatus: 'Under Investigation',
      priority: 'High',
      closedAt: null,
      contact: { firstName: 'Olivia' },
      project: { id: projectId },
    });
    const projectTimeline = await db
      .select()
      .from(activities)
      .where(eq(activities.entityId, projectId));
    expect(projectTimeline.map((a) => a.subject)).toContain(
      `Service ticket ${first.ticketNumber} opened: Inverter showing red alarm`,
    );
  });

  it("refuses another customer's project and unknown dropdown values", async () => {
    await expect(open({ contactId: otherContactId })).rejects.toThrow(
      'belongs to another customer',
    );
    await expect(open({ category: 'Alien invasion' })).rejects.toThrow();
  });

  it('logs and resolves a warranty claim end to end', async () => {
    const { id } = await open({ assignedUserId: techId });
    const triage = {
      issueRecorded: 'Inverter Fault / Red Alarm Light',
      initialCheck: 'Remote Portal Telemetry Verification',
      workRequired: 'Inverter Replacement under Manufacturer Warranty',
      resolutionStatus: 'Warranty Claim Logged with Brand',
      serviceIssueNotes: 'Alarm started after a storm.',
    };
    await as().tickets.updateTriage({ id, values: triage });
    await as().tickets.saveHardware({
      ticketId: id,
      values: {
        role: 'existing',
        kind: 'inverter',
        quantity: 1,
        brand: 'SolaX',
        model: 'X1-BOOST-5K-G4',
        size: '5 kW',
        serialNumbers: 'SX5K123456',
      },
    });
    const { id: claimId } = await as().tickets.saveClaim({
      ticketId: id,
      values: {
        claimDate: '2026-11-01',
        claimReference: 'RMA-1001',
        status: 'Submitted to Manufacturer',
      },
    });
    await as().tickets.saveVisit({
      ticketId: id,
      values: {
        isSubcontractor: true,
        installerName: 'Sam Sparks',
        phone: '0400 000 000',
        visitDate: '2026-11-02',
        notes: 'Replaced inverter under warranty.',
        invoiceNumber: 'SS-77',
        invoiceAmountAud: '$250',
      },
    });
    await as().tickets.saveHardware({
      ticketId: id,
      values: {
        role: 'replaced',
        kind: 'inverter',
        quantity: 1,
        brand: 'SolaX',
        model: 'X1-BOOST-5K-G4',
        serialNumbers: ['SX5K999999'],
      },
    });
    await as().tickets.saveClaim({
      ticketId: id,
      id: claimId,
      values: {
        claimDate: '2026-11-01',
        claimReference: 'RMA-1001',
        status: 'Warranty Approved & Credited',
        invoiceStatus: 'No Charge / Full Warranty Replacement',
      },
    });
    const closed = await as().tickets.updateTriage({
      id,
      values: {
        ...triage,
        resolutionStatus: 'Resolved - Complete Handover',
        serviceChargeAud: '0',
      },
    });
    expect(closed).toMatchObject({ closed: true });

    const ticket = await as().tickets.get({ id });
    expect(ticket.closedAt).not.toBeNull();
    expect(ticket.resolvedDate).not.toBeNull();
    expect(ticket.assignedName).toBe('Neivedha');
    expect(ticket.hardware.map((h) => [h.role, h.serialNumbers])).toEqual([
      ['existing', ['SX5K123456']],
      ['replaced', ['SX5K999999']],
    ]);
    expect(ticket.claims).toHaveLength(1);
    expect(ticket.claims[0]).toMatchObject({ status: 'Warranty Approved & Credited' });
    expect(ticket.visits[0]).toMatchObject({
      installerName: 'Sam Sparks',
      invoiceAmountAud: '250.00',
    });

    const timeline = (await db.select().from(activities).where(eq(activities.entityId, id))).map(
      (a) => a.subject,
    );
    expect(timeline).toEqual(
      expect.arrayContaining([
        'Status: Warranty Claim Logged with Brand',
        'Warranty claim RMA-1001: Submitted to Manufacturer',
        'Warranty claim RMA-1001: Warranty Approved & Credited',
        'Status: Resolved - Complete Handover',
      ]),
    );

    // Reopening clears the closed date and the resolved date.
    await as().tickets.setStatus({ id, status: 'Troubleshooting in Progress' });
    const reopened = await as().tickets.get({ id });
    expect(reopened).toMatchObject({ closedAt: null, resolvedDate: null });
  });

  it('checks hardware rows: serials vs quantity', async () => {
    const { id } = await open();
    await expect(
      as().tickets.saveHardware({
        ticketId: id,
        values: { role: 'existing', kind: 'panel', quantity: 1, serialNumbers: 'A1\nA2' },
      }),
    ).rejects.toThrow('2 serial numbers for 1 item');
    const { id: rowId } = await as().tickets.saveHardware({
      ticketId: id,
      values: { role: 'existing', kind: 'panel', quantity: 2, serialNumbers: 'A1, A2, A1' },
    });
    expect((await as().tickets.get({ id })).hardware[0]?.serialNumbers).toEqual(['A1', 'A2']);
    await as().tickets.removeHardware({ ticketId: id, id: rowId });
    expect((await as().tickets.get({ id })).hardware).toHaveLength(0);
  });

  it('lists with filters: open/closed, priority, technician, age, search', async () => {
    const a = await open({ assignedUserId: techId });
    await open({ title: 'Roof leak', priority: 'Low', category: 'Roof Leak Inspection' });
    const old = await open({ title: 'Old one', priority: 'Urgent' });
    await db
      .update(tickets)
      .set({ createdAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(tickets.id, old.id));
    await as().tickets.setStatus({ id: a.id, status: 'Customer Closed' });

    const list = (filters: object) => as().tickets.list({ ...filters });
    expect((await list({})).total).toBe(2); // open by default
    expect((await list({ state: 'closed' })).rows.map((r) => r.id)).toEqual([a.id]);
    expect((await list({ state: 'all' })).total).toBe(3);
    expect((await list({ priority: 'Urgent' })).rows.map((r) => r.title)).toEqual(['Old one']);
    expect((await list({ age: 'older' })).rows.map((r) => r.title)).toEqual(['Old one']);
    expect((await list({ age: 'week' })).rows.map((r) => r.title)).toEqual(['Roof leak']);
    expect((await list({ state: 'all', assigned: techId })).total).toBe(1);
    expect((await list({ search: 'olivia' })).total).toBe(2);
    const sorted = await list({ sort: { id: 'priority', desc: true } });
    expect(sorted.rows.map((r) => r.priority)).toEqual(['Urgent', 'Low']);
    const board = await as().tickets.board({});
    expect(board.rows.map((r) => r.priority)).toEqual(['Urgent', 'Low']);
  });

  it('needs ticket permissions', async () => {
    const sales = emptyPermissionMatrix();
    sales.leads = { view: true, create: true, edit: true, delete: false, export: false };
    await expect(as(sales).tickets.list({})).rejects.toThrow('does not allow');
    const readOnly = emptyPermissionMatrix();
    readOnly.tickets = { view: true, create: false, edit: false, delete: false, export: false };
    expect((await as(readOnly).tickets.list({})).total).toBe(0);
    await expect(
      open().then(({ id }) => as(readOnly).tickets.setStatus({ id, status: 'Customer Closed' })),
    ).rejects.toThrow('does not allow');
  });
});
