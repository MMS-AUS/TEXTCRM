import { and, eq, isNull, ne } from 'drizzle-orm';
import type { AU_STATES } from '@mms/shared';
import {
  areaForPostcode,
  addressInputSchema,
  businessToday,
  contactInputSchema,
  LEAD_CONVERTED,
  leadInputSchema,
  leadPricingSchema,
  matchOption,
  nearestBigCity,
  normaliseStreet,
  parseSheetDate,
  parseYesNo,
  splitFullName,
  type AddressValues,
  type ContactValues,
  type LeadValues,
} from '@mms/shared';
import type { z } from 'zod';
import type { Db, Tx } from '../../db/client.ts';
import {
  contactAddresses,
  contacts,
  leadPricing,
  leads,
  leadSystemRequirements,
  users,
} from '../../db/schema/index.ts';
import { logSystemActivity } from '../activities/service.ts';
import { diff, recordAudit, type Actor, type SystemActor } from '../audit.ts';
import { findMatchingContact } from '../contacts/match.ts';
import { findDuplicate, leadRow } from '../leads/router.ts';
import { activeOptions } from '../options.ts';

// One spreadsheet row → a lead or contact, and the create/update/skip decision. Shared by the
// import wizard (Step 3.2) and the live leads sync (Step 3.3) so both follow the same rules.

type Option = { value: string; label: string };
export type Lookups = {
  platforms: Option[];
  leadSources: Option[];
  leadStatuses: Option[];
  roofTypes: Option[];
  contactTypes: Option[];
  users: { id: string; name: string; email: string }[];
};

/** Option lists and active users, loaded once per import or sync run. */
export async function loadLookups(db: Db | Tx): Promise<Lookups> {
  const lists = await activeOptions(db as Db, [
    'platforms',
    'leadSources',
    'leadStatuses',
    'roofTypes',
    'contactTypes',
  ]);
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.isActive, true));
  return {
    platforms: lists.platforms ?? [],
    leadSources: lists.leadSources ?? [],
    leadStatuses: lists.leadStatuses ?? [],
    roofTypes: lists.roofTypes ?? [],
    contactTypes: lists.contactTypes ?? [],
    users: people,
  };
}

export type Origin = { actor: Actor | SystemActor; authorUserId: string | null; subject: string };

const STATE_NAMES: Record<string, (typeof AU_STATES)[number]> = {
  'new south wales': 'NSW',
  queensland: 'QLD',
  victoria: 'VIC',
  'western australia': 'WA',
  'south australia': 'SA',
  tasmania: 'TAS',
  'australian capital territory': 'ACT',
  'northern territory': 'NT',
};

function cleanState(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return STATE_NAMES[text.trim().toLowerCase()] ?? text.trim().toUpperCase();
}

/** Spreadsheets drop the leading zero of NT/ACT postcodes (800 → 0800). */
const cleanPostcode = (text: string | undefined) =>
  text && /^\d{3}$/.test(text.trim()) ? `0${text.trim()}` : text;

/**
 * Phone numbers stored as numbers lose their leading zero too (0412 345 678 → 412345678). Nine
 * digits starting like an Australian mobile (4) or landline (2, 3, 7, 8) get it back.
 */
const cleanPhone = (text: string | undefined) =>
  text && /^[23478]\d{8}$/.test(text.replace(/\s/g, '')) ? `0${text.replace(/\s/g, '')}` : text;

function firstIssue(error: z.ZodError, labels: Record<string, string>): string {
  return error.issues
    .map((issue) => {
      const key = String(issue.path[0] ?? '');
      return labels[key] ? `${labels[key]}: ${issue.message}` : issue.message;
    })
    .join(' ');
}

const LEAD_LABELS: Record<string, string> = {
  firstName: 'First name',
  email: 'Email',
  mobile: 'Mobile',
  secondaryMobile: 'Secondary mobile',
  state: 'State',
  postcode: 'Postcode',
  systemPriceAud: 'System price',
  sellingPriceAud: 'Selling price',
  depositAud: 'Deposit',
  systemSizeKw: 'System size',
};

function names(data: Record<string, string>) {
  if (data.firstName) return { firstName: data.firstName, lastName: data.lastName ?? null };
  if (data.fullName) {
    const split = splitFullName(data.fullName);
    return { firstName: split.firstName, lastName: data.lastName ?? split.lastName };
  }
  return { firstName: '', lastName: data.lastName ?? null };
}

