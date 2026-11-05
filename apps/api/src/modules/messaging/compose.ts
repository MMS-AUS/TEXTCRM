import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import {
  emailAttachmentType,
  MAX_EMAIL_ATTACHMENT_BYTES,
  MAX_EMAIL_TOTAL_ATTACHMENT_BYTES,
  MAX_SIGNATURE_LOGO_BYTES,
  type ActivityEntityType,
  type DraftSaveInput,
  type SignatureInput,
} from '@mms/shared';
import type { z } from 'zod';
import type { Db } from '../../db/client.ts';
import {
  companyProfile,
  emailAttachments,
  emailDrafts,
  emailSignatures,
} from '../../db/schema/index.ts';
import { sanitizeComposeHtml } from '../../integrations/email-html.ts';
import type { MimeFile } from '../../integrations/gmail.ts';
import type { Storage } from '../../storage/storage.ts';
import type { attachmentUploadSchema } from '@mms/shared';
import { signatureSchema, draftSaveSchema } from '@mms/shared';

// The email composer's extras (Step 5.2): attachments (S3/R2), signatures, drafts.

type User = { id: string; name: string; email: string };

const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });

export function requireStorage(storage: Storage | null): Storage {
  if (!storage) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        "File storage isn't set up yet, so files can't be attached. Add the S3_ settings to .env.",
    });
  }
  return storage;
}

/** Letters, digits, dot, dash and underscore; the original name stays in the database. */
function safeKeyName(fileName: string): string {
  return (
    fileName
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '_')
      .replace(/_+/g, '_')
      .slice(-100) || 'file'
  );
}

// ── Attachments ─────────────────────────────────────────────────────────

/** Step 1: a pending attachment and the presigned URL the browser uploads it to. */
export async function createAttachmentUpload(
  db: Db,
  storage: Storage | null,
  user: User,
  input: z.infer<typeof attachmentUploadSchema>,
) {
  const store = requireStorage(storage);
  const contentType = emailAttachmentType(input.fileName, input.contentType);
  if (!contentType) throw bad('Attach a PDF or an image (JPEG, PNG, GIF or WebP).');
  const id = randomUUID();
  const storageKey = `email/${user.id}/${id}/${safeKeyName(input.fileName)}`;
  await db.insert(emailAttachments).values({
    id,
    uploadedByUserId: user.id,
    fileName: input.fileName,
    contentType,
    sizeBytes: input.sizeBytes,
    storageKey,
  });
  return {
    id,
    contentType,
    uploadUrl: await store.presignUpload(storageKey, contentType, input.sizeBytes),
  };
}

async function ownAttachment(db: Db, user: User, id: string) {
  const [row] = await db
    .select()
    .from(emailAttachments)
    .where(and(eq(emailAttachments.id, id), eq(emailAttachments.uploadedByUserId, user.id)));
  if (!row)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'This attachment no longer exists.' });
  return row;
}

/** Step 2: checks the bytes arrived as declared. */
export async function completeAttachmentUpload(
  db: Db,
  storage: Storage | null,
  user: User,
  id: string,
) {
  const store = requireStorage(storage);
  const row = await ownAttachment(db, user, id);
  if (row.status === 'ready') return { id: row.id };
  const stored = await store.head(row.storageKey);
  if (!stored || stored.sizeBytes !== row.sizeBytes) {
    await store.remove([row.storageKey]);
    await db.delete(emailAttachments).where(eq(emailAttachments.id, row.id));
    throw bad(
      stored
        ? "The upload didn't match the file you chose. Please attach it again."
        : "The file didn't finish uploading. Please attach it again.",
    );
  }
  await db.update(emailAttachments).set({ status: 'ready' }).where(eq(emailAttachments.id, row.id));
  return { id: row.id };
}

