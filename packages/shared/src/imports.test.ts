import { describe, expect, it } from 'vitest';
import {
  IMPORT_TARGETS,
  isTemplateMapping,
  mappingProblems,
  mapRow,
  matchOption,
  parseSheetDate,
  parseYesNo,
  suggestMapping,
  templateHeaders,
  templateMapping,
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

  it('has no Full Name, Secondary Email or Platform column to map', () => {
    const headers = ['Name', 'Email', 'Secondary Email', 'Platform'];
    // Platform is read as the Lead Source; the other two have nowhere to go.
    expect(suggestMapping('leads', headers)).toEqual({ email: 'Email', source: 'Platform' });
    expect(suggestMapping('contacts', headers)).toEqual({ email: 'Email' });
  });

  it('uses each column once and ignores unknown ones', () => {
    expect(suggestMapping('contacts', ['Mobile', 'Phone', 'Favourite colour'])).toEqual({
      mobile: 'Mobile',
    });
  });
});

describe('templates', () => {
  it('has one heading per field, matched in full whatever the column order', () => {
    const headers = templateHeaders('leads');
    expect(headers).not.toContain('Secondary Email');
    expect(headers).not.toContain('Full Name');
    expect(new Set(headers).size).toBe(headers.length);
    const mapping = templateMapping('leads', [...headers].reverse());
    expect(mapping).toMatchObject({ firstName: 'First Name', mobile: 'Primary Mobile' });
    expect(Object.keys(mapping ?? {})).toHaveLength(headers.length);
    expect(mappingProblems('leads', mapping ?? {})).toEqual([]);
    expect(isTemplateMapping('leads', mapping)).toBe(true);
  });

  it('every target template maps cleanly', () => {
    for (const target of IMPORT_TARGETS) {
      const mapping = templateMapping(target, templateHeaders(target));
      expect(mapping && mappingProblems(target, mapping)).toEqual([]);
    }
  });

  it('needs exactly the template headings — no missing, extra or renamed columns', () => {
    const headers = templateHeaders('contacts');
    expect(templateMapping('contacts', headers.slice(1))).toBeNull();
    expect(templateMapping('contacts', [...headers, 'Favourite colour'])).toBeNull();
    expect(
      templateMapping(
        'contacts',
        headers.map((h) => h.toUpperCase()),
      ),
    ).toBeNull();
    expect(templateMapping('leads', headers)).toBeNull();
    expect(isTemplateMapping('leads', { firstName: 'First Name', mobile: 'Primary Mobile' })).toBe(
      false,
    );
  });
});

describe('mappingProblems', () => {
  it('needs a name and a way to reach the customer', () => {
    expect(mappingProblems('leads', { lastName: 'Surname' })).toEqual([
      'Map a First Name column.',
      'Map a mobile or an email column so customers can be reached.',
    ]);
    expect(mappingProblems('leads', { firstName: 'Name', email: 'Email' })).toEqual([]);
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

  it('matchOption ignores case and punctuation', () => {
    const options = [{ value: 'Colorbond / Metal Sheet', label: 'Colorbond / Metal Sheet' }];
    expect(matchOption('colorbond metal sheet', options)).toBe('Colorbond / Metal Sheet');
    expect(matchOption('Tin', options)).toBeNull();
  });

  it('mapRow keeps only mapped, non-empty cells', () => {
    expect(
      mapRow(['Name', 'Phone', 'Notes'], ['  Olivia ', '', 'x'], {
        firstName: 'Name',
        mobile: 'Phone',
      }),
    ).toEqual({ firstName: 'Olivia' });
  });
});