// ── Leads ────────────────────────────────────────────────────────────────

export type LeadRecord = {
  sheetLeadId: string | null;
  lead: LeadValues;
  system: {
    systemSizeKw?: string | null;
    batteryRequired?: boolean;
    propertyType?: string | null;
    roofType?: string | null;
  };
  pricing: {
    systemPriceAud?: string | null;
    sellingPriceAud?: string | null;
    depositAud?: string | null;
  };
  /** Which fields the row actually had (empty cells never blank existing data). */
  given: Set<string>;
  /** Things that were cleaned up or left out, shown next to the row. */
  notes: string[];
};

type Result<T> = { ok: true; record: T } | { ok: false; message: string };

/** Validates and cleans one mapped row. Unknown dropdown values are left empty with a note. */
export function toLeadRecord(data: Record<string, string>, lookups: Lookups): Result<LeadRecord> {
  const notes: string[] = [];
  const given = new Set(Object.keys(data));
  const option = (key: string, list: Option[], label: string) => {
    const text = data[key];
    if (!text) return null;
    const value = matchOption(text, list);
    if (!value) notes.push(`${label} "${text}" isn't in the list — left empty.`);
    return value;
  };

  const leadDate = parseSheetDate(data.leadDate ?? '');
  if (leadDate === false) {
    return {
      ok: false,
      message: `Lead date "${data.leadDate ?? ''}" isn't a date (use day/month/year).`,
    };
  }
  if (leadDate && leadDate > businessToday()) {
    return { ok: false, message: `Lead date ${leadDate} is in the future.` };
  }
  let status = option('status', lookups.leadStatuses, 'Status') ?? 'New';
  if (status === LEAD_CONVERTED) {
    notes.push('"Converted to Project" is set only by converting in the CRM — imported as New.');
    status = 'New';
  }
  let ownerUserId: string | null = null;
  if (data.ownerName) {
    const wanted = data.ownerName.trim().toLowerCase();
    const owner = lookups.users.find(
      (user) => user.name.toLowerCase() === wanted || user.email.toLowerCase() === wanted,
    );
    if (owner) ownerUserId = owner.id;
    else notes.push(`Sales rep "${data.ownerName}" isn't a CRM user — left unassigned.`);
  }

  const parsed = leadInputSchema.safeParse({
    ...names(data),
    email: data.email,
    mobile: cleanPhone(data.mobile),
    secondaryMobile: cleanPhone(data.secondaryMobile),
    streetAddress: data.streetAddress,
    suburb: data.suburb,
    state: cleanState(data.state),
    postcode: cleanPostcode(data.postcode),
    platform: option('platform', lookups.platforms, 'Platform'),
    source: option('source', lookups.leadSources, 'Lead source'),
    status,
    ownerUserId,
    leadDate: leadDate ?? undefined,
    notes: data.notes,
  });
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error, LEAD_LABELS) };

  const pricing = leadPricingSchema.safeParse({
    systemPriceAud: data.systemPriceAud,
    sellingPriceAud: data.sellingPriceAud,
    depositAud: data.depositAud,
  });
  if (!pricing.success) return { ok: false, message: firstIssue(pricing.error, LEAD_LABELS) };

  const system: LeadRecord['system'] = {};
  if (data.systemSizeKw) {
    const size = Number(data.systemSizeKw.replace(/kw/i, '').trim());
    if (!Number.isFinite(size) || size < 0 || size > 1000) {
      return { ok: false, message: `System size "${data.systemSizeKw}" isn't a number of kW.` };
    }
    system.systemSizeKw = size.toFixed(2);
  }
  if (data.batteryRequired) {
    const battery = parseYesNo(data.batteryRequired);
    if (battery === undefined)
      notes.push(`Battery "${data.batteryRequired}" isn't Yes or No — left empty.`);
    else if (battery !== null) system.batteryRequired = battery;
  }
  if (data.roofType) system.roofType = option('roofType', lookups.roofTypes, 'Roof type');
  if (data.propertyType) system.propertyType = data.propertyType.slice(0, 100);

  const money: LeadRecord['pricing'] = {};
  for (const key of ['systemPriceAud', 'sellingPriceAud', 'depositAud'] as const) {
    if (data[key]) money[key] = pricing.data[key];
  }

  return {
    ok: true,
    record: {
      sheetLeadId: data.sheetLeadId?.slice(0, 100) ?? null,
      lead: parsed.data,
      system,
      pricing: money,
      given,
      notes,
    },
  };
}

