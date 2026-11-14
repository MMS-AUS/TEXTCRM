import { describe, expect, it } from 'vitest';
import { companyInputSchema, contactInputSchema } from './contacts.ts';

describe('several emails on contacts and companies', () => {
  const contact = (email: string | null) =>
    contactInputSchema.safeParse({ firstName: 'Mia', email, type: 'Residential' });

  it('a contact keeps the first address as primary and the rest as extra emails', () => {
    const result = contact(' Mia@Home.example  mia@work.example;MIA@home.example ');
    expect(result.success && [result.data.email, result.data.extraEmails]).toEqual([
      'mia@home.example',
      ['mia@work.example'],
    ]);
  });

  it('a contact still needs a mobile or an email, and every address must be valid', () => {
    const none = contact('');
    expect(!none.success && none.error.issues[0]?.message).toContain('mobile or an email');
    const bad = contact('mia@home.example nope');
    expect(!bad.success && bad.error.issues[0]?.message).toContain('"nope"');
  });

  it('a company takes several addresses too, or none', () => {
    const two = companyInputSchema.safeParse({
      name: 'Bright Solar',
      email: 'info@bright.example accounts@bright.example',
    });
    expect(two.success && [two.data.email, two.data.extraEmails]).toEqual([
      'info@bright.example',
      ['accounts@bright.example'],
    ]);
    const empty = companyInputSchema.safeParse({ name: 'Bright Solar' });
    expect(empty.success && [empty.data.email, empty.data.extraEmails]).toEqual([null, []]);
  });
});
