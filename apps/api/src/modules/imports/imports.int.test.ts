import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  emptyPermissionMatrix,
  templateHeaders,
  type ImportTarget,
  type PermissionMatrix,
} from '@mms/shared';
import {
  activities,
  auditLog,
  contactAddresses,
  contacts,
  importJobs,
  leadPricing,
  leads,
  leadSystemRequirements,
} from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import type { JobQueue } from '../../jobs/queue.ts';
import type { Storage } from '../../storage/storage.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';
import { SheetAccessError, type SheetsReader } from './google-sheets.ts';
import { runImport } from './service.ts';

const createCaller = createCallerFactory(appRouter);

/** Object storage kept in memory: the "presigned URL" is the key the test writes to. */
function memoryStorage() {
  const objects = new Map<string, Buffer>();
  const storage: Storage = {
    presignUpload: (key) => Promise.resolve(`memory://${key}`),
    presignDownload: () => Promise.resolve(''),
    presignPreview: () => Promise.resolve(''),
    head: (key) => {
      const bytes = objects.get(key);
      return Promise.resolve(bytes ? { sizeBytes: bytes.length, contentType: null } : null);
    },
    read: (key) => {
      const bytes = objects.get(key);
      return bytes ? Promise.resolve(bytes) : Promise.reject(new Error('missing'));
    },
    remove: (keys) => {
      for (const key of keys) objects.delete(key);
      return Promise.resolve();
    },
  };
  return { storage, objects };
}

/** A Google account with sheets shared to it: { spreadsheetId: { tab: rows } }. */
function fakeSheets(books: Record<string, Record<string, string[][]>>): SheetsReader {
  return {
    serviceAccountEmail: 'crm-sync@mms.iam.gserviceaccount.com',
    describe: (id) => {
      const book = books[id];
      if (!book) {
        return Promise.reject(
          new SheetAccessError("The sheet isn't shared with crm-sync@mms.iam.gserviceaccount.com."),
        );
      }
      return Promise.resolve({ title: `Book ${id.slice(0, 4)}`, tabs: Object.keys(book) });
    },
    read: (id, tab) => Promise.resolve(books[id]?.[tab] ?? []),
  };
}

