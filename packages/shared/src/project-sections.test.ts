import { describe, expect, it } from 'vitest';
import {
  completedMonth,
  ebCheckResults,
  financeSchema,
  gridApplicationSchema,
  gridTiming,
  openSolarSchema,
  stcTotals,
} from './project-sections.ts';

describe('ebCheckResults', () => {
  it('passes the accepted answers and compares the meter phase with the site', () => {
    const results = ebCheckResults(
      {
        customerNameMatch: 'Yes',
        addressMatch: 'Pending Land Title / Sub-lot',
        meterPhase: 'Two Phase / Split',
        openSolarSystemMatch: 'Variance Verified',
      },
      'Split Phase',
    );
    expect(Object.fromEntries(results.map((r) => [r.key, r.state]))).toEqual({
      customerNameMatch: 'passed',
      addressMatch: 'attention',
      meterMatch: 'unanswered',
      meterPhase: 'passed',
      openSolarSystemMatch: 'passed',
      openSolarPricingMatch: 'unanswered',
    });
  });

  it('flags a meter phase that differs from the site, or a site with no phase', () => {
    expect(ebCheckResults({ meterPhase: 'Single Phase' }, 'Three Phase')[3]).toMatchObject({
      state: 'attention',
      note: 'The site is recorded as Three Phase.',
    });
    expect(ebCheckResults({ meterPhase: 'Single Phase' }, null)[3]?.state).toBe('attention');
  });
});

describe('stcTotals', () => {
  const empty = {
    solarStcs: null,
    solarStcsAmountAud: null,
    solarStcsReceivedDate: null,
    batteryStcs: null,
    batteryStcsAmountAud: null,
    batteryStcsReceivedDate: null,
    adminChargesAud: null,
    customerStcRateAud: null,
    internalStcRateAud: null,
  };

  it('is all null when nothing is entered', () => {
    expect(stcTotals(empty)).toEqual({
      totalStcs: null,
      totalReceivedAud: null,
      outstandingAud: null,
      netReceivedAud: null,
      customerValueAud: null,
      internalValueAud: null,
    });
  });

  it('counts only amounts with a received date, in exact cents', () => {
    expect(
      stcTotals({
        ...empty,
        solarStcs: 81,
        solarStcsAmountAud: '3077.19',
        solarStcsReceivedDate: '2026-10-30',
        batteryStcs: 33,
        batteryStcsAmountAud: '1254.01',
        batteryStcsReceivedDate: '2026-10-31',
        adminChargesAud: '0.10',
        internalStcRateAud: '37.10',
      }),
    ).toEqual({
      totalStcs: 114,
      totalReceivedAud: '4331.20',
      outstandingAud: '0.00',
      netReceivedAud: '4331.10',
      customerValueAud: null,
      internalValueAud: '4229.40',
    });
  });
});

describe('section rules', () => {
  it('grid: a decision needs an applied date that is not after it', () => {
    expect(gridApplicationSchema.safeParse({ approvalDate: '2026-10-01' }).success).toBe(false);
    expect(
      gridApplicationSchema.safeParse({ appliedDate: '2026-10-01', rejectedDate: '2026-10-05' })
        .success,
    ).toBe(true);
    expect(
      gridTiming(
        { appliedDate: '2026-10-01', approvalDate: null, rejectedDate: null },
        '2026-10-11',
      ),
    ).toEqual({ days: 10, decided: false });
  });

  it('finance: cash jobs carry no finance details', () => {
    expect(financeSchema.safeParse({ financeOption: 'No (Cash / Direct Payment)' }).success).toBe(
      true,
    );
    expect(financeSchema.safeParse({ financeCompany: 'Brighte' }).success).toBe(false);
  });

  it('OpenSolar: only https links; signed needs a date and a date needs signed', () => {
    expect(openSolarSchema.safeParse({ signedUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(openSolarSchema.safeParse({ contractSignedDate: '2026-10-01' }).success).toBe(false);
    expect(
      openSolarSchema.safeParse({ contractSigned: true, contractSignedDate: '2026-10-01' }).success,
    ).toBe(true);
  });

  it('completedMonth names the month of the date', () => {
    expect(completedMonth('2026-01-31')).toBe('January 2026');
    expect(completedMonth(null)).toBeNull();
  });
});
