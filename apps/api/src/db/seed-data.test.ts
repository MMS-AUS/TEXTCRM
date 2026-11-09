import { describe, expect, it } from 'vitest';
import { loadLegacySeedInput } from './seed.ts';
import {
  SKIPPED_OPTION_LISTS,
  buildHardware,
  buildOptionLists,
  listNameFromKey,
} from './seed-data.ts';

describe('listNameFromKey', () => {
  it('turns camelCase keys into sentence-case names', () => {
    expect(listNameFromKey('leadStatuses')).toBe('Lead statuses');
    expect(listNameFromKey('ebCustomerNameMatchOptions')).toBe('Eb customer name match options');
    expect(listNameFromKey('dnspsNSW')).toBe('Dnsps NSW');
  });
});

describe('buildOptionLists', () => {
  it('skips lists that become user references or derived values (§1.6)', () => {
    const lists = buildOptionLists({
      leadStatuses: ['New'],
      salesPersons: ['Simon'],
      panelBrands: ['AIKO Solar'],
      installationMonths: ['January 2026'],
    });
    expect(lists.map((l) => l.key)).toEqual(['leadStatuses']);
  });

  it('trims, drops blanks and duplicates, and keeps the original order', () => {
    const [list] = buildOptionLists({
      phases: [' Single Phase ', '', 'Three Phase', 'Single Phase'],
    });
    expect(list?.options).toEqual([
      { value: 'Single Phase', label: 'Single Phase', sortOrder: 10 },
      { value: 'Three Phase', label: 'Three Phase', sortOrder: 20 },
    ]);
  });

  it('rejects a malformed file', () => {
    expect(() => buildOptionLists({ phases: 'Single Phase' })).toThrow();
  });
});

describe('buildHardware', () => {
  const base = { panelHierarchy: [], inverterHierarchy: [], batteryHierarchy: [] };

  it('keeps the first row per manufacturer + model', () => {
    const hw = buildHardware({
      ...base,
      panelHierarchy: [
        { id: '1', manufacturer: 'Suntech', model: 'STP415S', series: 'STP415S', sizeW: 415 },
        { id: '2', manufacturer: 'Suntech', model: 'STP415S', series: 'C54', sizeW: 415 },
      ],
    });
    expect(hw.panels).toEqual([
      { manufacturer: 'Suntech', model: 'STP415S', series: 'STP415S', sizeW: '415' },
    ]);
  });

  it("stores 'N/A' or missing series as null", () => {
    const hw = buildHardware({
      ...base,
      batteryHierarchy: [
        {
          id: '1',
          manufacturer: 'Alpha ESS',
          model: 'SMILE-BAT-5P',
          series: 'N/A',
          usableCapacityKwh: 4.79,
          size: '4.79kWh System',
        },
      ],
    });
    expect(hw.batteries[0]).toMatchObject({ series: null, usableCapacityKwh: '4.79' });
  });
});

describe('legacy reference files', () => {
  it('produce the expected seed sizes', async () => {
    const input = await loadLegacySeedInput();
    const lists = buildOptionLists(input.dropdowns);
    const hw = buildHardware(input.hardware);

    expect(lists).toHaveLength(56 - SKIPPED_OPTION_LISTS.size);
    expect(lists.some((l) => SKIPPED_OPTION_LISTS.has(l.key))).toBe(false);
    // §1.7 counts minus duplicate manufacturer+model rows (70 panels, 146 inverters).
    expect(hw.panels).toHaveLength(791);
    expect(hw.inverters).toHaveLength(854);
    expect(hw.batteries).toHaveLength(427);
  });

  it('offers Warehouse as its own contact type, after the original six', async () => {
    const lists = buildOptionLists((await loadLegacySeedInput()).dropdowns);
    const contactTypes = lists.find((l) => l.key === 'contactTypes')?.options ?? [];
    expect(contactTypes.map((o) => o.value)).toEqual([
      'Residential',
      'Commercial',
      'Subcontractor',
      'Vendor',
      'Government / Council',
      'Partner',
      'Warehouse',
    ]);
    expect(contactTypes.at(-1)?.sortOrder).toBe(70);
  });
});