const csv = (rows: string[][]) =>
  Buffer.from(
    rows
      .map((row) => row.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
      .join('\n'),
  );

// Headers exactly as the old intake template has them (§1.8 "Expected columns").
const HEADER = [
  'Lead ID',
  'Lead Date',
  'Platform',
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
  'Battery Required',
  'Selling Price AUD',
  'Sales Notes',
];

// prettier-ignore
const HISTORIC = [
  HEADER,
  ['101', '3/11/2026', 'Meta', 'Micky', 'Contacted', 'Olivia', 'Nguyen', '0412 345 678', 'olivia@example.com', '12 Rose St', 'Parramatta', 'NSW', '2150', '6.6', 'Yes', '$9,990', 'Wants a quote'],
  ['102', '2026-11-01', 'Website', '', '', 'Jack', 'Smith', '0423 456 789', '', '4 Elm Ave', 'Toowong', 'Queensland', '4066', '', 'no', '', ''],
  ['101', '3/11/2026', 'Meta', '', '', 'Olivia', 'Nguyen', '0412 345 678', 'olivia@example.com', '12 Rose St', 'Parramatta', 'NSW', '2150', '', '', '', ''],
  ['103', '', '', '', '', '', 'NoFirstName', '0434 567 890', '', '', '', '', '', '', '', '', '=HYPERLINK("x")'],
  ['104', '13/13/2026', 'TikTok', '', '', 'Bad', 'Date', '0445 678 901', '', '', '', '', '', '', '', '', ''],
  ['105', '', 'TikTok', 'Someone Else', '', 'Ava', 'Brown', '456789012', '', '', '', '', '', '', '', '', ''],
];

describe('imports (Step 3.2)', () => {
  const db = createTestDb();
  let userId = '';
  let memory = memoryStorage();
  let sent: { name: string; data: object }[] = [];
  const queue: JobQueue = {
    send: (name, data) => {
      sent.push({ name, data });
      return Promise.resolve('job-id');
    },
    retry: () => Promise.resolve(),
  };
  let sheets = fakeSheets({});

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: userId } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
    memory = memoryStorage();
    sent = [];
    sheets = fakeSheets({});
  });
  afterAll(() => db.$client.end());

  function as(permissions: PermissionMatrix = allPermissions()) {
    return createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id: userId, permissions }),
          firebaseUid: 'uid',
        },
        { db, storage: memory.storage, jobs: queue, sheets },
      ),
    );
  }

  async function upload(
    rows: string[][],
    target: ImportTarget = 'leads',
    fileName = 'history.csv',
  ) {
    const bytes = csv(rows);
    const ticket = await as().imports.createUpload({ target, fileName, sizeBytes: bytes.length });
    memory.objects.set(ticket.uploadUrl.replace('memory://', ''), bytes);
    return as().imports.completeUpload({ id: ticket.id });
  }

  /** Upload → suggested mapping → preview → start → the worker's run. */
  async function importFile(rows: string[][], target: ImportTarget = 'leads') {
    const { id } = await upload(rows, target);
    const source = await as().imports.source({ id });
    const preview = await as().imports.preview({ id, mapping: source.mapping });
    await as().imports.start({ id });
    const result = await runImport(db, id);
    return { id, preview, result };
  }

  const liveLeads = () => db.select().from(leads).where(isNull(leads.deletedAt));

  it('suggests the mapping from the old template headers', async () => {
    const { id } = await upload(HISTORIC);
    const source = await as().imports.source({ id });
    expect(source.rowCount).toBe(6);
    expect(source.mapping).toMatchObject({
      sheetLeadId: 'Lead ID',
      leadDate: 'Lead Date',
      ownerName: 'Sales Rep',
      firstName: 'First Name',
      mobile: 'Primary Mobile',
      sellingPriceAud: 'Selling Price AUD',
      notes: 'Sales Notes',
    });
  });

  it('a file with the template headings skips column matching and is previewed at once', async () => {
    const headers = templateHeaders('leads').reverse();
    const row = (values: Record<string, string>) => headers.map((h) => values[h] ?? '');
    const result = await upload([
      headers,
      row({
        'First Name': 'Mia',
        'Last Name': 'Chen',
        'Primary Mobile': '412345678',
        Email: 'mia@home.example Mia@Work.example',
        Postcode: '2150',
      }),
    ]);
    expect(result.matchedTemplate).toBe(true);
    const job = await as().imports.get({ id: result.id });
    expect(job.status).toBe('previewed');
    expect(job.counts.create).toBe(1);
    expect(job.mapping).toMatchObject({ firstName: 'First Name', email: 'Email' });
    await as().imports.start({ id: result.id });
    await runImport(db, result.id);
    const [lead] = await liveLeads();
    expect(lead).toMatchObject({
      firstName: 'Mia',
      lastName: 'Chen',
      mobile: '+61412345678',
      email: 'mia@home.example',
      extraEmails: ['mia@work.example'],
      fullName: 'Mia Chen',
    });
  });

  it('other layouts stay on column matching', async () => {
    const result = await upload(HISTORIC);
    expect(result.matchedTemplate).toBe(false);
    expect((await as().imports.get({ id: result.id })).status).toBe('ready');
  });

  it('offers the template only for targets the user can import', async () => {
    const template = await as().imports.template({ target: 'contacts' });
    expect(template.fileName).toMatch(/contacts.*\.xlsx$/);
    expect(template.base64.length).toBeGreaterThan(100);
    const leadsOnly = emptyPermissionMatrix();
    leadsOnly.leads = { view: true, create: true, edit: true, delete: false, export: false };
    await expect(as(leadsOnly).imports.template({ target: 'panels' })).rejects.toThrow(
      /does not allow/,
    );
  });

  it('previews every row without changing the CRM, then the job does exactly that', async () => {
    const { id } = await upload(HISTORIC);
    const source = await as().imports.source({ id });
    const preview = await as().imports.preview({ id, mapping: source.mapping });
    expect(preview.counts).toEqual({ create: 3, update: 0, skip: 1, error: 2 });
    expect(await liveLeads()).toHaveLength(0);

    const rows = await as().imports.rows({ id });
    const byRow = new Map(rows.rows.map((row) => [row.rowNumber, row]));
    expect(byRow.get(4)?.action).toBe('skip');
    expect(byRow.get(4)?.message).toContain('row 2');
    expect(byRow.get(5)).toMatchObject({ action: 'error' });
    expect(byRow.get(6)?.message).toContain('13/13/2026');
    expect(byRow.get(7)?.message).toContain('Lead source "TikTok" isn\'t in the list');
    expect(byRow.get(7)?.message).toContain('Sales rep "Someone Else"');

    await as().imports.start({ id });
    expect(sent).toEqual([{ name: 'imports-run', data: { importId: id } }]);
    expect((await as().imports.get({ id })).status).toBe('queued');

    const result = await runImport(db, id);
    expect(result).toMatchObject({ status: 'completed', create: 3, skip: 1, error: 2 });

    const saved = await liveLeads();
    expect(saved.map((lead) => lead.sheetLeadId).sort()).toEqual(['101', '102', '105']);
    const olivia = saved.find((lead) => lead.sheetLeadId === '101');
    expect(olivia).toMatchObject({
      mobile: '+61412345678',
      leadDate: '2026-11-03',
      status: 'Contacted',
      ownerUserId: userId,
      notes: 'Wants a quote',
      sheetSourceId: null,
      crmEditedAt: null,
    });
    // A mobile stored as a number in the sheet lost its leading zero; it's put back.
    expect(saved.find((lead) => lead.sheetLeadId === '105')?.mobile).toBe('+61456789012');
    const jack = saved.find((lead) => lead.sheetLeadId === '102');
    expect(jack).toMatchObject({ state: 'QLD', status: 'New', source: 'Website' });
    const [system] = await db
      .select()
      .from(leadSystemRequirements)
      .where(eq(leadSystemRequirements.leadId, olivia?.id ?? ''));
    expect(system).toMatchObject({ systemSizeKw: '6.60', batteryRequired: true });
    const [pricing] = await db
      .select()
      .from(leadPricing)
      .where(eq(leadPricing.leadId, olivia?.id ?? ''));
    expect(pricing?.sellingPriceAud).toBe('9990.00');

    const timeline = await db
      .select()
      .from(activities)
      .where(eq(activities.entityId, olivia?.id ?? ''));
    expect(timeline[0]?.subject).toBe('Imported from history.csv (row 2)');
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'lead'), eq(auditLog.action, 'create')));
    expect(audits).toHaveLength(3);
    expect(audits.every((row) => row.actorUserId === userId)).toBe(true);

    const job = await as().imports.get({ id });
    expect(job).toMatchObject({ status: 'completed', processedRows: 6 });
    expect(job.counts).toEqual({ create: 3, update: 0, skip: 1, error: 2 });
  });

  it('re-running the same sheet creates no duplicates', async () => {
    await importFile(HISTORIC);
    const again = await importFile(HISTORIC);
    expect(again.preview.counts).toEqual({ create: 0, update: 0, skip: 4, error: 2 });
    expect(again.result).toMatchObject({ create: 0, skip: 4 });
    expect(await liveLeads()).toHaveLength(3);
    // Running the finished job again (a retried message) changes nothing either.
    await runImport(db, again.id);
    expect(await liveLeads()).toHaveLength(3);
  });

  it('updates intake fields of imported leads, but never a lead edited in the CRM', async () => {
    await importFile(HISTORIC);
    const [olivia] = await db.select().from(leads).where(eq(leads.sheetLeadId, '101'));
    await db
      .update(leads)
      .set({ crmEditedAt: new Date(), status: 'Proposal Sent' })
      .where(eq(leads.id, olivia?.id ?? ''));

    const edits: Record<number, Record<number, string>> = {
      1: { 10: 'Westmead' }, // Olivia's suburb — but she was edited in the CRM
      2: { 7: '0499 999 999', 4: 'Lost' }, // Jack's mobile; status is never updated (§1.8 rule 3)
    };
    const changed = HISTORIC.map((row, r) => row.map((cell, c) => edits[r]?.[c] ?? cell));
    const { id, result } = await importFile(changed);
    expect(result).toMatchObject({ create: 0, update: 1 });

    const rows = (await as().imports.rows({ id })).rows;
    expect(rows.find((row) => row.rowNumber === 2)?.message).toContain('edited in the CRM');
    expect(rows.find((row) => row.rowNumber === 3)?.message).toBe('Updates primary mobile.');
    const [jack] = await db.select().from(leads).where(eq(leads.sheetLeadId, '102'));
    expect(jack).toMatchObject({ mobile: '+61499999999', status: 'New', crmEditedAt: null });
    const [after] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, olivia?.id ?? ''));
    expect(after).toMatchObject({ suburb: 'Parramatta', status: 'Proposal Sent' });
  });

  it('a row matching a lead already in the CRM is skipped as a duplicate and linked', async () => {
    const { id: existing } = await as().leads.create({
      values: { firstName: 'Olivia', lastName: 'Nguyen', email: 'olivia@example.com' },
    });
    const noIds = HISTORIC.map((row) => row.slice(1));
    const { id, result } = await importFile(noIds.slice(0, 2));
    expect(result).toMatchObject({ create: 0, skip: 1 });
    const [row] = (await as().imports.rows({ id })).rows;
    expect(row).toMatchObject({ action: 'skip', recordId: existing });
    expect(row?.message).toContain('Already in the CRM as Olivia Nguyen (same email');
    expect(await liveLeads()).toHaveLength(1);
  });

  it('the error report lists rows not imported, with formulas neutralised', async () => {
    const { id } = await importFile(HISTORIC);
    const report = await as().imports.errorReport({ id });
    expect(report.fileName).toBe('history - not imported.csv');
    expect(report.csv.charCodeAt(0)).toBe(0xfeff);
    const lines = report.csv.trim().split('\r\n');
    expect(lines[0]).toMatch(/^Row,Result,Reason,Lead ID,Lead Date/);
    expect(lines.slice(1).map((line) => line.split(',')[0])).toEqual(['4', '5', '6']);
    expect(report.csv).not.toContain(',=HYPERLINK');
    expect(report.csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('imports contacts, filling only empty fields of a contact already in the CRM', async () => {
    const existing = await as().contacts.create({
      firstName: 'Mia',
      lastName: 'Wong',
      mobile: '0411 111 111',
      type: 'Residential',
    });
    const { result } = await importFile(
      [
        ['Name', 'Phone', 'Email', 'Address', 'Suburb', 'State', 'Postcode', 'Type'],
        ['Mia Chen', '0411 111 111', 'mia@example.com', '1 Bay Rd', 'Manly', 'NSW', '2095', ''],
        ['Leo Park', '0422 222 222', '', '9 Hill St', 'Darwin', 'NT', '800', 'Commercial'],
        ['Leo Park', '0422 222 222', '', '', '', '', '', ''],
      ],
      'contacts',
    );
    expect(result).toMatchObject({ create: 1, update: 1, skip: 1, error: 0 });
    const [mia] = await db.select().from(contacts).where(eq(contacts.id, existing.id));
    expect(mia).toMatchObject({ lastName: 'Wong', email: 'mia@example.com' });
    const [leo] = await db.select().from(contacts).where(eq(contacts.mobile, '+61422222222'));
    expect(leo).toMatchObject({ firstName: 'Leo', type: 'Commercial', source: 'Import' });
    const [address] = await db
      .select()
      .from(contactAddresses)
      .where(eq(contactAddresses.contactId, leo?.id ?? ''));
    expect(address).toMatchObject({ postcode: '0800', state: 'NT', isPrimary: true });
  });

  it('reads a Google Sheet shared with the service account, any tab', async () => {
    const sheetId = '1mkYuqi8cuit0N2dPlraGi87OYwYFNK0Z55M3zlibu-c';
    sheets = fakeSheets({ [sheetId]: { Notes: [['just notes']], Leads: HISTORIC } });
    const { id } = await as().imports.fromGoogleSheet({
      target: 'leads',
      url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit?usp=sharing`,
    });
    expect((await as().imports.source({ id })).tabs).toEqual(['Notes', 'Leads']);
    await as().imports.chooseTab({ id, tab: 'Leads' });
    const source = await as().imports.source({ id });
    expect(source).toMatchObject({ tab: 'Leads', rowCount: 6 });
    const preview = await as().imports.preview({ id, mapping: source.mapping });
    expect(preview.counts.create).toBe(3);

    await expect(
      as().imports.fromGoogleSheet({
        target: 'leads',
        url: 'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/edit',
      }),
    ).rejects.toThrow("isn't shared with crm-sync@");
    await expect(
      as().imports.fromGoogleSheet({ target: 'leads', url: 'not a link' }),
    ).rejects.toThrow("doesn't look like a Google Sheets link");
  });

  it('explains what is missing when Google Sheets is not configured', async () => {
    const caller = createCaller(
      fakeContext(
        {
          status: 'authenticated',
          user: fakeUser({ id: userId, permissions: allPermissions() }),
          firebaseUid: 'uid',
        },
        { db, storage: memory.storage, jobs: queue, sheets: null },
      ),
    );
    expect((await caller.imports.setup()).googleSheets).toBeNull();
    await expect(
      caller.imports.fromGoogleSheet({
        target: 'leads',
        url: 'https://docs.google.com/spreadsheets/d/1mkYuqi8cuit0N2dPlraGi87OYwYFNK0Z55M3zlibu-c',
      }),
    ).rejects.toThrow('GOOGLE_SERVICE_ACCOUNT_PATH');
  });

  it('refuses bad mappings, starting before a preview, and changes after starting', async () => {
    const { id } = await upload(HISTORIC);
    await expect(as().imports.start({ id })).rejects.toThrow('Preview the import first');
    await expect(as().imports.preview({ id, mapping: { lastName: 'Last Name' } })).rejects.toThrow(
      'Map a First Name column',
    );
    await expect(
      as().imports.preview({ id, mapping: { firstName: 'Nope', mobile: 'Primary Mobile' } }),
    ).rejects.toThrow('no longer has these columns: Nope');
    const source = await as().imports.source({ id });
    await as().imports.preview({ id, mapping: source.mapping });
    await as().imports.start({ id });
    await expect(as().imports.start({ id })).rejects.toThrow('already been started');
    await expect(as().imports.discard({ id })).rejects.toThrow('already been started');
    expect(sent).toHaveLength(1);
  });

  it('rejects unreadable files with a clear message', async () => {
    const bytes = Buffer.from('not really a workbook');
    const ticket = await as().imports.createUpload({
      target: 'leads',
      fileName: 'x.xlsx',
      sizeBytes: bytes.length,
    });
    memory.objects.set(ticket.uploadUrl.replace('memory://', ''), bytes);
    await expect(as().imports.completeUpload({ id: ticket.id })).rejects.toThrow(
      "can't be read as an Excel workbook",
    );
    await expect(
      as().imports.createUpload({ target: 'leads', fileName: 'x.pdf', sizeBytes: 10 }),
    ).rejects.toThrow('Upload a .csv or .xlsx file.');
  });

  it('needs create and edit on the target', async () => {
    const salesLike = emptyPermissionMatrix();
    salesLike.leads = { view: true, create: true, edit: true, delete: false, export: false };
    salesLike.contacts = { view: true, create: false, edit: true, delete: false, export: false };
    expect((await as(salesLike).imports.setup()).targets).toEqual(['leads']);
    await expect(
      as(salesLike).imports.createUpload({ target: 'contacts', fileName: 'c.csv', sizeBytes: 10 }),
    ).rejects.toThrow('does not allow this import');

    const { id } = await upload(
      [
        ['Name', 'Phone'],
        ['A B', '0411 000 000'],
      ],
      'contacts',
    );
    await expect(as(salesLike).imports.get({ id })).rejects.toThrow('does not allow this import');
    expect(await as(salesLike).imports.list()).toEqual([]);
  });

  it('discarding an unstarted import removes it and its file', async () => {
    const { id } = await upload(HISTORIC);
    expect(memory.objects.size).toBe(1);
    await as().imports.discard({ id });
    expect(memory.objects.size).toBe(0);
    expect(await db.select().from(importJobs)).toHaveLength(0);
  });
});
