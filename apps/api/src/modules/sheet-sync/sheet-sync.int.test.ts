import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix, type PermissionMatrix } from '@mms/shared';
import { activities, auditLog, leads, sheetSyncRuns } from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import type { JobQueue } from '../../jobs/queue.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';
import { SheetAccessError, type SheetsReader } from '../imports/google-sheets.ts';
import { syncCron, syncEnabledSources, syncSheetSource } from './sync.ts';

const createCaller = createCallerFactory(appRouter);

const SHEET_ID = '1mkYuqi8cuit0N2dPlraGi87OYwYFNK0Z55M3zlibu-c';
const HEADER = [
  'Lead ID',
  'Lead Date',
  'Sales Rep',
  'Status',
  'First Name',
  'Last Name',
  'Primary Mobile',
  'Email',
  'Street Address',
  'Suburb',
  'State',
  'Postcode',
  'System Size kW',
  'Sales Notes',
];
const col = (name: string) => HEADER.indexOf(name);

// prettier-ignore
const OLIVIA = ['L-1', '3/11/2026', 'Micky', 'Contacted', 'Olivia', 'Nguyen', '0412 345 678', 'olivia@example.com', '12 Rose St', 'Parramatta', 'NSW', '2150', '6.6', 'Call after 5'];
// prettier-ignore
const JACK = ['L-2', '1/11/2026', '', '', 'Jack', 'Smith', '0423 456 789', 'jack@example.com', '4 Elm Ave', 'Toowong', 'QLD', '4066', '', ''];

const withCell = (row: string[], name: string, value: string) =>
  row.map((cell, i) => (i === col(name) ? value : cell));

