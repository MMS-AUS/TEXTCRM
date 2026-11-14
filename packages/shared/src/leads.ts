import { z } from 'zod';
import { AU_STATES, stateForPostcode } from './au.ts';
import { emailList, optionalPhone, optionalText, splitPrimaryEmail } from './contacts.ts';

/** The business runs on Sydney/Brisbane time; "today" for lead dates means today there. */
export const BUSINESS_TIME_ZONE = 'Australia/Sydney';

/** Today's date (YYYY-MM-DD) in the business time zone. */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(now);
}

/** §1.4 lead statuses, in pipeline order. Values match the `leadStatuses` option list. */
export const LEAD_PIPELINE = [
  'New',
  'Contacted',
  'Site Survey Scheduled',
  'Proposal Sent',
  'Contract Signed',
  'Deposit Received',
] as const;
export const LEAD_CONVERTED = 'Converted to Project';
export const LEAD_LOST = 'Lost';

const isoDate = z.iso.date({ error: 'Enter a date.' });

// ── Lead input ────────────────────────────────────────────────────────────

export const leadInputSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Enter a first name.').max(100),
    lastName: optionalText(100),
    /** One box, several addresses separated by spaces: the first is primary, the rest are tags. */
    email: emailList,
    mobile: optionalPhone,
    secondaryMobile: optionalPhone,
    streetAddress: optionalText(200),
    suburb: optionalText(100),
    state: z
      .enum(AU_STATES)
      .nullish()
      .or(z.literal(''))
      .transform((value) => value || null),
    postcode: z
      .string()
      .trim()
      .nullish()
      .transform((value, ctx) => {
        if (!value) return null;
        if (!/^\d{4}$/.test(value)) {
          ctx.addIssue({ code: 'custom', message: 'A postcode has 4 digits.' });
          return z.NEVER;
        }
        return value;
      }),
    /** Option values from `leadSources`, `leadStatuses`. */
    source: optionalText(200),
    status: z.string().trim().min(1).default('New'),
    ownerUserId: z
      .uuid()
      .nullish()
      .or(z.literal(''))
      .transform((value) => value || null),
    leadDate: isoDate.optional(),
    notes: optionalText(5000),
  })
  .superRefine((lead, ctx) => {
    if (!lead.mobile && lead.email.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['mobile'],
        message: 'Enter a mobile or an email so the customer can be reached.',
      });
    }
    const postcodeState = stateForPostcode(lead.postcode);
    if (lead.state && postcodeState && postcodeState !== lead.state) {
      ctx.addIssue({
        code: 'custom',
        path: ['postcode'],
        message: `${lead.postcode ?? ''} is a ${postcodeState} postcode, not ${lead.state}.`,
      });
    }
  })
  .transform(splitPrimaryEmail);

export type LeadInput = z.input<typeof leadInputSchema>;
export type LeadValues = z.output<typeof leadInputSchema>;

// ── Lead list ─────────────────────────────────────────────────────────────

export const LEAD_SORTS = [
  'name',
  'leadDate',
  'status',
  'source',
  'owner',
  'location',
  'updatedAt',
] as const;

/** Owner filter: a user id, the signed-in user, or leads with no owner. */
export const ownerFilterSchema = z.union([z.uuid(), z.literal('me'), z.literal('none')]);

export const leadFiltersSchema = z.object({
  search: z.string().trim().max(100).default(''),
  statuses: z.array(z.string().min(1).max(100)).max(20).default([]),
  source: z.string().trim().min(1).max(200).optional(),
  owner: ownerFilterSchema.optional(),
  state: z.enum(AU_STATES).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  /** true = only deleted leads (to restore them). */
  deleted: z.boolean().default(false),
});

export const leadListInputSchema = leadFiltersSchema.extend({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  sort: z
    .object({ id: z.enum(LEAD_SORTS), desc: z.boolean() })
    .default({ id: 'leadDate', desc: true }),
});

export type LeadListInput = z.input<typeof leadListInputSchema>;

export const leadIdsSchema = z.array(z.uuid()).min(1).max(500);

// ── Duplicate detection (§1.4, F-06) ──────────────────────────────────────
// Ported from the old app's isLeadAlreadyInSystem / areDistinctProperties. Phones and emails
// are already normalised (E.164, lower-case) by the schemas above, so they compare directly.

