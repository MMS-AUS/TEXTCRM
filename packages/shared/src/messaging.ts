import { z } from 'zod';

// SMS (Step 5.3) and email (Step 5.2) sending: who can be messaged from where, the SMS
// character/segment counter, and the send inputs.

/** Records SMS and email can be sent from: they go to the record's customer. */
export const SMS_ENTITY_TYPES = ['lead', 'contact', 'project', 'ticket'] as const;
export const EMAIL_ENTITY_TYPES = ['lead', 'contact', 'project', 'ticket'] as const;

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

/** The composer's fonts: what the font menu offers and the server keeps. */
export const EMAIL_FONTS = [
  { label: 'Sans Serif', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif', value: 'Georgia, Times New Roman, serif' },
  { label: 'Monospace', value: 'Courier New, Courier, monospace' },
] as const;

/** Gmail-style sizes. */
export const EMAIL_FONT_SIZES = [
  { label: 'Small', value: '12px' },
  { label: 'Normal', value: '14px' },
  { label: 'Large', value: '18px' },
  { label: 'Huge', value: '24px' },
] as const;

/** The text-colour and highlight swatches (any hex colour is kept when pasted). */
export const EMAIL_TEXT_COLORS = [
  '#000000',
  '#444444',
  '#888888',
  '#cc0000',
  '#e69138',
  '#f1c232',
  '#6aa84f',
  '#3d85c6',
  '#674ea7',
  '#a64d79',
  '#0b5394',
  '#38761d',
] as const;
export const EMAIL_HIGHLIGHT_COLORS = [
  '#ffff00',
  '#fce5cd',
  '#fff2cc',
  '#d9ead3',
  '#d0e0e3',
  '#cfe2f3',
  '#d9d2e9',
  '#ead1dc',
  '#f4cccc',
] as const;

/** Attachments: PDFs and images, as Gmail sends them. */
export const EMAIL_ATTACHMENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
export const EMAIL_ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp';
export const MAX_EMAIL_ATTACHMENTS = 10;
export const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Gmail's limit is 25 MB after encoding (base64 adds a third), so 18 MB of files in total. */
export const MAX_EMAIL_TOTAL_ATTACHMENT_BYTES = 18 * 1024 * 1024;

/** The type to store an attachment as, from what the browser reported or the extension. */
export function emailAttachmentType(fileName: string, reported: string): string | null {
  const type = reported.toLowerCase().split(';')[0]?.trim() ?? '';
  if (type in EMAIL_ATTACHMENT_TYPES) return type === 'image/jpg' ? 'image/jpeg' : type;
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  const byExtension: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return byExtension[extension] ?? null;
}

export const attachmentUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().max(200),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_EMAIL_ATTACHMENT_BYTES, 'Each attachment can be up to 10 MB.'),
});

// ── Signature ────────────────────────────────────────────────────────────

const optionalLine = z
  .string()
  .trim()
  .max(200)
  .refine(headerSafe, 'Keep it to one line.')
  .transform((v) => v || null)
  .nullable()
  .default(null);

export const signatureSchema = z.object({
  /** Added to new emails automatically (it can still be left off per email). */
  enabled: z.boolean(),
  fullName: optionalLine,
  title: optionalLine,
  phone: optionalLine,
  mobile: optionalLine,
  email: optionalLine,
  companyName: optionalLine,
  address: optionalLine,
  website: optionalLine,
});
export type SignatureInput = z.input<typeof signatureSchema>;

/** The logo: a small image, shown inside the email (not as an attachment). */
export const SIGNATURE_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif'] as const;
export const MAX_SIGNATURE_LOGO_BYTES = 512 * 1024;
export const signatureLogoUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(SIGNATURE_LOGO_TYPES, 'Use a PNG, JPEG or GIF logo.'),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_SIGNATURE_LOGO_BYTES, 'Keep the logo under 512 KB.'),
});

// ── Drafts ───────────────────────────────────────────────────────────────

export const draftSaveSchema = z.object({
  /** Updating an existing draft; omitted for a new one. */
  id: z.uuid().optional(),
  entityType: z.enum(EMAIL_ENTITY_TYPES),
  entityId: z.uuid(),
  to: z.array(address).max(10).default([]),
  cc: z.array(address).max(10).default([]),
  subject: z.string().trim().max(250).refine(headerSafe, 'The subject must be a single line.'),
  html: z.string().max(200_000),
  replyToId: z.uuid().optional(),
  includeSignature: z.boolean().default(false),
  attachmentIds: z.array(z.uuid()).max(MAX_EMAIL_ATTACHMENTS).default([]),
});
export type DraftSaveInput = z.input<typeof draftSaveSchema>;

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
  /**
   * The rich-text editor's HTML. The server keeps only simple formatting (bold, italic,
   * underline, lists, links) and makes the plain-text version from it.
   */
  html: z.string().min(1, 'Write the email.').max(200_000),
  /** Replying to this email (one received from the customer): threads it in Gmail. */
  replyToId: z.uuid().optional(),
  /** Files uploaded with attachmentUpload (ready, not yet sent). */
  attachmentIds: z.array(z.uuid()).max(MAX_EMAIL_ATTACHMENTS).default([]),
  /** Append the sender's saved signature. */
  includeSignature: z.boolean().default(false),
  /** Sending a saved draft: it is removed once the email has gone. */
  draftId: z.uuid().optional(),
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
