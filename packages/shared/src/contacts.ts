import { z } from 'zod';
import { AU_STATES, normalisePhone, parseAbn, stateForPostcode } from './au.ts';

// Input schemas for contacts, addresses and companies. The API validates every request with
// these; the web uses the same schemas in its forms. Inputs are form-friendly (empty string =
// not set); outputs are what the database stores (null, E.164 phones, 11-digit ABNs).

/** Optional free text: trimmed, '' → null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${String(max)} characters.`)
    .nullish()
    .transform((value) => (value ? value : null));

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    if (!z.email().safeParse(value).success) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid email address.' });
      return z.NEVER;
    }
    return value;
  });

/** Any common Australian format in, E.164 out. */
export const optionalPhone = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const e164 = normalisePhone(value);
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, e.g. 0412 345 678.' });
      return z.NEVER;
    }
    return e164;
  });

/** An optional record id; '' (an empty picker) counts as none. */
export const optionalId = z
  .uuid()
  .nullish()
  .or(z.literal(''))
  .transform((value) => value || null);

// ── Contacts ──────────────────────────────────────────────────────────────

export const contactInputSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Enter a first name.').max(100),
    lastName: optionalText(100),
    email: optionalEmail,
    mobile: optionalPhone,
    secondaryMobile: optionalPhone,
    /** Option value from the `contactTypes` list. */
    type: z.string().trim().min(1, 'Choose a type.'),
    companyId: optionalId,
    notes: optionalText(5000),
  })
  .superRefine((contact, ctx) => {
    if (!contact.mobile && !contact.email) {
      ctx.addIssue({
        code: 'custom',
        path: ['mobile'],
        message: 'Enter a mobile or an email so the contact can be reached.',
      });
    }
  });

export type ContactInput = z.input<typeof contactInputSchema>;
export type ContactValues = z.output<typeof contactInputSchema>;

// ── Addresses ─────────────────────────────────────────────────────────────

export const addressInputSchema = z
  .object({
    propertyType: optionalText(100),
    streetAddress: z.string().trim().min(1, 'Enter the street address.').max(200),
    suburb: z.string().trim().min(1, 'Enter the suburb.').max(100),
    state: z.enum(AU_STATES, { error: 'Choose a state.' }),
    postcode: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'A postcode has 4 digits.'),
    isPrimary: z.boolean().default(false),
    notes: optionalText(1000),
  })
  .superRefine((address, ctx) => {
    const postcodeState = stateForPostcode(address.postcode);
    if (postcodeState && postcodeState !== address.state) {
      ctx.addIssue({
        code: 'custom',
        path: ['postcode'],
        message: `${address.postcode} is a ${postcodeState} postcode, not ${address.state}.`,
      });
    }
  });

export type AddressInput = z.input<typeof addressInputSchema>;
export type AddressValues = z.output<typeof addressInputSchema>;

// ── Companies ─────────────────────────────────────────────────────────────

const optionalAbn = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const parsed = parseAbn(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error });
      return z.NEVER;
    }
    return parsed.abn;
  });

const optionalWebsite = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    if (
      !z.url({ protocol: /^https?$/ }).safeParse(withScheme).success ||
      !withScheme.includes('.')
    ) {
      ctx.addIssue({ code: 'custom', message: 'Enter a web address, e.g. makemysolar.com.au.' });
      return z.NEVER;
    }
    return withScheme;
  });

const optionalState = z
  .enum(AU_STATES)
  .nullish()
  .or(z.literal(''))
  .transform((value) => value || null);

const optionalPostcode = z
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
  });

export const companyInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter the company name.').max(200),
  /** Option value from the `companyTypes` list. */
  type: optionalText(100),
  abn: optionalAbn,
  phone: optionalPhone,
  email: optionalEmail,
  website: optionalWebsite,
  streetAddress: optionalText(200),
  suburb: optionalText(100),
  state: optionalState,
  postcode: optionalPostcode,
  notes: optionalText(5000),
});

export type CompanyInput = z.input<typeof companyInputSchema>;
export type CompanyValues = z.output<typeof companyInputSchema>;

// ── Lists ─────────────────────────────────────────────────────────────────

export const CONTACT_SORTS = ['name', 'email', 'type', 'company', 'location', 'updatedAt'] as const;
export const COMPANY_SORTS = ['name', 'type', 'location', 'contacts', 'updatedAt'] as const;

const listBase = {
  search: z.string().trim().max(100).default(''),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  /** true = only archived records, false = only active ones. */
  archived: z.boolean().default(false),
};

export const contactListInputSchema = z.object({
  ...listBase,
  type: z.string().trim().min(1).optional(),
  companyId: z.uuid().optional(),
  sort: z
    .object({ id: z.enum(CONTACT_SORTS), desc: z.boolean() })
    .default({ id: 'updatedAt', desc: true }),
});

export const companyListInputSchema = z.object({
  ...listBase,
  type: z.string().trim().min(1).optional(),
  sort: z
    .object({ id: z.enum(COMPANY_SORTS), desc: z.boolean() })
    .default({ id: 'name', desc: false }),
});

export type ContactListInput = z.input<typeof contactListInputSchema>;
export type CompanyListInput = z.input<typeof companyListInputSchema>;