type LeadRow = typeof leads.$inferSelect;

/**
 * The existing lead this row is: same live-sheet Lead ID, else (imports) the same Lead ID from
 * an earlier import, else the §1.4 duplicate rules (same email/phone/name at the same property).
 */
export async function findLeadMatch(
  db: Db | Tx,
  record: LeadRecord,
  sheetSourceId: string | null,
): Promise<{ lead: LeadRow; how: 'lead id' | 'duplicate'; reason: string } | null> {
  if (record.sheetLeadId) {
    const [byId] = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.sheetLeadId, record.sheetLeadId),
          sheetSourceId ? eq(leads.sheetSourceId, sheetSourceId) : isNull(leads.sheetSourceId),
          isNull(leads.deletedAt),
        ),
      )
      .limit(1);
    if (byId) return { lead: byId, how: 'lead id', reason: `Lead ID ${record.sheetLeadId}` };
  }
  const duplicate = await findDuplicate(db, record.lead);
  if (!duplicate) return null;
  const [lead] = await db.select().from(leads).where(eq(leads.id, duplicate.lead.id));
  return lead ? { lead, how: 'duplicate', reason: duplicate.reason } : null;
}

/** Lead fields a re-import or the sync may update (never status, owner or notes — §1.8 rule 3). */
const INTAKE_KEYS = [
  'firstName',
  'lastName',
  'email',
  'mobile',
  'secondaryMobile',
  'streetAddress',
  'suburb',
  'state',
  'postcode',
  'platform',
  'source',
  'leadDate',
] as const;

/** The intake changes this row would make to an existing lead (only fields the row has). */
export async function leadIntakeChanges(db: Db | Tx, existing: LeadRow, record: LeadRecord) {
  const has = (key: string) =>
    record.given.has(key) ||
    (key === 'firstName' && record.given.has('fullName')) ||
    (key === 'lastName' && record.given.has('fullName'));
  const core: Record<string, unknown> = {};
  for (const key of INTAKE_KEYS) {
    if (has(key) && record.lead[key] !== undefined) core[key] = record.lead[key];
  }
  if ('postcode' in core || 'state' in core) {
    const postcode = (core.postcode as string | null | undefined) ?? existing.postcode;
    const state = (core.state as string | null | undefined) ?? existing.state;
    core.area = areaForPostcode(postcode);
    core.nearestBigCity = postcode || state ? nearestBigCity(postcode, state) : null;
  }
  const [system] = await db
    .select()
    .from(leadSystemRequirements)
    .where(eq(leadSystemRequirements.leadId, existing.id));
  const [pricing] = await db.select().from(leadPricing).where(eq(leadPricing.leadId, existing.id));
  return {
    core: diff(existing, core),
    system: Object.keys(record.system).length ? diff(system ?? {}, record.system) : null,
    pricing: Object.keys(record.pricing).length ? diff(pricing ?? {}, record.pricing) : null,
  };
}

export type LeadChanges = Awaited<ReturnType<typeof leadIntakeChanges>>;

export const hasChanges = (changes: LeadChanges) =>
  Boolean(changes.core ?? changes.system ?? changes.pricing);

/** Every field name changed, for the row message ("Updates: mobile, suburb"). */
export const changedFields = (changes: LeadChanges) => [
  ...Object.keys(changes.core?.after ?? {}).filter(
    (key) => key !== 'area' && key !== 'nearestBigCity',
  ),
  ...Object.keys(changes.system?.after ?? {}),
  ...Object.keys(changes.pricing?.after ?? {}),
];

async function saveLeadDetails(tx: Tx, leadId: string, record: LeadRecord) {
  if (Object.keys(record.system).length) {
    await tx
      .insert(leadSystemRequirements)
      .values({ leadId, ...record.system })
      .onConflictDoUpdate({ target: leadSystemRequirements.leadId, set: record.system });
  }
  if (Object.keys(record.pricing).length) {
    await tx
      .insert(leadPricing)
      .values({ leadId, ...record.pricing })
      .onConflictDoUpdate({ target: leadPricing.leadId, set: record.pricing });
  }
}

