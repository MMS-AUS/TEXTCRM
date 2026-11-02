import { describe, expect, it } from 'vitest';
import {
  areaForPostcode,
  formatAbn,
  formatPhone,
  nearestBigCity,
  normalisePhone,
  parseAbn,
  stateForPostcode,
} from './au.ts';
import { addressInputSchema, companyInputSchema, contactInputSchema } from './contacts.ts';

describe('phone numbers', () => {
  it.each([
    ['0412 345 678', '+61412345678'],
    ['0412345678', '+61412345678'],
    ['+61 412 345 678', '+61412345678'],
    ['61412345678', '+61412345678'],
    ['+61 0412 345 678', '+61412345678'],
    ['(02) 9876 5432', '+61298765432'],
    ['07-3123-4567', '+61731234567'],
    ['+64 21 123 4567', '+64211234567'],
  ])('normalises %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each(['', '12345', '0512 345 678', '0412 345 67', 'call me', '04123456789'])(
    'rejects %s',
    (input) => {
      expect(normalisePhone(input)).toBeNull();
    },
  );

  it('formats for display', () => {
    expect(formatPhone('+61412345678')).toBe('0412 345 678');
    expect(formatPhone('+61298765432')).toBe('(02) 9876 5432');
    expect(formatPhone('+64211234567')).toBe('+64211234567');
    expect(formatPhone(null)).toBe('');
  });
});

describe('ABN', () => {
  it('accepts a valid ABN in any spacing', () => {
    expect(parseAbn('51 824 753 556')).toEqual({ ok: true, abn: '51824753556' });
    expect(formatAbn('51824753556')).toBe('51 824 753 556');
  });

  it('explains what is wrong', () => {
    expect(parseAbn('51 824 753 557')).toEqual({
      ok: false,
      error: "That isn't a valid ABN — check for a typo.",
    });
    expect(parseAbn('5182475')).toEqual({ ok: false, error: 'An ABN has 11 digits (this has 7).' });
    expect(parseAbn('ABN 51824753556')).toMatchObject({ ok: false });
  });
});

describe('postcodes', () => {
  it.each([
    ['2150', 'NSW', 'Metro', 'Sydney'],
    ['2600', 'ACT', 'Metro', 'Canberra'],
    ['2300', 'NSW', 'Regional', 'Newcastle'],
    ['4350', 'QLD', 'Regional', 'Toowoomba'],
    ['3000', 'VIC', 'Metro', 'Melbourne'],
    ['0800', 'NT', 'Metro', 'Darwin'],
    ['6725', 'WA', 'Regional', 'Perth'],
  ])('%s → %s, %s, %s', (postcode, state, area, city) => {
    expect(stateForPostcode(postcode)).toBe(state);
    expect(areaForPostcode(postcode)).toBe(area);
    expect(nearestBigCity(postcode, null)).toBe(city);
  });

  it('returns null for invalid postcodes', () => {
    expect(stateForPostcode('215')).toBeNull();
    expect(areaForPostcode('abcd')).toBeNull();
    expect(nearestBigCity('', '')).toBeNull();
  });
});

describe('input schemas', () => {
  it('normalises a contact and requires a way to reach them', () => {
    const parsed = contactInputSchema.parse({
      firstName: ' Olivia ',
      lastName: '',
      email: 'Olivia@Example.COM ',
      mobile: '0412 345 678',
      type: 'Residential',
      companyId: '',
    });
    expect(parsed).toMatchObject({
      firstName: 'Olivia',
      lastName: null,
      email: 'olivia@example.com',
      mobile: '+61412345678',
      secondaryMobile: null,
      companyId: null,
    });
    const missing = contactInputSchema.safeParse({ firstName: 'O', type: 'Residential' });
    expect(missing.error?.issues[0]?.path).toEqual(['mobile']);
  });

  it('checks the postcode belongs to the state', () => {
    const result = addressInputSchema.safeParse({
      streetAddress: '1 Main St',
      suburb: 'Parramatta',
      state: 'QLD',
      postcode: '2150',
    });
    expect(result.error?.issues[0]?.message).toBe('2150 is a NSW postcode, not QLD.');
  });

  it('validates the ABN and tidies the website', () => {
    expect(
      companyInputSchema.parse({ name: 'X', abn: '51 824 753 556', website: 'example.com.au' }),
    ).toMatchObject({ abn: '51824753556', website: 'https://example.com.au' });
    expect(companyInputSchema.safeParse({ name: 'X', abn: '123' }).success).toBe(false);
  });
});