const STREET_TYPES: [RegExp, string][] = [
  [/\b(street|st)\b/g, 'st'],
  [/\b(road|rd)\b/g, 'rd'],
  [/\b(avenue|ave)\b/g, 'ave'],
  [/\b(court|ct)\b/g, 'ct'],
  [/\b(drive|dr)\b/g, 'dr'],
  [/\b(lane|ln)\b/g, 'ln'],
  [/\b(place|pl)\b/g, 'pl'],
  [/\b(parade|pde)\b/g, 'pde'],
  [/\b(highway|hwy)\b/g, 'hwy'],
  [/\b(circuit|cct)\b/g, 'cct'],
  [/\b(crescent|cres|cr)\b/g, 'cres'],
  [/\b(close|cl)\b/g, 'cl'],
  [/\b(terrace|tce)\b/g, 'tce'],
  [/\b(boulevard|bvd|blvd)\b/g, 'blvd'],
];

/** "12 Church Street, " and "12 church st" compare equal. */
export function normaliseStreet(street: string | null | undefined): string {
  let value = (street ?? '')
    .trim()
    .toLowerCase()
    .replace(/[,./\\#-]/g, ' ');
  for (const [pattern, short] of STREET_TYPES) value = value.replace(pattern, short);
  return value.replace(/\s+/g, ' ').trim();
}

export function normaliseName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export type DuplicateCandidate = {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  extraEmails?: readonly string[] | null;
  mobile?: string | null;
  secondaryMobile?: string | null;
  streetAddress?: string | null;
  suburb?: string | null;
  postcode?: string | null;
  state?: string | null;
};

/**
 * Different properties when any address part is known on both sides and differs. Then the same
 * person enquiring is a new lead (linked to the same contact), not a duplicate.
 */
export function areDistinctProperties(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  const pairs: [string, string][] = [
    [normaliseStreet(a.streetAddress), normaliseStreet(b.streetAddress)],
    [normaliseName(a.suburb), normaliseName(b.suburb)],
    [(a.postcode ?? '').trim(), (b.postcode ?? '').trim()],
    [(a.state ?? '').trim().toUpperCase(), (b.state ?? '').trim().toUpperCase()],
  ];
  return pairs.some(([left, right]) => left !== '' && right !== '' && left !== right);
}

export type DuplicateMatch<T> = {
  lead: T;
  /** 'email' | 'phone' are certain; 'name' (name + same address) may be a namesake. */
  matchedOn: 'email' | 'phone' | 'name';
  reason: string;
};

/**
 * The existing lead this candidate duplicates, if any: same email or phone, or same name at the
 * same address — always at the same property.
 */
export function findDuplicateLead<T extends DuplicateCandidate>(
  candidate: DuplicateCandidate,
  existing: readonly T[],
): DuplicateMatch<T> | null {
  const candidateEmails = [candidate.email, ...(candidate.extraEmails ?? [])].filter(
    (email): email is string => Boolean(email),
  );
  const candidatePhones = [candidate.mobile, candidate.secondaryMobile].filter(
    (phone): phone is string => Boolean(phone),
  );
  const candidateName = normaliseName(`${candidate.firstName} ${candidate.lastName ?? ''}`);
  const candidateStreet = normaliseStreet(candidate.streetAddress);
  const candidateSuburb = normaliseName(candidate.suburb);
  const candidatePostcode = (candidate.postcode ?? '').trim();

  for (const lead of existing) {
    if (areDistinctProperties(candidate, lead)) continue;

    const leadEmails = [lead.email, ...(lead.extraEmails ?? [])].filter(Boolean);
    const email = candidateEmails.find((e) => leadEmails.includes(e));
    if (email) return { lead, matchedOn: 'email', reason: `same email (${email})` };
    const leadPhones = [lead.mobile, lead.secondaryMobile].filter(Boolean);
    const phone = candidatePhones.find((p) => leadPhones.includes(p));
    if (phone) return { lead, matchedOn: 'phone', reason: 'same phone number' };

    const leadName = normaliseName(`${lead.firstName} ${lead.lastName ?? ''}`);
    if (candidateName.length > 2 && leadName === candidateName) {
      const leadStreet = normaliseStreet(lead.streetAddress);
      const leadSuburb = normaliseName(lead.suburb);
      if (candidateStreet && candidateStreet === leadStreet) {
        return { lead, matchedOn: 'name', reason: 'same name and street address' };
      }
      if (
        candidateSuburb &&
        candidateSuburb === leadSuburb &&
        candidatePostcode &&
        candidatePostcode === (lead.postcode ?? '').trim()
      ) {
        return { lead, matchedOn: 'name', reason: 'same name, suburb and postcode' };
      }
      if (!candidateStreet && !leadStreet && candidateSuburb && candidateSuburb === leadSuburb) {
        return { lead, matchedOn: 'name', reason: 'same name and suburb' };
      }
    }
  }
  return null;
}
