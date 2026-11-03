import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyPermissionMatrix, type PermissionMatrix } from '@mms/shared';
import { activities, auditLog } from '../../db/schema/index.ts';
import { loadLegacySeedInput, seed } from '../../db/seed.ts';
import { createTestDb, truncateAll } from '../../test/db.ts';
import { allPermissions, fakeContext, fakeUser } from '../../test/fakes.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { upsertUser } from '../../users/upsert-user.ts';

const createCaller = createCallerFactory(appRouter);
const DOMAIN = 'makemysolar.com.au';

describe('project workspace sections (Step 2.7)', () => {
  const db = createTestDb();
  let micky = '';
  let projectId = '';

  function as(permissions: PermissionMatrix = allPermissions()) {
    return createCaller(
      fakeContext(
        { status: 'authenticated', user: fakeUser({ id: micky, permissions }), firebaseUid: 'uid' },
        { db },
      ),
    );
  }

  beforeEach(async () => {
    await truncateAll(db);
    await seed(db, await loadLegacySeedInput());
    ({ id: micky } = await upsertUser(
      db,
      { email: `micky@${DOMAIN}`, name: 'Micky', roleKey: 'admin' },
      DOMAIN,
    ));
    const api = as();
    const { id: leadId } = await api.leads.create({
      values: {
        firstName: 'Olivia',
        lastName: 'Nguyen',
        mobile: '0412 345 678',
        streetAddress: '12 Church St',
        suburb: 'Parramatta',
        state: 'NSW',
        postcode: '2150',
        platform: 'Meta',
        ownerUserId: micky,
      },
    });
    await api.leads.updatePricing({ id: leadId, values: { sellingPriceAud: '14990' } });
    ({ id: projectId } = await api.projects.convertLead({ leadId }));
  });
  afterAll(() => db.$client.end());

  const timeline = () =>
    db
      .select({ subject: activities.subject })
      .from(activities)
      .where(and(eq(activities.entityType, 'project'), eq(activities.entityId, projectId)));

  const audits = (action: string) =>
    db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, projectId), eq(auditLog.action, action)));

  const allYes = {
    customerNameMatch: 'Yes',
    addressMatch: 'Yes',
    meterMatch: 'Yes',
    meterPhase: 'Three Phase',
    openSolarSystemMatch: 'Variance Verified',
    openSolarPricingMatch: 'Yes',
  };

  it('EB verification: the meter phase is compared with the site, and passing all six verifies', async () => {
    const api = as();
    await api.projects.updateEbVerification({ id: projectId, values: allYes });
    let project = await api.projects.get({ id: projectId });
    // The site has no phase yet, so the meter phase can't pass.
    expect(project.ebChecks.find((c) => c.key === 'meterPhase')).toMatchObject({
      state: 'attention',
    });
    expect(project.eb?.verifiedAt).toBeNull();

    const site = await api.projects.get({ id: projectId });
    await api.projects.updateSite({
      id: projectId,
      values: {
        streetAddress: site.streetAddress,
        suburb: site.suburb,
        state: 'NSW',
        postcode: '2150',
        phase: 'Three Phase',
      },
    });
    await api.projects.updateEbVerification({
      id: projectId,
      values: { ...allYes, docsReceived: 'Yes', docsReceivedDate: '2026-11-01' },
    });
    project = await api.projects.get({ id: projectId });
    expect(project.ebChecks.every((c) => c.state === 'passed')).toBe(true);
    expect(project.eb).toMatchObject({ verifiedByName: 'Micky', docsReceived: 'Yes' });
    expect((await timeline()).map((a) => a.subject)).toContain(
      'Electricity bill verified — all 6 checks passed',
    );

    // A failing answer clears the verification.
    await api.projects.updateEbVerification({
      id: projectId,
      values: { ...allYes, meterMatch: 'Discrepancy Flagged' },
    });
    project = await api.projects.get({ id: projectId });
    expect(project.eb?.verifiedAt).toBeNull();
    expect(project.ebChecks.find((c) => c.key === 'meterMatch')?.state).toBe('attention');

    await expect(
      api.projects.updateEbVerification({ id: projectId, values: { meterMatch: 'Maybe' } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('grid application: validates dates and options, logs status, filters the list', async () => {
    const api = as();
    await expect(
      api.projects.updateGridApplication({
        id: projectId,
        values: { status: 'Grid App Approved', appliedDate: '2026-10-01' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      api.projects.updateGridApplication({
        id: projectId,
        values: { electricityDistributor: 'Not a DNSP' },
      }),
    ).rejects.toThrow(/not an available DNSP/);
    await expect(
      api.projects.updateGridApplication({
        id: projectId,
        values: { appliedDate: '2026-10-10', approvalDate: '2026-10-01' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await api.projects.updateGridApplication({
      id: projectId,
      values: {
        electricityDistributor: 'Endeavour Energy',
        applicationRef: 'EE-12345',
        status: 'Grid App Approved',
        appliedDate: '2026-10-01',
        approvalDate: '2026-10-15',
      },
    });
    const project = await api.projects.get({ id: projectId });
    expect(project.grid).toMatchObject({
      applicationRef: 'EE-12345',
      timing: { days: 14, decided: true },
    });
    expect((await timeline()).map((a) => a.subject)).toContain(
      'Grid application: Grid App Approved',
    );
    const list = await api.projects.list({ dnsp: 'Endeavour Energy' });
    expect(list.rows.map((r) => r.id)).toEqual([projectId]);
    expect((await api.projects.list({ dnsp: 'Ausgrid' })).total).toBe(0);

    // Saving the same values again changes nothing and writes no audit row.
    const before = (await audits('update_grid')).length;
    await api.projects.updateGridApplication({
      id: projectId,
      values: {
        electricityDistributor: 'Endeavour Energy',
        applicationRef: 'EE-12345',
        status: 'Grid App Approved',
        appliedDate: '2026-10-01',
        approvalDate: '2026-10-15',
      },
    });
    expect(await audits('update_grid')).toHaveLength(before);
  });

  it('finance: details need a finance option and the approval cannot exceed the price', async () => {
    const api = as();
    await expect(
      api.projects.updateFinance({
        id: projectId,
        values: { financeOption: 'No (Cash / Direct Payment)', financeCompany: 'Brighte' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      api.projects.updateFinance({
        id: projectId,
        values: { financeOption: 'Yes (Green Finance)', approvedAmountAud: '20000' },
      }),
    ).rejects.toThrow(/more than the job's price/);

    await api.projects.updateFinance({
      id: projectId,
      values: {
        financeOption: 'Yes (Green Finance)',
        financeCompany: 'Brighte',
        status: 'Unconditionally Approved',
        appliedDate: '2026-10-01',
        approvedDate: '2026-10-03',
        approvedAmountAud: '12000',
      },
    });
    const project = await api.projects.get({ id: projectId });
    expect(project.finance).toMatchObject({ onFinance: true, approvedAmountAud: '12000.00' });
    expect((await api.projects.list({ finance: 'Yes (Green Finance)' })).total).toBe(1);
  });

  it('warehouse: saves with option checks and audits only the changed fields', async () => {
    const api = as();
    await api.projects.updateWarehouse({
      id: projectId,
      values: {
        warehouse: 'Sydney Central DC (Alexandria)',
        salesOrderNumber: 'SO-1001',
        stockStatus: 'Allocated to Job',
      },
    });
    await api.projects.updateWarehouse({
      id: projectId,
      values: {
        warehouse: 'Sydney Central DC (Alexandria)',
        salesOrderNumber: 'SO-1001',
        stockStatus: 'Dispatched to Site',
      },
    });
    const [, second] = await audits('update_warehouse');
    expect(second?.changes).toEqual({
      before: { stockStatus: 'Allocated to Job' },
      after: { stockStatus: 'Dispatched to Site' },
    });
    await expect(
      api.projects.updateWarehouse({
        id: projectId,
        values: { invoiceDate: '2026-10-10', invoicePaidDate: '2026-10-01' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('installation: the installer must be a subcontractor company; the month is worked out', async () => {
    const api = as();
    const { id: vendor } = await api.companies.create({
      name: 'Panel Wholesale',
      type: 'Equipment Vendor',
    });
    const { id: installer } = await api.companies.create({
      name: 'Western Sparkies',
      type: 'Subcontractor Installer',
    });
    await expect(
      api.projects.updateInstallation({ id: projectId, values: { installerCompanyId: vendor } }),
    ).rejects.toThrow(/Subcontractor Installer/);

    await api.projects.updateInstallation({
      id: projectId,
      values: {
        status: 'Installation Completed',
        installerCompanyId: installer,
        installerQuotedAud: '2400',
        bookingDate: '2026-10-20',
        bookedByUserId: micky,
        completedDate: '2026-10-21',
      },
    });
    const project = await api.projects.get({ id: projectId });
    expect(project.installation).toMatchObject({
      installerName: 'Western Sparkies',
      bookedByName: 'Micky',
      completedMonth: 'October 2026',
    });
    expect((await api.projects.list({ installerCompanyId: installer })).total).toBe(1);
    expect((await api.projects.installers()).map((c) => c.name)).toEqual(['Western Sparkies']);
  });

  it('STC claim: totals are worked out on the server', async () => {
    const api = as();
    await api.projects.updateStcClaim({
      id: projectId,
      values: {
        portal: 'BridgeSelect',
        jobNumber: 'BS-778',
        status: 'Approved & Traded',
        submittedDate: '2026-10-22',
        solarStcs: 80,
        solarStcsAmountAud: '3040',
        solarStcsReceivedDate: '2026-10-30',
        batteryStcs: 50,
        batteryStcsAmountAud: '1900',
        adminChargesAud: '50',
        customerStcRateAud: '38',
      },
    });
    const project = await api.projects.get({ id: projectId });
    expect(project.stc?.totals).toEqual({
      totalStcs: 130,
      totalReceivedAud: '3040.00',
      outstandingAud: '1900.00',
      netReceivedAud: '2990.00',
      customerValueAud: '4940.00',
      internalValueAud: null,
    });
    expect((await api.projects.list({ stcStatus: 'Approved & Traded' })).total).toBe(1);
    await expect(
      api.projects.updateStcClaim({
        id: projectId,
        values: { batteryStcsReceivedDate: '2026-10-30' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('OpenSolar: the signed date round-trips and needs the box ticked', async () => {
    const api = as();
    await expect(
      api.projects.updateOpenSolar({ id: projectId, values: { contractSigned: true } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      api.projects.updateOpenSolar({
        id: projectId,
        values: { signedUrl: 'http://example.com/contract' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const values = {
      openSolarProjectId: '4471102',
      signedUrl: 'https://example.com/contract',
      contractSigned: true,
      contractSignedDate: '2026-10-28',
    };
    await api.projects.updateOpenSolar({ id: projectId, values });
    const project = await api.projects.get({ id: projectId });
    expect(project.openSolar).toMatchObject({
      openSolarProjectId: '4471102',
      contractSigned: true,
      contractSignedDate: '2026-10-28',
    });
    expect((await timeline()).map((a) => a.subject)).toContain('Contract signed (OpenSolar)');
    await api.projects.updateOpenSolar({ id: projectId, values });
    expect(await audits('update_opensolar')).toHaveLength(1);
  });

  it('needs projects:edit to change a section', async () => {
    const viewOnly = emptyPermissionMatrix();
    viewOnly.projects.view = true;
    await expect(
      as(viewOnly).projects.updateGridApplication({ id: projectId, values: {} }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const project = await as(viewOnly).projects.get({ id: projectId });
    expect(project.grid).toBeNull();
    expect(project.ebChecks).toHaveLength(6);
  });
});