describe('live leads sync (Step 3.3, §1.8 rules 1–7)', () => {
  const db = createTestDb();
  let userId = '';
  let sourceId = '';
  /** The live sheet: edit `rows` between runs like a person editing the Google Sheet. */
  let rows: string[][] = [];
  let shared = true;
  let sent: { name: string; data: object }[] = [];

  const sheets: SheetsReader = {
    serviceAccountEmail: 'crm-sync@mms.iam.gserviceaccount.com',
    describe: (id) =>
      shared && id === SHEET_ID
        ? Promise.resolve({ title: 'Lead Management', tabs: ['Sheet1'] })
        : Promise.reject(new SheetAccessError("The sheet isn't shared with crm-sync@…")),
    read: (id) =>
      shared && id === SHEET_ID
        ? Promise.resolve([HEADER, ...rows])
        : Promise.reject(new SheetAccessError("The sheet isn't shared with crm-sync@…")),
  };
  const queue: JobQueue = {
    send: (name, data) => {
      sent.push({ name, data });
      return Promise.resolve('job-1');
    },
    retry: () => Promise.resolve(),
  };

  function as(permissions: PermissionMatrix = allPermissions()) {
    return createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id: userId, permissions }),
          firebaseUid: 'uid',
        },
        { db, sheets, jobs: queue },
      ),
    );
  }

  const mapping = {
    sheetLeadId: 'Lead ID',
    leadDate: 'Lead Date',
    ownerName: 'Sales Rep',
    status: 'Status',
    firstName: 'First Name',
    lastName: 'Last Name',
    mobile: 'Primary Mobile',
    email: 'Email',
    streetAddress: 'Street Address',
    suburb: 'Suburb',
    state: 'State',
    postcode: 'Postcode',
    systemSizeKw: 'System Size kW',
    notes: 'Sales Notes',
  };

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: userId } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
    rows = [OLIVIA, JACK];
    shared = true;
    sent = [];
    ({ id: sourceId } = await as().sheetSync.save({
      name: 'Website leads',
      spreadsheetId: SHEET_ID,
      tab: 'Sheet1',
      mapping,
      enabled: true,
    }));
  });
  afterAll(() => db.$client.end());

  const sync = async () => {
    const result = await syncSheetSource(db, sheets, sourceId, 'manual');
    if (!result) throw new Error('source missing');
    return result;
  };
  const leadById = async (sheetLeadId: string) =>
    (await db.select().from(leads).where(eq(leads.sheetLeadId, sheetLeadId)))[0];
  const allLeads = () => db.select().from(leads);
  const rowErrors = async (runId: string) => as().sheetSync.runErrors({ runId });

  it('rule 1: a row with a new Lead ID creates a lead — once', async () => {
    const first = await sync();
    expect(first).toMatchObject({
      status: 'completed',
      rowsRead: 2,
      createdCount: 2,
      errorCount: 0,
    });
    const olivia = await leadById('L-1');
    expect(olivia).toMatchObject({
      sheetSourceId: sourceId,
      firstName: 'Olivia',
      mobile: '+61412345678',
      leadDate: '2026-11-03',
      createdByUserId: null,
      crmEditedAt: null,
    });
    const [timeline] = await db
      .select()
      .from(activities)
      .where(eq(activities.entityId, olivia?.id ?? ''));
    expect(timeline?.subject).toBe('Created from the live sheet "Website leads" (Lead ID L-1)');
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, olivia?.id ?? ''), eq(auditLog.action, 'create')));
    expect(audit).toMatchObject({ actorType: 'sheet_sync', actorUserId: null });

    const second = await sync();
    expect(second).toMatchObject({ createdCount: 0, updatedCount: 0, linkedCount: 0 });
    expect(await allLeads()).toHaveLength(2);
  });

  it('rule 2: intake fields follow the sheet until someone edits the lead in the CRM', async () => {
    await sync();
    rows = [withCell(OLIVIA, 'Primary Mobile', '0499 111 222'), JACK];
    expect(await sync()).toMatchObject({ updatedCount: 1 });
    const olivia = await leadById('L-1');
    expect(olivia).toMatchObject({ mobile: '+61499111222', crmEditedAt: null });
    const subjects = (
      await db
        .select()
        .from(activities)
        .where(eq(activities.entityId, olivia?.id ?? ''))
    ).map((a) => a.subject);
    expect(subjects).toContain('Updated from the live sheet "Website leads": primary mobile');

    // A CRM user edits the lead — from now on the sheet never changes it.
    await as().leads.setStatus({ id: olivia?.id ?? '', status: 'Proposal Sent' });
    expect((await leadById('L-1'))?.crmEditedAt).not.toBeNull();
    rows = [
      withCell(withCell(OLIVIA, 'Primary Mobile', '0499 111 222'), 'Suburb', 'Westmead'),
      JACK,
    ];
    expect(await sync()).toMatchObject({ updatedCount: 0, errorCount: 0 });
    expect((await leadById('L-1'))?.suburb).toBe('Parramatta');

    // Any CRM edit counts: the full edit form too.
    const jack = await leadById('L-2');
    await as().leads.update({
      id: jack?.id ?? '',
      values: {
        firstName: 'Jack',
        lastName: 'Smith',
        email: 'jack@example.com',
        mobile: '0423 456 789',
      },
    });
    rows = [OLIVIA, withCell(JACK, 'Suburb', 'Indooroopilly')];
    await sync();
    expect((await leadById('L-2'))?.suburb).not.toBe('Indooroopilly');
  });

  it('rule 3: status, sales rep and notes come from the sheet on create only', async () => {
    await sync();
    const before = await leadById('L-1');
    expect(before).toMatchObject({
      status: 'Contacted',
      ownerUserId: userId,
      notes: 'Call after 5',
    });
    const crmTask = await as().activities.create({
      entityType: 'lead',
      entityId: before?.id ?? '',
      type: 'note',
      body: 'Customer prefers email',
    });

    let changed = withCell(OLIVIA, 'Status', 'Lost');
    changed = withCell(changed, 'Sales Rep', '');
    changed = withCell(changed, 'Sales Notes', 'Changed in the sheet');
    changed = withCell(changed, 'Suburb', 'Westmead');
    rows = [changed, JACK];
    await sync();
    const after = await leadById('L-1');
    expect(after).toMatchObject({
      status: 'Contacted',
      ownerUserId: userId,
      notes: 'Call after 5',
      suburb: 'Westmead', // intake fields still follow the sheet (lead not edited in the CRM)
      crmEditedAt: null,
    });
    const notes = await db.select().from(activities).where(eq(activities.id, crmTask.id));
    expect(notes[0]?.body).toBe('Customer prefers email');
  });

  it('rule 4: deleting a row in the sheet never deletes the lead; a CRM-deleted lead stays deleted', async () => {
    await sync();
    rows = [OLIVIA];
    expect(await sync()).toMatchObject({ rowsRead: 1, errorCount: 0 });
    expect((await allLeads()).filter((lead) => lead.deletedAt === null)).toHaveLength(2);

    const olivia = await leadById('L-1');
    await as().leads.remove({ id: olivia?.id ?? '' });
    rows = [withCell(OLIVIA, 'Suburb', 'Westmead'), JACK];
    expect(await sync()).toMatchObject({ createdCount: 0, updatedCount: 0 });
    expect(await allLeads()).toHaveLength(2);
    expect((await leadById('L-1'))?.deletedAt).not.toBeNull();
  });

  it('rule 5: rows without a Lead ID are skipped and reported', async () => {
    rows = [OLIVIA, withCell(JACK, 'Lead ID', '')];
    const run = await sync();
    expect(run).toMatchObject({ createdCount: 1, skippedCount: 1 });
    expect(await rowErrors(run.runId)).toEqual([
      {
        rowNumber: 3,
        sheetLeadId: null,
        message: 'No Lead ID — skipped. Give the row a Lead ID and it is picked up next run.',
      },
    ]);
    expect(await db.select().from(leads).where(isNull(leads.sheetLeadId))).toHaveLength(0);
  });

  it('rule 6: every run is logged with its counts and per-row errors', async () => {
    rows = [OLIVIA, withCell(JACK, 'Lead Date', '31/2/2026'), withCell(JACK, 'Lead ID', 'L-1')];
    const run = await sync();
    expect(run).toMatchObject({ status: 'completed', rowsRead: 3, createdCount: 1, errorCount: 2 });
    expect((await rowErrors(run.runId)).map((e) => [e.rowNumber, e.message])).toEqual([
      [3, expect.stringContaining('31/2/2026') as string],
      [4, 'Lead ID L-1 is also on row 2 — only that row is used. Give each row its own Lead ID.'],
    ]);

    // A run that can't read the sheet is logged as failed, with the reason.
    shared = false;
    const failed = await sync();
    expect(failed).toMatchObject({
      status: 'failed',
      error: expect.stringContaining("isn't shared") as string,
    });

    const history = await as().sheetSync.runs({ sourceId });
    expect(history.total).toBe(2);
    expect(history.runs[0]).toMatchObject({ status: 'failed', trigger: 'manual' });
    expect(history.runs[1]).toMatchObject({ status: 'completed', created: 1, errors: 2 });
    expect(history.runs[1]?.finishedAt).not.toBeNull();
    const list = await as().sheetSync.list();
    expect(list[0]).toMatchObject({
      name: 'Website leads',
      leads: 1,
      lastRun: { status: 'failed' },
    });
  });

  it('rule 6: a column renamed in the sheet fails the run instead of guessing', async () => {
    await sync();
    const renamed = HEADER.map((h) => (h === 'Primary Mobile' ? 'Mobile' : h));
    const reader: SheetsReader = { ...sheets, read: () => Promise.resolve([renamed, OLIVIA]) };
    const run = await syncSheetSource(db, reader, sourceId, 'schedule');
    expect(run).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('no longer has the column "Primary Mobile"') as string,
    });
  });

  it('rule 7: a new row for a customer already in the CRM is linked, not created', async () => {
    const { id: existing } = await as().leads.create({
      values: { firstName: 'Olivia', lastName: 'Nguyen', email: 'olivia@example.com' },
    });
    const run = await sync();
    expect(run).toMatchObject({ createdCount: 1, linkedCount: 1 });
    expect(await allLeads()).toHaveLength(2);
    expect(await leadById('L-1')).toMatchObject({ id: existing, sheetSourceId: sourceId });
    expect((await rowErrors(run.runId))[0]?.message).toContain('Linked to Olivia Nguyen');

    // The sheet didn't create it, so the CRM owns it: later runs neither re-link nor update it.
    rows = [withCell(OLIVIA, 'Suburb', 'Westmead'), JACK];
    expect(await sync()).toMatchObject({ createdCount: 0, linkedCount: 0, updatedCount: 0 });
    expect((await leadById('L-1'))?.suburb).toBeNull();
  });

  it('rule 7: two Lead IDs for the same customer — the second is flagged, not created', async () => {
    await sync();
    rows = [OLIVIA, JACK, withCell(withCell(OLIVIA, 'Lead ID', 'L-9'), 'Primary Mobile', '')];
    const run = await sync();
    expect(run).toMatchObject({ createdCount: 0, errorCount: 1 });
    expect((await rowErrors(run.runId))[0]?.message).toContain('Same customer as Lead ID L-1');
    expect(await allLeads()).toHaveLength(2);
  });

  it('the schedule syncs enabled sheets only', async () => {
    expect(await syncEnabledSources(db, sheets)).toEqual({ synced: 1 });
    await as().sheetSync.setEnabled({ id: sourceId, enabled: false });
    expect(await syncEnabledSources(db, sheets)).toEqual({ synced: 0 });
    expect(await db.select().from(sheetSyncRuns)).toHaveLength(1);
    expect(syncCron(5)).toBe('*/5 * * * *');
    expect(syncCron(60)).toBe('0 * * * *');
  });

  it('settings: needs a Lead ID column, real columns, one source per tab; Sync now queues a job', async () => {
    const base = { name: 'X', spreadsheetId: SHEET_ID, tab: 'Sheet1', enabled: false };
    const noLeadId = Object.fromEntries(
      Object.entries(mapping).filter(([key]) => key !== 'sheetLeadId'),
    );
    await expect(as().sheetSync.save({ ...base, mapping: noLeadId })).rejects.toThrow(
      'Map the Lead ID column',
    );
    await expect(
      as().sheetSync.save({ ...base, mapping: { ...mapping, email: 'E-mail' } }),
    ).rejects.toThrow('no column called "E-mail"');
    await expect(as().sheetSync.save({ ...base, mapping })).rejects.toThrow(
      'already synced as "Website leads"',
    );
    const inspected = await as().sheetSync.inspect({
      url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`,
    });
    expect(inspected).toEqual({
      spreadsheetId: SHEET_ID,
      title: 'Lead Management',
      tabs: ['Sheet1'],
    });
    expect(
      (await as().sheetSync.columns({ spreadsheetId: SHEET_ID, tab: 'Sheet1' })).mapping,
    ).toMatchObject({ sheetLeadId: 'Lead ID', mobile: 'Primary Mobile', notes: 'Sales Notes' });

    await as().sheetSync.syncNow({ id: sourceId });
    expect(sent).toEqual([{ name: 'sheets-sync', data: { sourceId } }]);
  });

  it('settings need the integrations permission', async () => {
    const sales = emptyPermissionMatrix();
    sales.leads = { view: true, create: true, edit: true, delete: false, export: false };
    await expect(as(sales).sheetSync.list()).rejects.toThrow('does not allow');
    const viewer = emptyPermissionMatrix();
    viewer.integrations = { view: true, create: false, edit: false, delete: false, export: false };
    expect(await as(viewer).sheetSync.list()).toHaveLength(1);
    await expect(as(viewer).sheetSync.syncNow({ id: sourceId })).rejects.toThrow('does not allow');
  });
});