/** Creates the lead (linked to an existing contact with the same email/mobile, as in the app). */
export async function createLeadFromRecord(
  tx: Tx,
  record: LeadRecord,
  origin: Origin,
  sheetSourceId: string | null,
): Promise<string> {
  const contact = await findMatchingContact(tx, record.lead);
  const row = {
    ...leadRow(record.lead),
    leadDate: record.lead.leadDate ?? businessToday(),
    contactId: contact?.id ?? null,
    sheetLeadId: record.sheetLeadId,
    sheetSourceId,
    createdByUserId: origin.authorUserId,
    updatedByUserId: origin.authorUserId,
  };
  const [created] = await tx.insert(leads).values(row).returning({ id: leads.id });
  if (!created) throw new Error('Insert returned no row');
  await saveLeadDetails(tx, created.id, record);
  await logSystemActivity(tx, {
    entityType: 'lead',
    entityId: created.id,
    authorUserId: origin.authorUserId,
    subject: origin.subject,
    metadata: { status: record.lead.status },
  });
  await recordAudit(tx, origin.actor, {
    action: 'create',
    entityType: 'lead',
    entityId: created.id,
    after: { ...row, ...record.system, ...record.pricing },
  });
  return created.id;
}

/** Applies intake changes. Doesn't mark the lead as edited in the CRM — the sheet still owns it. */
export async function updateLeadIntake(
  tx: Tx,
  leadId: string,
  record: LeadRecord,
  changes: LeadChanges,
  origin: Origin,
) {
  if (changes.core) {
    await tx.update(leads).set(changes.core.after).where(eq(leads.id, leadId));
  }
  await saveLeadDetails(tx, leadId, {
    ...record,
    system: changes.system ? record.system : {},
    pricing: changes.pricing ? record.pricing : {},
  });
  await recordAudit(tx, origin.actor, {
    action: 'update',
    entityType: 'lead',
    entityId: leadId,
    before: {
      ...changes.core?.before,
      ...changes.system?.before,
      ...changes.pricing?.before,
    },
    after: { ...changes.core?.after, ...changes.system?.after, ...changes.pricing?.after },
  });
}

/** The within-file key that makes two rows "the same enquiry" before either is saved. */
export function leadRowKey(record: LeadRecord): string {
  if (record.sheetLeadId) return `id:${record.sheetLeadId}`;
  const who = record.lead.email ?? record.lead.mobile ?? '';
  return `${who}|${normaliseStreet(record.lead.streetAddress)}|${record.lead.postcode ?? ''}`;
}

// ── Contacts ─────────────────────────────────────────────────────────────

export type ContactRecord = {
  contact: ContactValues;
  address: AddressValues | null;
  given: Set<string>;
  notes: string[];
};

export function toContactRecord(
  data: Record<string, string>,
  lookups: Lookups,
): Result<ContactRecord> {
  const notes: string[] = [];
  let type = 'Residential';
  if (data.type) {
    const match = matchOption(data.type, lookups.contactTypes);
    if (match) type = match;
    else notes.push(`Contact type "${data.type}" isn't in the list — set to Residential.`);
  }
  const parsed = contactInputSchema.safeParse({
    ...names(data),
    email: data.email,
    mobile: cleanPhone(data.mobile),
    secondaryMobile: cleanPhone(data.secondaryMobile),
    type,
    notes: data.notes,
  });
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error, LEAD_LABELS) };

  let address: AddressValues | null = null;
  const addressGiven = ['streetAddress', 'suburb', 'state', 'postcode'].some((k) => data[k]);
  if (addressGiven) {
    const result = addressInputSchema.safeParse({
      streetAddress: data.streetAddress,
      suburb: data.suburb,
      state: cleanState(data.state),
      postcode: cleanPostcode(data.postcode),
      isPrimary: true,
    });
    if (result.success) address = result.data;
    else notes.push(`Address left out (${firstIssue(result.error, LEAD_LABELS)})`);
  }
  return {
    ok: true,
    record: { contact: parsed.data, address, given: new Set(Object.keys(data)), notes },
  };
}

