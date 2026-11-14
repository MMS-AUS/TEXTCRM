import { eq, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  activities,
  auditLog,
  contactAddresses,
  contacts,
  leads,
  projectGridApplications,
  projectPricing,
  projects,
  projectSystemDesign,
  projectSystemInverters,
} from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { upsertUser } from '../../users/upsert-user.ts';
import {
  legacyContactSchema,
  legacyLeadSchema,
  legacyProjectSchema,
  type LegacyData,
} from './legacy-data.ts';
import { migrateLegacy } from './migrate.ts';

// Made-up customers in the exact shape of the old CRM's files (no real data in the repo).
const lead = (overrides: Record<string, unknown>) =>
  legacyLeadSchema.parse({
    platform: 'Website',
    status: 'New',
    state: 'NSW',
    batteryRequired: false,
    propertyType: 'Residential',
    systemPrice: '',
    createdAt: '2026-10-03T13:47:09.199056+00:00',
    activities: [{ id: 'act-1', title: 'Lead Created', createdBy: 'Mitchell Barnes' }],
    ...overrides,
  });

function legacyData(): LegacyData {
  return {
    contacts: [
      legacyContactSchema.parse({
        id: 'c-1',
        firstName: 'Ava',
        lastName: 'Stone',
        email: 'ava@example.com',
        phone: '0400 000 001',
        contactType: 'Residential',
        addresses: [
          { street: '1 Main St', suburb: 'Logan', state: 'QLD', postcode: '4114', isPrimary: true },
          {
            street: '9 Side Rd',
            suburb: 'Camden',
            state: 'NSW',
            postcode: '2570',
            isPrimary: false,
          },
        ],
      }),
      legacyContactSchema.parse({
        id: 'c-2',
        firstName: 'Ben',
        lastName: 'Hill',
        email: 'ben@example.com',
        phone: '0400 000 002',
        streetAddress: '5 Oak Pl',
        suburb: 'Cromer',
        state: 'NSW',
        postcode: '2099',
      }),
    ],
    leads: [
      lead({
        id: 'lead-sheet-GSHEET_ROW_7',
        leadDate: '2026-09-16',
        firstName: 'Ava',
        lastName: 'Stone',
        email: 'ava@example.com',
        primaryMobile: '0400 000 001',
        address: '9 Side Rd',
        suburb: 'Camden',
        postcode: '2570',
      }),
      lead({
        id: 'lead-sheet-GSHEET_ROW_4',
        projectNumber: '9979467',
        leadDate: '2026-09-16',
        saleDate: '2026-09-16',
        status: 'Converted to Project',
        firstName: 'Ava',
        lastName: 'Stone',
        email: 'ava@example.com',
        primaryMobile: '0400 000 001',
        address: '1 Main St',
        suburb: 'Logan',
        state: 'QLD',
        postcode: '4114',
        systemPrice: '$6328',
        sellingPrice: '$4550',
        deposit: '$455.05',
        systemSizeKw: 6.65,
        phaseType: 'Single Phase',
        houseStorey: 'Double Storey',
        roofType: 'Slate',
      }),
      lead({
        id: 'lead-sheet-GSHEET_ROW_6',
        leadDate: '2026-08-22',
        platform: 'Energy Matters',
        firstName: 'Ben',
        lastName: 'Hill',
        email: 'ben@example.com',
        primaryMobile: '0400 000 002',
        address: '5 Oak Pl',
        suburb: 'Cromer',
        postcode: '2099',
      }),
    ],
    projects: [
      legacyProjectSchema.parse({
        id: 'p-1',
        projectNumber: '9979467',
        title: '6.65kW Solar System',
        projectStage: 'Grid Meter Connected',
        customerEmail: 'ava@example.com',
        streetAddress: '1 Main St',
        saleDate: '2026-09-16',
        depositReceivedDate: '2026-09-20',
        notes: 'Testing update',
        systemSizeKw: 6.65,
        panelModel: 'LR7-54HVH-475M (IEC 61215-2021)',
        noOfPanels: '14',
        inverterModel: 'X1-BOOST-5K-G4 (AS4777-2 2020)',
        noOfInverters: '1',
        nmi: '31156160966',
        sellingPrice: '4550',
        systemPrice: '6328',
        deposit: '455.05',
        dnsp: 'Energex',
        gridAppRef: 'CX26GRO1423965A',
        gridAppStatus: 'Grid App Approved',
        gridAppliedDate: '2026-09-22',
        gridApprovalDate: '2026-09-22',
        retailerRef: 'RET-001',
        isOnFinance: 'No',
        financeCompanyName: 'Plenti',
        stcSubmittedDate: '2026-10-23',
        solarStcs: '45',
        solarStcsAmount: '1822.5',
        solarStcReceivedDate: '2026-09-25',
      }),
    ],
  };
}