/** Removes an attachment that hasn't been sent (from the composer or a draft). */
export async function removeAttachment(db: Db, storage: Storage | null, user: User, id: string) {
  const row = await ownAttachment(db, user, id);
  if (row.emailMessageId) throw bad('This file was sent with an email and is kept with it.');
  await db.delete(emailAttachments).where(eq(emailAttachments.id, row.id));
  if (storage) await storage.remove([row.storageKey]);
  return { removed: true };
}

/** The sender's ready, unsent attachments for an email, with their bytes. */
export async function loadAttachmentsForSend(
  db: Db,
  storage: Storage | null,
  user: User,
  ids: string[],
): Promise<{ rows: (typeof emailAttachments.$inferSelect)[]; files: MimeFile[] }> {
  if (ids.length === 0) return { rows: [], files: [] };
  const store = requireStorage(storage);
  const rows = await db
    .select()
    .from(emailAttachments)
    .where(
      and(
        inArray(emailAttachments.id, ids),
        eq(emailAttachments.uploadedByUserId, user.id),
        isNull(emailAttachments.emailMessageId),
        eq(emailAttachments.status, 'ready'),
      ),
    );
  if (rows.length !== new Set(ids).size) {
    throw bad('An attachment is missing or still uploading. Remove it and attach it again.');
  }
  const total = rows.reduce((sum, r) => sum + r.sizeBytes, 0);
  if (total > MAX_EMAIL_TOTAL_ATTACHMENT_BYTES) {
    throw bad('Attachments can add up to 18 MB per email (Gmail’s limit). Remove some files.');
  }
  const files = await Promise.all(
    rows.map(async (r) => ({
      fileName: r.fileName,
      contentType: r.contentType,
      content: await store.read(r.storageKey, MAX_EMAIL_ATTACHMENT_BYTES),
    })),
  );
  return { rows, files };
}

/** Unsent attachments that aren't on a draft, older than a day: the composer was closed. */
export async function cleanupAbandonedAttachments(
  db: Db,
  storage: Storage | null,
  now: Date = new Date(),
) {
  const cutoff = new Date(now.getTime() - 24 * 3600_000);
  const rows = await db
    .select({ id: emailAttachments.id, storageKey: emailAttachments.storageKey })
    .from(emailAttachments)
    .where(
      and(
        isNull(emailAttachments.emailMessageId),
        isNull(emailAttachments.draftId),
        lt(emailAttachments.createdAt, cutoff),
      ),
    )
    .limit(500);
  if (rows.length === 0) return 0;
  if (storage) await storage.remove(rows.map((r) => r.storageKey));
  await db.delete(emailAttachments).where(
    inArray(
      emailAttachments.id,
      rows.map((r) => r.id),
    ),
  );
  return rows.length;
}

// ── Signatures ──────────────────────────────────────────────────────────

