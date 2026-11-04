import { z } from 'zod';

// SMS (Step 5.3) and email (Step 5.2) sending: who can be messaged from where, the SMS
// character/segment counter, and the send inputs.

/** Records SMS can be sent from (§2.2 MessageMedia). */
export const SMS_ENTITY_TYPES = ['lead', 'contact', 'ticket'] as const;
/** Records email can be sent from (§2.2 Gmail). */
export const EMAIL_ENTITY_TYPES = ['lead', 'contact', 'project'] as const;

// ── SMS segments ─────────────────────────────────────────────────────────

/** GSM 03.38 basic character set (one septet each). */
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** GSM extension table: each costs two septets (escape + char). */
const GSM_EXTENDED = '^{}\\[~]|€\f';

export const MAX_SMS_SEGMENTS = 10;

export type SmsCount = {
  encoding: 'GSM-7' | 'UCS-2';
  /** Characters as the network counts them (extended GSM characters count twice). */
  units: number;
  segments: number;
  /** Units per segment: 160/153 for GSM-7, 70/67 for UCS-2 (multi-part loses a header). */
  perSegment: number;
  /** Units left before another segment is needed. */
  remaining: number;
};

/**
 * How many SMS segments a message costs. Any character outside GSM-7 (emoji, curly quotes,
 * most accents) switches the whole message to UCS-2, which fits far fewer characters.
 */
export function countSms(text: string): SmsCount {
  const chars = Array.from(text);
  const gsm = chars.every((c) => GSM_BASIC.includes(c) || GSM_EXTENDED.includes(c));
  const units = gsm
    ? chars.reduce((total, c) => total + (GSM_EXTENDED.includes(c) ? 2 : 1), 0)
    : // UCS-2 counts UTF-16 code units: an emoji is two.
      text.length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi);
  const perSegment = segments > 1 ? multi : single;
  return {
    encoding: gsm ? 'GSM-7' : 'UCS-2',
    units,
    segments,
    perSegment,
    remaining: segments === 0 ? single : segments * perSegment - units,
  };
}

export const smsSendSchema = z.object({
  entityType: z.enum(SMS_ENTITY_TYPES),
  entityId: z.uuid(),
  /** Defaults to the record's mobile. */
  to: z.string().trim().max(30).optional(),
  content: z
    .string()
    .min(1, 'Write the message.')
    .max(2000)
    .refine((text) => text.trim().length > 0, 'Write the message.')
    .refine(
      (text) => countSms(text).segments <= MAX_SMS_SEGMENTS,
      `Keep the message to ${String(MAX_SMS_SEGMENTS)} SMS parts or fewer.`,
    ),
});
export type SmsSendInput = z.input<typeof smsSendSchema>;

// ── Email ────────────────────────────────────────────────────────────────

/** No line breaks: a header value with CR/LF could inject extra headers. */
const headerSafe = (value: string) => !/[\r\n]/.test(value);

const address = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.'));

export const emailSendSchema = z.object({
  entityType: z.enum(EMAIL_ENTITY_TYPES),
  entityId: z.uuid(),
  /** Defaults to the record's email. */
  to: z.array(address).max(10).optional(),
  cc: z.array(address).max(10).default([]),
  subject: z
    .string()
    .trim()
    .min(1, 'Add a subject.')
    .max(250)
    .refine(headerSafe, 'The subject must be a single line.'),
  body: z.string().min(1, 'Write the email.').max(50_000),
});
export type EmailSendInput = z.input<typeof emailSendSchema>;

export const messageListSchema = z.object({
  entityType: z.enum(['lead', 'contact', 'project', 'ticket']),
  entityId: z.uuid(),
});

/** MessageMedia delivery statuses (their Status2Enum) plus our own send states. */
export const SMS_STATUSES = [
  'queued',
  'sent',
  'enroute',
  'submitted',
  'delivered',
  'expired',
  'rejected',
  'failed',
  'undeliverable',
  'received',
] as const;
export type SmsStatus = (typeof SMS_STATUSES)[number];
