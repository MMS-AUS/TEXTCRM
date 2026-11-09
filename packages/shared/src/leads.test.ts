import { describe, expect, it } from 'vitest';
import {
  areDistinctProperties,
  businessToday,
  findDuplicateLead,
  leadInputSchema,
  normaliseStreet,
  type DuplicateCandidate,
} from './leads.ts';

const olivia: DuplicateCandidate = {
  firstName: 'Olivia',
  lastName: 'Nguyen',
  email: 'olivia@example.com',
  mobile: '+61412345678',
  streetAddress: '12 Church Street',
  suburb: 'Parramatta',
  postcode: '2150',
  state: 'NSW',
};

describe('duplicate detection', () => {
  it('treats street spellings as the same address', () => {
    expect(normaliseStreet('12 Church Street,')).toBe(normaliseStreet('12 church st'));
    expect(normaliseStreet('4/7 Ocean Pde')).toBe('4 7 ocean pde');
  });

  it('matches the same email or phone at the same property', () => {
    expect(findDuplicateLead({ ...olivia, mobile: null }, [olivia])?.matchedOn).toBe('email');
    expect(
      findDuplicateLead({ firstName: 'O', mobile: '+61412345678', streetAddress: '12 church st' }, [
        olivia,
      ])?.matchedOn,
    ).toBe('phone');
    // The phone can match either of the existing lead's numbers.
    expect(
      findDuplicateLead({ firstName: 'O', mobile: '+61299998888' }, [
        { ...olivia, secondaryMobile: '+61299998888' },
      ])?.reason,
    ).toBe('same phone number');
    // Emails match across primary and secondary, in either direction.
    expect(
      findDuplicateLead({ firstName: 'O', email: 'liv@work.example' }, [
        { ...olivia, secondaryEmail: 'liv@work.example' },
      ])?.matchedOn,
    ).toBe('email');
    expect(
      findDuplicateLead({ firstName: 'O', secondaryEmail: 'olivia@example.com' }, [olivia])?.reason,
    ).toBe('same email (olivia@example.com)');
  });

  it('allows the same person at a different property (a new lead)', () => {
    const otherHouse = {
      ...olivia,
      streetAddress: '3 Ruthven St',
      suburb: 'Toowoomba',
      postcode: '4350',
      state: 'QLD',
    };
    expect(areDistinctProperties(olivia, otherHouse)).toBe(true);
    expect(findDuplicateLead(otherHouse, [olivia])).toBeNull();
  });

  it('treats missing address parts as unknown, not different', () => {
    expect(areDistinctProperties(olivia, { firstName: 'O', suburb: 'parramatta' })).toBe(false);
    expect(
      findDuplicateLead({ firstName: 'X', email: 'olivia@example.com' }, [olivia]),
    ).not.toBeNull();
  });

  it('matches the same name at the same street, flagged as a name match', () => {
    const match = findDuplicateLead(
      {
        firstName: 'olivia ',
        lastName: 'NGUYEN',
        streetAddress: '12 Church St',
        email: 'new@x.com',
      },
      [olivia],
    );
    expect(match).toMatchObject({ matchedOn: 'name', reason: 'same name and street address' });
  });

  it('does not match strangers', () => {
    expect(
      findDuplicateLead({ firstName: 'Jack', email: 'jack@example.com', suburb: 'Parramatta' }, [
        olivia,
      ]),
    ).toBeNull();
  });
});

describe('lead input', () => {
  it('normalises contact details and requires a way to reach the customer', () => {
    const lead = leadInputSchema.parse({ firstName: 'Olivia', mobile: '0412 345 678', state: '' });
    expect(lead).toMatchObject({ mobile: '+61412345678', state: null, status: 'New' });
    expect(leadInputSchema.safeParse({ firstName: 'Olivia' }).success).toBe(false);
  });

  it("knows today's date in Sydney", () => {
    // 2026-11-02 14:30 UTC is already 3 November in Sydney (AEDT, UTC+11).
    expect(businessToday(new Date('2026-11-02T14:30:00Z'))).toBe('2026-11-03');
  });
});