describe('legacy migration (Step 3.4)', () => {
  const db = createTestDb();
  let micky = '';

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: micky } = await upsertUser(
      db,
      { email: 'micky@makemysolar.com.au', name: 'Micky', roleKey: 'admin' },
      'makemysolar.com.au',
    ));
  });
  afterAll(() => db.$client.end());

  const migrate = (commit: boolean, extra: { keepBoth?: boolean } = {}) =>
    migrateLegacy(db, legacyData(), { actorEmail: 'micky@makemysolar.com.au', commit, ...extra });
  const live = () => db.select().from(leads).where(isNull(leads.deletedAt));

  it('a dry run reports everything and saves nothing', async () => {
    const report = await migrate(false);
    expect(report.committed).toBe(false);
    const actions = report.lines.map((line) => `${line.area}:${line.action}`);
    expect(actions.filter((a) => a === 'Contact:create')).toHaveLength(2);
    expect(actions.filter((a) => a === 'Lead:create')).toHaveLength(2);
    expect(actions).toContain('Lead:merge');
    expect(actions).toContain('Project:create');
    expect(await db.select().from(leads)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(await db.select().from(projects)).toHaveLength(0);
    expect(
      await db.select().from(auditLog).where(eq(auditLog.requestId, 'legacy-migration')),
    ).toHaveLength(0);
  });

  it('imports the customers, merges the second lead and keeps the project number', async () => {
    const report = await migrate(true);
    expect(report.committed).toBe(true);

    const people = await db.select().from(contacts);
    expect(people.map((c) => c.email).sort()).toEqual(['ava@example.com', 'ben@example.com']);
    expect(people.every((c) => c.source === 'Old CRM')).toBe(true);
    const ava = people.find((c) => c.email === 'ava@example.com');
    const addresses = await db
      .select()
      .from(contactAddresses)
      .where(eq(contactAddresses.contactId, ava?.id ?? ''));
    expect(addresses.map((a) => a.suburb).sort()).toEqual(['Camden', 'Logan']);

    const all = await live();
    expect(all).toHaveLength(2); // Ava's second lead is merged, not created
    const avaLead = all.find((l) => l.email === 'ava@example.com');
    expect(avaLead).toMatchObject({
      suburb: 'Logan',
      status: 'Converted to Project',
      contactId: ava?.id,
      saleDate: '2026-09-16',
    });
    expect(avaLead?.createdAt.toISOString()).toBe('2026-10-03T13:47:09.199Z');
    const notes = (
      await db
        .select()
        .from(activities)
        .where(eq(activities.entityId, avaLead?.id ?? ''))
    ).map((a) => a.subject);
    expect(notes.some((n) => n?.startsWith('Merged from the old CRM: a second enquiry'))).toBe(
      true,
    );
    expect(
      notes.some((n) => n?.startsWith('Migrated from the old CRM (lead-sheet-GSHEET_ROW_4')),
    ).toBe(true);

    const [project] = await db.select().from(projects);
    expect(project).toMatchObject({
      projectNumber: '9979467',
      title: '6.65kW Solar System',
      stage: 'DNSP Grid Inspection & Metering',
      leadId: avaLead?.id,
      contactId: ava?.id,
      saleDate: '2026-09-16',
      nmi: '31156160966',
      houseStorey: 'Double Storey',
      phase: 'Single Phase',
      notes: null, // "Testing update" is placeholder content
    });
    const [design] = await db
      .select()
      .from(projectSystemDesign)
      .where(eq(projectSystemDesign.projectId, project?.id ?? ''));
    expect(design).toMatchObject({ systemSizeKw: '6.65', panelCount: 14 });
    // The legacy project's one inverter is the project's first (and only) inverter line.
    const inverterLines = await db
      .select()
      .from(projectSystemInverters)
      .where(eq(projectSystemInverters.projectId, project?.id ?? ''));
    expect(inverterLines).toHaveLength(1);
    expect(inverterLines[0]).toMatchObject({ count: 1, type: 'grid', position: 0 });
    expect(design?.panelId).not.toBeNull();
    const [pricing] = await db
      .select()
      .from(projectPricing)
      .where(eq(projectPricing.projectId, project?.id ?? ''));
    expect(pricing).toMatchObject({
      sellingPriceAud: '4550.00',
      depositReceivedDate: '2026-09-20',
    });
    const [grid] = await db
      .select()
      .from(projectGridApplications)
      .where(eq(projectGridApplications.projectId, project?.id ?? ''));
    expect(grid).toMatchObject({ applicationRef: 'CX26GRO1423965A', retailerRef: null });

    // The contradictory STC dates are reported, not guessed.
    expect(report.lines.find((l) => l.action === 'problem')?.detail).toContain('STC claim');
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.requestId, 'legacy-migration'));
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.every((a) => a.actorUserId === micky)).toBe(true);
  });

  it('running it again changes nothing', async () => {
    await migrate(true);
    const again = await migrate(true);
    expect(again.lines.filter((l) => l.action === 'create')).toHaveLength(0);
    expect(again.lines.find((l) => l.area === 'Project')?.action).toBe('skip');
    expect(await live()).toHaveLength(2);
    expect(await db.select().from(contacts)).toHaveLength(2);
    expect(await db.select().from(projects)).toHaveLength(1);
  });

  it('uses leads already in the CRM (e.g. from the live sheet) and retires the merged twin', async () => {
    const values = (suburb: string, street: string, postcode: string, state: string) => ({
      firstName: 'Ava',
      lastName: 'Stone',
      email: 'ava@example.com',
      mobile: '+61400000001',
      streetAddress: street,
      suburb,
      state,
      postcode,
      leadDate: '2026-09-16',
      status: 'New',
    });
    const [main] = await db
      .insert(leads)
      .values({ ...values('Logan', '1 Main St', '4114', 'QLD'), sheetLeadId: '3' })
      .returning();
    const [twin] = await db
      .insert(leads)
      .values({ ...values('Camden', '9 Side Rd', '2570', 'NSW'), sheetLeadId: '6' })
      .returning();
    const report = await migrate(true);
    expect(report.lines.find((l) => l.action === 'merge')?.detail).toContain('Lead ID 6');
    const [kept] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, main?.id ?? ''));
    expect(kept).toMatchObject({ status: 'Converted to Project' });
    expect(kept?.contactId).not.toBeNull();
    const [retired] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, twin?.id ?? ''));
    expect(retired?.deletedAt).not.toBeNull();
    expect(retired?.crmEditedAt).not.toBeNull(); // the live sheet won't revive it
    expect((await db.select().from(projects))[0]?.leadId).toBe(main?.id);
  });

  it('--keep-both imports the second property as its own lead', async () => {
    await migrate(true, { keepBoth: true });
    expect(await live()).toHaveLength(3);
  });

  it('refuses to run as someone who is not an active CRM user', async () => {
    await expect(
      migrateLegacy(db, legacyData(), { actorEmail: 'nobody@makemysolar.com.au', commit: false }),
    ).rejects.toThrow('not an active CRM user');
  });
});
