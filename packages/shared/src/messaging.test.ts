import { describe, expect, it } from 'vitest';
import { countSms, emailSendSchema, smsSendSchema } from './messaging.ts';

describe('countSms', () => {
  it('counts GSM-7: 160 in one part, 153 per part after that', () => {
    expect(countSms('')).toMatchObject({ segments: 0, remaining: 160 });
    expect(countSms('a'.repeat(160))).toMatchObject({
      encoding: 'GSM-7',
      segments: 1,
      remaining: 0,
    });
    expect(countSms('a'.repeat(161))).toMatchObject({
      segments: 2,
      perSegment: 153,
      remaining: 145,
    });
    expect(countSms('a'.repeat(306))).toMatchObject({ segments: 2, remaining: 0 });
  });

  it('extended characters like € and [ count twice', () => {
    expect(countSms('€').units).toBe(2);
    expect(countSms('Price: €5 [inc GST]').units).toBe(22);
  });

  it('any non-GSM character switches to UCS-2 (70, then 67 per part)', () => {
    expect(countSms('Hi 👋')).toMatchObject({
      encoding: 'UCS-2',
      units: 5,
      segments: 1,
      remaining: 65,
    });
    expect(countSms(`“quoted”${'a'.repeat(68)}`)).toMatchObject({
      encoding: 'UCS-2',
      segments: 2,
      perSegment: 67,
    });
  });

  it('refuses messages over 10 parts', () => {
    expect(
      smsSendSchema.safeParse({
        entityType: 'lead',
        entityId: crypto.randomUUID(),
        content: 'a'.repeat(1531),
      }).success,
    ).toBe(false);
    expect(
      smsSendSchema.safeParse({ entityType: 'lead', entityId: crypto.randomUUID(), content: '   ' })
        .success,
    ).toBe(false);
  });
});

describe('emailSendSchema', () => {
  it('refuses a subject that could inject headers', () => {
    const base = { entityType: 'lead', entityId: crypto.randomUUID(), body: 'Hi' } as const;
    expect(
      emailSendSchema.safeParse({ ...base, subject: 'Quote\r\nBcc: evil@x.com' }).success,
    ).toBe(false);
    expect(
      emailSendSchema.safeParse({ ...base, subject: 'Your quote', to: ['Olivia@Example.com'] }).data
        ?.to,
    ).toEqual(['olivia@example.com']);
  });
});