/** Who already has this email or mobile, apart from `excludeId`. */
async function takenBy(db: Db | Tx, field: 'email' | 'mobile', value: string, excludeId: string) {
  const [other] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts[field], value), isNull(contacts.archivedAt), ne(contacts.id, excludeId)))
    .limit(1);
  return Boolean(other);
}

export type ContactPlan =
  | { action: 'create' }
  | { action: 'update'; contactId: string; fill: Record<string, string>; addAddress: boolean }
  | { action: 'skip'; contactId: string; message: string };

/**
 * An existing contact (same email or mobile) only gets its empty fields filled in — existing
 * values are never overwritten — plus this address if it's new to them.
 */
export async function planContact(db: Db | Tx, record: ContactRecord): Promise<ContactPlan> {
  const match = await findMatchingContact(db, record.contact);
  if (!match) return { action: 'create' };
  const [existing] = await db.select().from(contacts).where(eq(contacts.id, match.id));
  if (!existing) return { action: 'create' };
  const fill: Record<string, string> = {};
  for (const key of ['lastName', 'email', 'mobile', 'secondaryMobile', 'notes'] as const) {
    const value = record.contact[key];
    if (!value || existing[key]) continue;
    if ((key === 'email' || key === 'mobile') && (await takenBy(db, key, value, existing.id)))
      continue;
    fill[key] = value;
  }
  let addAddress = false;
  if (record.address) {
    const addresses = await db
      .select({
        streetAddress: contactAddresses.streetAddress,
        postcode: contactAddresses.postcode,
      })
      .from(contactAddresses)
      .where(eq(contactAddresses.contactId, existing.id));
    const street = normaliseStreet(record.address.streetAddress);
    addAddress = !addresses.some(
      (a) => normaliseStreet(a.streetAddress) === street && a.postcode === record.address?.postcode,
    );
  }
  if (Object.keys(fill).length === 0 && !addAddress) {
    return { action: 'skip', contactId: existing.id, message: 'Already in the CRM — nothing new.' };
  }
  return { action: 'update', contactId: existing.id, fill, addAddress };
}

async function addAddress(tx: Tx, contactId: string, address: AddressValues, primary: boolean) {
  await tx.insert(contactAddresses).values({
    contactId,
    ...address,
    isPrimary: primary,
    area: areaForPostcode(address.postcode),
    nearestBigCity: nearestBigCity(address.postcode, address.state),
  });
}

export async function applyContact(
  tx: Tx,
  record: ContactRecord,
  plan: ContactPlan,
  origin: Origin,
): Promise<string | null> {
  if (plan.action === 'skip') return plan.contactId;
  if (plan.action === 'create') {
    const [created] = await tx
      .insert(contacts)
      .values({
        ...record.contact,
        source: 'Import',
        createdByUserId: origin.authorUserId,
        updatedByUserId: origin.authorUserId,
      })
      .returning({ id: contacts.id });
    if (!created) throw new Error('Insert returned no row');
    if (record.address) await addAddress(tx, created.id, record.address, true);
    await recordAudit(tx, origin.actor, {
      action: 'create',
      entityType: 'contact',
      entityId: created.id,
      after: { ...record.contact, source: 'Import' },
    });
    return created.id;
  }
  if (Object.keys(plan.fill).length) {
    await tx.update(contacts).set(plan.fill).where(eq(contacts.id, plan.contactId));
  }
  if (plan.addAddress && record.address) {
    const [primary] = await tx
      .select({ id: contactAddresses.id })
      .from(contactAddresses)
      .where(
        and(eq(contactAddresses.contactId, plan.contactId), eq(contactAddresses.isPrimary, true)),
      );
    await addAddress(tx, plan.contactId, record.address, !primary);
  }
  await recordAudit(tx, origin.actor, {
    action: plan.addAddress && Object.keys(plan.fill).length === 0 ? 'address_add' : 'update',
    entityType: 'contact',
    entityId: plan.contactId,
    after: {
      ...plan.fill,
      ...(plan.addAddress && record.address ? { address: record.address.streetAddress } : {}),
    },
  });
  return plan.contactId;
}

/** Same within-file key for contacts: email, else mobile. */
export const contactRowKey = (record: ContactRecord) =>
  record.contact.email ?? record.contact.mobile ?? '';
