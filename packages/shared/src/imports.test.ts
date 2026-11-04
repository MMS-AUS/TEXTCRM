import { describe, expect, it } from 'vitest';
import {
  mappingProblems,
  mapRow,
  matchOption,
  parseSheetDate,
  parseYesNo,
  splitFullName,
  suggestMapping,
} from './imports.ts';

describe('suggestMapping', () => {
  it('recognises the old intake template and common spellings', () => {
    expect(
      suggestMapping('leads', [
        'Lead ID',
        'Date',
        'Sales Person',
        'First name',
        'Surname',
        'Phone Number',
        'E-mail',
        'Post Code',
        'Battery',
        'Comments',
      ]),
    ).toEqual({
      sheetLeadId: 'Lead ID',
      leadDate: 'Date',
      ownerName: 'Sales Person',
      firstName: 'First name',
      lastName: 'Surname',
      mobile: 'Phone Number',
      email: 'E-mail',
      postcode: 'Post Code',
      batteryRequired: 'Battery',
      notes: 'Comments',
    });
  });

  it('uses each column once and ignores unknown ones', () => {
    expect(suggestMapping('contacts', ['Name', 'Mobile', 'Favourite colour'])).toEqual({
      fullName: 'Name',
      mobile: 'Mobile',
    });
  });
});

describe('mappingProblems', () => {
  it('needs a name and a way to reach the customer', () => {
    expect(mappingProblems('leads', { lastName: 'Surname' })).toEqual([
      'Map a First Name or Full Name column.',
      'Map a mobile or an email column so customers can be reached.',
    ]);
    expect(mappingProblems('leads', { fullName: 'Name', email: 'Email' })).toEqual([]);
  });

  it('rejects unknown fields, reused columns, and a missing Lead ID when required', () => {
    expect(
      mappingProblems(
        'contacts',
        { firstName: 'A', mobile: 'A', status: 'B' },
        { requireLeadId: true },
      ),
    ).toEqual([
      '"status" is not a field you can import.',
      'Map the Lead ID column — the live sync needs it to recognise each row.',
      'Each column can fill only one field.',
    ]);
  });
});

describe('parseSheetDate', () => {
  it.each([
    ['3/11/2026', '2026-11-03'],
    ['03-11-26', '2026-11-03'],
    ['3.11.2026', '2026-11-03'],
    ['2026-11-03', '2026-11-03'],
    ['2026-11-03T10:00:00Z', '2026-11-03'],
    ['3/11/2026 9:15 AM', '2026-11-03'],
    ['46329', '2026-11-03'],
  ])('reads %s as day-first', (text, iso) => {
    expect(parseSheetDate(text)).toBe(iso);
  });

  it('is null when empty and false when unreadable', () => {
    expect(parseSheetDate('  ')).toBeNull();
    expect(parseSheetDate('31/2/2026')).toBe(false);
    expect(parseSheetDate('13/13/2026')).toBe(false);
    expect(parseSheetDate('next Tuesday')).toBe(false);
  });
});

describe('cell helpers', () => {
  it('parseYesNo', () => {
    expect(parseYesNo('Yes')).toBe(true);
    expect(parseYesNo(' n ')).toBe(false);
    expect(parseYesNo('')).toBeNull();
    expect(parseYesNo('maybe')).toBeUndefined();
  });

  it('splitFullName keeps everything after the first word as the last name', () => {
    expect(splitFullName(' Mary  Anne de Silva ')).toEqual({
      firstName: 'Mary',
      lastName: 'Anne de Silva',
    });
    expect(splitFullName('Cher')).toEqual({ firstName: 'Cher', lastName: null });
  });

  it('matchOption ignores case and punctuation', () => {
    const options = [{ value: 'Colorbond / Metal Sheet', label: 'Colorbond / Metal Sheet' }];
    expect(matchOption('colorbond metal sheet', options)).toBe('Colorbond / Metal Sheet');
    expect(matchOption('Tin', options)).toBeNull();
  });

  it('mapRow keeps only mapped, non-empty cells', () => {
    expect(
      mapRow(['Name', 'Phone', 'Notes'], ['  Olivia ', '', 'x'], {
        fullName: 'Name',
        mobile: 'Phone',
      }),
    ).toEqual({ fullName: 'Olivia' });
  });
});