export type SignatureFields = z.infer<typeof signatureSchema>;

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const websiteHref = (site: string) => (/^https?:\/\//i.test(site) ? site : `https://${site}`);
const websiteLabel = (site: string) => site.replace(/^https?:\/\//i, '').replace(/\/$/, '');

export const SIGNATURE_LOGO_CID = 'mms-signature-logo';

/**
 * The signature as email HTML (a small table with inline styles, as mail apps need) and as
 * plain text. `logoSrc` is the cid: reference when sending, a preview URL in the CRM, or null.
 */
export function renderSignature(sig: SignatureFields, logoSrc: string | null) {
  const lines: string[] = [];
  const text: string[] = [];
  if (sig.fullName) {
    lines.push(`<div style="font-weight:bold;color:#222222">${escapeHtml(sig.fullName)}</div>`);
    text.push(sig.fullName);
  }
  for (const value of [sig.title, sig.companyName]) {
    if (value) {
      lines.push(`<div>${escapeHtml(value)}</div>`);
      text.push(value);
    }
  }
  const phones = [
    sig.phone ? ['P', sig.phone] : null,
    sig.mobile ? ['M', sig.mobile] : null,
  ].filter((p): p is string[] => p !== null);
  if (phones.length) {
    lines.push(
      `<div>${phones
        .map(
          ([label, number]) =>
            `${label}: <a href="tel:${escapeHtml((number ?? '').replace(/[^\d+]/g, ''))}" style="color:#444444;text-decoration:none">${escapeHtml(number ?? '')}</a>`,
        )
        .join(' &nbsp;|&nbsp; ')}</div>`,
    );
    text.push(phones.map(([label, number]) => `${label ?? ''}: ${number ?? ''}`).join(' | '));
  }
  const links: string[] = [];
  const linkText: string[] = [];
  if (sig.email) {
    links.push(
      `<a href="mailto:${escapeHtml(sig.email)}" style="color:#1a73e8">${escapeHtml(sig.email)}</a>`,
    );
    linkText.push(sig.email);
  }
  if (sig.website) {
    links.push(
      `<a href="${escapeHtml(websiteHref(sig.website))}" style="color:#1a73e8">${escapeHtml(websiteLabel(sig.website))}</a>`,
    );
    linkText.push(websiteLabel(sig.website));
  }
  if (links.length) {
    lines.push(`<div>${links.join(' &nbsp;|&nbsp; ')}</div>`);
    text.push(linkText.join(' | '));
  }
  if (sig.address) {
    lines.push(`<div style="color:#777777">${escapeHtml(sig.address)}</div>`);
    text.push(sig.address);
  }
  if (lines.length === 0 && !logoSrc) return null;
  const logo = logoSrc
    ? `<td style="padding-right:12px;vertical-align:top"><img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(sig.companyName ?? 'Logo')}" height="56" style="height:56px;width:auto;display:block;border:0"></td>`
    : '';
  const details = lines.length
    ? `<td style="vertical-align:top;${logoSrc ? 'border-left:2px solid #dddddd;padding-left:12px;' : ''}">${lines.join('')}</td>`
    : '';
  return {
    html: `<table class="mms-signature" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#444444"><tr>${logo}${details}</tr></table>`,
    text: text.length ? `-- \n${text.join('\n')}` : '',
  };
}

/** The business's details, to start a signature from. */
async function companyDefaults(db: Db) {
  const [company] = await db.select().from(companyProfile);
  if (!company) return {};
  const address = [
    company.streetAddress,
    [company.suburb, company.state, company.postcode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return {
    companyName: company.tradingName ?? company.legalName,
    phone: company.phone,
    website: company.website,
    address: address || null,
  };
}

/** The user's signature: saved, or made from their name and the company profile. */
export async function loadSignature(db: Db, user: User) {
  const [row] = await db.select().from(emailSignatures).where(eq(emailSignatures.userId, user.id));
  if (row) {
    const fields: SignatureFields = {
      enabled: row.enabled,
      fullName: row.fullName,
      title: row.title,
      phone: row.phone,
      mobile: row.mobile,
      email: row.email,
      companyName: row.companyName,
      address: row.address,
      website: row.website,
    };
    return { saved: true, fields, logoKey: row.logoKey, logoContentType: row.logoContentType };
  }
  const company = await companyDefaults(db);
  const fields: SignatureFields = {
    enabled: true,
    fullName: user.name,
    title: null,
    phone: company.phone ?? null,
    mobile: null,
    email: user.email,
    companyName: company.companyName ?? null,
    address: company.address ?? null,
    website: company.website ?? null,
  };
  return { saved: false, fields, logoKey: null, logoContentType: null };
}

/** For the settings page and the composer: the fields and a preview (logo by presigned URL). */
export async function signatureView(db: Db, storage: Storage | null, user: User) {
  const sig = await loadSignature(db, user);
  const logoUrl = sig.logoKey && storage ? await storage.presignPreview(sig.logoKey) : null;
  return {
    saved: sig.saved,
    fields: sig.fields,
    hasLogo: !!sig.logoKey,
    logoUrl,
    previewHtml: renderSignature(sig.fields, logoUrl)?.html ?? null,
    storageReady: storage !== null,
  };
}

export async function saveSignature(db: Db, user: User, input: SignatureInput) {
  const fields = signatureSchema.parse(input);
  await db
    .insert(emailSignatures)
    .values({ userId: user.id, ...fields })
    .onConflictDoUpdate({
      target: emailSignatures.userId,
      set: { ...fields, updatedAt: new Date() },
    });
  return { saved: true };
}

/** Makes sure a row exists (keeping the defaults) before a logo is attached to it. */
async function ensureSignatureRow(db: Db, user: User) {
  const sig = await loadSignature(db, user);
  if (!sig.saved) await saveSignature(db, user, sig.fields);
}

export async function createLogoUpload(
  db: Db,
  storage: Storage | null,
  user: User,
  input: { contentType: string; sizeBytes: number },
) {
  const store = requireStorage(storage);
  await ensureSignatureRow(db, user);
  const extension = input.contentType.split('/')[1] ?? 'png';
  const key = `signatures/${user.id}/${randomUUID()}.${extension === 'jpeg' ? 'jpg' : extension}`;
  await db
    .update(emailSignatures)
    .set({ pendingLogoKey: key })
    .where(eq(emailSignatures.userId, user.id));
  return { uploadUrl: await store.presignUpload(key, input.contentType, input.sizeBytes) };
}

export async function completeLogoUpload(db: Db, storage: Storage | null, user: User) {
  const store = requireStorage(storage);
  const [row] = await db.select().from(emailSignatures).where(eq(emailSignatures.userId, user.id));
  if (!row?.pendingLogoKey) throw bad('Choose the logo again.');
  const stored = await store.head(row.pendingLogoKey);
  if (!stored || stored.sizeBytes > MAX_SIGNATURE_LOGO_BYTES) {
    if (stored) await store.remove([row.pendingLogoKey]);
    await db
      .update(emailSignatures)
      .set({ pendingLogoKey: null })
      .where(eq(emailSignatures.userId, user.id));
    throw bad(stored ? 'Keep the logo under 512 KB.' : "The logo didn't finish uploading.");
  }
  await db
    .update(emailSignatures)
    .set({
      logoKey: row.pendingLogoKey,
      logoContentType: stored.contentType,
      logoSizeBytes: stored.sizeBytes,
      pendingLogoKey: null,
      updatedAt: new Date(),
    })
    .where(eq(emailSignatures.userId, user.id));
  if (row.logoKey) await store.remove([row.logoKey]);
  return { saved: true };
}

export async function removeLogo(db: Db, storage: Storage | null, user: User) {
  const [row] = await db.select().from(emailSignatures).where(eq(emailSignatures.userId, user.id));
  if (!row?.logoKey) return { removed: false };
  await db
    .update(emailSignatures)
    .set({ logoKey: null, logoContentType: null, logoSizeBytes: null })
    .where(eq(emailSignatures.userId, user.id));
  if (storage) await storage.remove([row.logoKey]);
  return { removed: true };
}

/**
 * The signature for an outgoing email: HTML with the logo by cid (sent as an inline image),
 * the stored version (no logo — the CRM shows it without), and the plain-text lines.
 */
export async function signatureForSend(db: Db, storage: Storage | null, user: User) {
  const sig = await loadSignature(db, user);
  let logo: MimeFile | null = null;
  if (sig.logoKey && storage) {
    logo = {
      fileName: `logo.${(sig.logoContentType ?? 'image/png').split('/')[1] ?? 'png'}`,
      contentType: sig.logoContentType ?? 'image/png',
      content: await storage.read(sig.logoKey, MAX_SIGNATURE_LOGO_BYTES),
      contentId: SIGNATURE_LOGO_CID,
    };
  }
  const sent = renderSignature(sig.fields, logo ? `cid:${SIGNATURE_LOGO_CID}` : null);
  const stored = renderSignature(sig.fields, null);
  if (!sent) return null;
  return { html: sent.html, storedHtml: stored?.html ?? '', text: sent.text, logo };
}

// ── Drafts ──────────────────────────────────────────────────────────────

export async function saveDraft(db: Db, user: User, input: DraftSaveInput) {
  const draft = draftSaveSchema.parse(input);
  const values = {
    entityType: draft.entityType,
    entityId: draft.entityId,
    toAddresses: draft.to,
    ccAddresses: draft.cc,
    subject: draft.subject,
    bodyHtml: sanitizeComposeHtml(draft.html),
    replyToId: draft.replyToId ?? null,
    includeSignature: draft.includeSignature,
    updatedAt: new Date(),
  };
  return db.transaction(async (tx) => {
    let id = draft.id;
    if (id) {
      const [updated] = await tx
        .update(emailDrafts)
        .set(values)
        .where(and(eq(emailDrafts.id, id), eq(emailDrafts.userId, user.id)))
        .returning({ id: emailDrafts.id });
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'This draft was deleted.' });
    } else {
      const [created] = await tx
        .insert(emailDrafts)
        .values({ ...values, userId: user.id })
        .returning({ id: emailDrafts.id });
      id = created?.id ?? '';
    }
    if (draft.attachmentIds.length) {
      await tx
        .update(emailAttachments)
        .set({ draftId: id })
        .where(
          and(
            inArray(emailAttachments.id, draft.attachmentIds),
            eq(emailAttachments.uploadedByUserId, user.id),
            isNull(emailAttachments.emailMessageId),
          ),
        );
    }
    return { id, savedAt: values.updatedAt.toISOString() };
  });
}

/** The user's own drafts on a record, newest first, with their attachments. */
export async function listDrafts(
  db: Db,
  user: User,
  entityType: ActivityEntityType,
  entityId: string,
) {
  const drafts = await db
    .select()
    .from(emailDrafts)
    .where(
      and(
        eq(emailDrafts.userId, user.id),
        eq(emailDrafts.entityType, entityType),
        eq(emailDrafts.entityId, entityId),
      ),
    )
    .orderBy(desc(emailDrafts.updatedAt));
  const files = drafts.length
    ? await db
        .select()
        .from(emailAttachments)
        .where(
          inArray(
            emailAttachments.draftId,
            drafts.map((d) => d.id),
          ),
        )
    : [];
  return drafts.map((d) => ({
    id: d.id,
    to: d.toAddresses,
    cc: d.ccAddresses,
    subject: d.subject,
    html: d.bodyHtml,
    replyToId: d.replyToId,
    includeSignature: d.includeSignature,
    updatedAt: d.updatedAt.toISOString(),
    attachments: files
      .filter((f) => f.draftId === d.id && !f.emailMessageId)
      .map((f) => ({
        id: f.id,
        fileName: f.fileName,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
      })),
  }));
}

/** Deletes a draft and its unsent attachments. */
export async function deleteDraft(db: Db, storage: Storage | null, user: User, id: string) {
  const [draft] = await db
    .select({ id: emailDrafts.id })
    .from(emailDrafts)
    .where(and(eq(emailDrafts.id, id), eq(emailDrafts.userId, user.id)));
  if (!draft) return { deleted: false };
  const files = await db
    .select({ id: emailAttachments.id, storageKey: emailAttachments.storageKey })
    .from(emailAttachments)
    .where(and(eq(emailAttachments.draftId, id), isNull(emailAttachments.emailMessageId)));
  await db.transaction(async (tx) => {
    if (files.length) {
      await tx.delete(emailAttachments).where(
        inArray(
          emailAttachments.id,
          files.map((f) => f.id),
        ),
      );
    }
    await tx.delete(emailDrafts).where(eq(emailDrafts.id, id));
  });
  if (storage && files.length) await storage.remove(files.map((f) => f.storageKey));
  return { deleted: true };
}
