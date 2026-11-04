import { TRPCError } from '@trpc/server';
import { and, eq, ilike, isNull } from 'drizzle-orm';
import { pino } from 'pino';
import {
  AU_STATES,
  hasPermission,
  matchOption,
  normaliseStreet,
  type ProjectStage,
} from '@mms/shared';
import { findUserForAuth } from '../../auth/users-repo.ts';
import type { AuthUser } from '../../auth/types.ts';
import type { Db, Tx } from '../../db/client.ts';
import {
  activities,
  contacts,
  hardwareInverters,
  hardwarePanels,
  leads,
  leadSystemRequirements,
  projects,
} from '../../db/schema/index.ts';
import { appRouter } from '../../trpc/router.ts';
import { createCallerFactory } from '../../trpc/trpc.ts';
import { logSystemActivity } from '../activities/service.ts';
import { recordAudit, type Actor } from '../audit.ts';
import {
  applyContact,
  createLeadFromRecord,
  loadLookups,
  planContact,
  toContactRecord,
  toLeadRecord,
  type Lookups,
  type Origin,
} from '../imports/records.ts';
import { findMatchingContact } from '../contacts/match.ts';
import { findDuplicate } from '../leads/router.ts';
import { activeOptions } from '../options.ts';
import { convertLead } from '../projects/conversion.ts';
import type { LegacyContact, LegacyData, LegacyLead, LegacyProject } from './legacy-data.ts';

// Step 3.4 — the one-off move of the real records from the old CRM (§1.9): 5 customers (their
// contacts and leads; Rojin Piya's second lead is merged into the converted one) and project
// 9979467, which keeps its number. Everything runs in ONE transaction: a dry run does all of it
// — every validation and duplicate check — and then rolls back, so the report shows exactly
// what a real run will do. Re-running after a real run finds everything and changes nothing.

export type MigrationOptions = {
  /** The CRM user the migration acts as (audit log, timelines). Needs create/edit rights. */
  actorEmail: string;
  /** false = dry run: report, then roll everything back. */
  commit: boolean;
  /** Keep both Rojin Piya leads instead of merging them (they are for two properties). */
  keepBoth?: boolean;
  /** Also bring in project values that look like test data from the old app. */
  includeSuspect?: boolean;
};

export type ReportArea = 'Contact' | 'Lead' | 'Project' | 'Left out';
export type ReportAction = 'create' | 'update' | 'merge' | 'skip' | 'leave out' | 'problem';
export type ReportLine = {
  area: ReportArea;
  action: ReportAction;
  subject: string;
  detail: string;
};

export type MigrationReport = { committed: boolean; lines: ReportLine[] };

/** The old stage list had "Grid Meter Connected" second to last; the new one has this there. */
const STAGE_MAP: Record<string, ProjectStage> = {
  'Site Survey': 'Engineering & DNSP Approval',
  'Engineering & DNSP Approval': 'Engineering & DNSP Approval',
  'Sales Order Dispatched': 'Sales Order Created (Warehouse)',
  'RFQ Sent to Installers': 'Subcontractor RFQ / Quoting',
  'Install Scheduled': 'Install Scheduled',
  'Installation in Progress': 'Installation in Progress',
  'Installation Completed': 'Installation Completed',
  'BridgeSelect STC Claimed': 'Clean Energy Regulator (STC Claim)',
  'Grid Meter Connected': 'DNSP Grid Inspection & Metering',
  Completed: 'Completed',
};

/**
 * Project values that look like the old app's placeholder content (§0.1: staff, invoices and
 * company details were made up). Left out unless --include-suspect; the report lists them.
 */
const SUSPECT: { key: keyof LegacyProject; why: string }[] = [
  { key: 'notes', why: 'reads like a test entry' },
  { key: 'retailerRef', why: 'placeholder-style reference' },
  { key: 'customerInvoiceNumber', why: 'placeholder-style invoice number' },
  { key: 'warehouse', why: 'a Sydney warehouse for a QLD job — looks made up' },
  { key: 'warehouseInvoiceNumber', why: 'placeholder-style invoice number' },
  { key: 'warehouseInvoiceDate', why: 'goes with the placeholder invoice' },
  { key: 'warehouseInvoiceAmount', why: 'goes with the placeholder invoice' },
  { key: 'warehouseInvoiceStatus', why: 'goes with the placeholder invoice' },
  { key: 'installerName', why: 'not a company in the CRM (installers are companies)' },
  { key: 'installerInvoiceNumber', why: 'placeholder-style invoice number' },
  { key: 'installerInvoiceDate', why: 'goes with the placeholder invoice' },
  { key: 'installerInvoiceAmount', why: 'goes with the placeholder invoice' },
  { key: 'installerInvoiceStatus', why: 'goes with the placeholder invoice' },
  { key: 'installationBookedBy', why: 'a job title, not a CRM user' },
];

class DryRunRollback extends Error {}

const createCaller = createCallerFactory(appRouter);

const nameOf = (person: { firstName?: string | null; lastName?: string | null }) =>
  [person.firstName, person.lastName].filter(Boolean).join(' ') || '(no name)';

const personKey = (lead: LegacyLead) =>
  (lead.email?.toLowerCase() ?? lead.primaryMobile?.replace(/\D/g, '') ?? lead.id).trim();

const place = (lead: { address?: string; suburb?: string; state?: string; postcode?: string }) =>
  [lead.address, [lead.suburb, lead.state, lead.postcode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');

/** "lead-sheet-GSHEET_ROW_4" → mapped cell values the import cleaners understand. */
function leadData(lead: LegacyLead): Record<string, string> {
  const data: Record<string, string | undefined> = {
    leadDate: lead.leadDate,
    platform: lead.platform,
    source: lead.source,
    status: lead.status,
    ownerName: lead.salesPersonName ?? lead.assignedTo,
    firstName: lead.firstName,
    lastName: lead.lastName,
    mobile: lead.primaryMobile,
    secondaryMobile: lead.secondaryMobile,
    email: lead.email,
    streetAddress: lead.address,
    suburb: lead.suburb,
    state: lead.state,
    postcode: lead.postcode,
    systemSizeKw: lead.systemSizeKw,
    batteryRequired:
      lead.batteryRequired === undefined ? undefined : lead.batteryRequired ? 'Yes' : 'No',
    propertyType: lead.propertyType,
    roofType: lead.roofType,
    systemPriceAud: lead.systemPrice,
    sellingPriceAud: lead.sellingPrice,
    depositAud: lead.deposit,
    notes: lead.salesTeamNotes,
  };
  return Object.fromEntries(
    Object.entries(data).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

async function findHardware(
  tx: Tx,
  kind: 'panel' | 'inverter',
  model: string | undefined,
): Promise<string | null> {
  if (!model) return null;
  const table = kind === 'panel' ? hardwarePanels : hardwareInverters;
  const [row] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(ilike(table.model, model), isNull(table.archivedAt)))
    .limit(1);
  return row?.id ?? null;
}

const whole = (value: string | undefined) =>
  value && /^\d+$/.test(value) ? Number(value) : undefined;

/** A TRPC/zod refusal in one line. */
function refusal(error: unknown): string {
  if (error instanceof TRPCError) {
    const cause = error.cause as { issues?: { path: unknown[]; message: string }[] } | undefined;
    if (cause?.issues?.length) {
      return cause.issues
        .map((issue) => `${issue.path.slice(-1).join('.') || 'value'}: ${issue.message}`)
        .join('; ');
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function migrateLegacy(
  db: Db,
  data: LegacyData,
  options: MigrationOptions,
): Promise<MigrationReport> {
  const user = await findUserForAuth(db, options.actorEmail.trim().toLowerCase());
  if (!user?.isActive) {
    throw new Error(`${options.actorEmail} is not an active CRM user.`);
  }
  for (const feature of ['leads', 'contacts', 'projects'] as const) {
    for (const action of ['create', 'edit'] as const) {
      if (!hasPermission(user.permissions, feature, action)) {
        throw new Error(`${user.email}'s role can't ${action} ${feature}; use an admin.`);
      }
    }
  }

  const lines: ReportLine[] = [];
  const say = (area: ReportArea, action: ReportAction, subject: string, detail: string) =>
    lines.push({ area, action, subject, detail });

  try {
    await db.transaction(async (tx) => {
      await run(tx, user, data, options, say);
      if (!options.commit) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return { committed: options.commit, lines };
}

type Say = (area: ReportArea, action: ReportAction, subject: string, detail: string) => void;

async function run(tx: Tx, user: AuthUser, data: LegacyData, options: MigrationOptions, say: Say) {
  const meta = { requestId: 'legacy-migration', ipAddress: null, userAgent: 'migrate-legacy' };
  const actor: Actor = { userId: user.id, meta };
  const origin = (subject: string): Origin => ({ actor, authorUserId: user.id, subject });
  // The app's own procedures (validation, option checks, audit), inside this transaction:
  // their nested transactions become savepoints, so a refused section rolls back alone.
  const api = createCaller({
    db: tx as unknown as Db, // A transaction offers everything the procedures use.
    log: pino({ level: 'silent' }),
    auth: { status: 'authenticated', user, firebaseUid: 'migrate-legacy' },
    meta,
    storage: null,
    jobs: null,
    sheets: null,
    syncIntervalMinutes: 5,
    sessions: null,
    allowedEmailDomain: user.email.split('@')[1] ?? '',
  });
  const lookups = await loadLookups(tx);

  for (const contact of data.contacts) await migrateContact(tx, contact, lookups, origin, say);

  // ── Leads ──
  // Leads of one person: unless --keep-both, the converted one (or the oldest) stays and the
  // others are folded into it (§1.9: Rojin Piya ×2).
  const groups = new Map<string, LegacyLead[]>();
  for (const lead of data.leads) {
    groups.set(personKey(lead), [...(groups.get(personKey(lead)) ?? []), lead]);
  }
  const crmLeadId = new Map<string, string>();
  const extraOptions = await activeOptions(tx as unknown as Db, ['houseStoreys', 'phases']);

  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => {
      const converted = (lead: LegacyLead) => (lead.projectNumber ? 0 : 1);
      return converted(a) - converted(b) || (a.leadDate ?? '').localeCompare(b.leadDate ?? '');
    });
    const [keep, ...rest] = sorted;
    if (!keep) continue;
    if (options.keepBoth || rest.length === 0) {
      for (const lead of sorted) {
        await migrateLead(tx, lead, lookups, extraOptions, origin, say, crmLeadId);
      }
      continue;
    }
    await migrateLead(tx, keep, lookups, extraOptions, origin, say, crmLeadId);
    const keptId = crmLeadId.get(keep.id);
    for (const merged of rest) {
      if (!keptId) continue;
      const subject = `Merged from the old CRM: a second enquiry (${merged.platform ?? 'unknown platform'}, ${merged.leadDate ?? 'no date'}) for ${place(merged)}. That address is on the contact.`;
      const [already] = await tx
        .select({ id: activities.id })
        .from(activities)
        .where(and(eq(activities.entityId, keptId), eq(activities.subject, subject)));
      if (!already) {
        await logSystemActivity(tx, {
          entityType: 'lead',
          entityId: keptId,
          authorUserId: user.id,
          subject,
          metadata: { legacyLeadId: merged.id },
        });
      }
      // The same enquiry may already be its own lead (e.g. the live sheet has both rows).
      const record = toLeadRecord(leadData(merged), lookups);
      const twin = record.ok ? await findDuplicate(tx, record.record.lead, keptId) : null;
      let retired = '';
      if (twin && twin.lead.id !== keptId) {
        const [lead] = await tx.select().from(leads).where(eq(leads.id, twin.lead.id));
        if (lead && !lead.deletedAt && !lead.convertedAt) {
          await tx
            .update(leads)
            .set({
              deletedAt: new Date(),
              crmEditedAt: lead.crmEditedAt ?? new Date(),
              updatedByUserId: user.id,
            })
            .where(eq(leads.id, lead.id));
          await logSystemActivity(tx, {
            entityType: 'lead',
            entityId: lead.id,
            authorUserId: user.id,
            subject: `Merged into ${nameOf(keep)}'s lead for ${place(keep)} (legacy migration)`,
            metadata: { mergedInto: keptId },
          });
          await recordAudit(tx, actor, {
            action: 'delete',
            entityType: 'lead',
            entityId: lead.id,
            after: { reason: 'merged', mergedInto: keptId },
          });
          retired = ` The CRM already had it as its own lead${lead.sheetLeadId ? ` (live sheet Lead ID ${lead.sheetLeadId})` : ''}: that lead is moved to Deleted (restorable) and the sheet won't bring it back.`;
        }
      }
      say(
        'Lead',
        'merge',
        `${nameOf(merged)} — ${place(merged)}`,
        `old lead ${merged.id} is folded into the lead for ${place(keep)} — a timeline note keeps its details, the address stays on the contact.${retired} Use --keep-both to keep it as its own lead instead.`,
      );
    }
  }
  const activityCount = data.leads.reduce(
    (total, lead) => total + (lead.activities?.length ?? 0),
    0,
  );
  if (activityCount) {
    say(
      'Left out',
      'leave out',
      `${String(activityCount)} old timeline entries`,
      'they name placeholder staff (e.g. "Mitchell Barnes") and generic text; each lead gets one "Migrated from the old CRM" entry instead',
    );
  }

  for (const project of data.projects) {
    await migrateProject(tx, api, project, data, crmLeadId, options, actor, say);
  }
}

async function migrateContact(
  tx: Tx,
  legacy: LegacyContact,
  lookups: Lookups,
  origin: (subject: string) => Origin,
  say: Say,
) {
  const addresses = legacy.addresses?.length
    ? legacy.addresses
    : [
        {
          street: legacy.streetAddress,
          suburb: legacy.suburb,
          state: legacy.state,
          postcode: legacy.postcode,
          isPrimary: true,
        },
      ];
  const ordered = [...addresses].sort(
    (a, b) => Number(b.isPrimary ?? false) - Number(a.isPrimary ?? false),
  );
  const name = nameOf(legacy);
  let contactId: string | null = null;
  for (const [index, address] of ordered.entries()) {
    const cells = Object.fromEntries(
      Object.entries({
        firstName: legacy.firstName,
        lastName: legacy.lastName,
        email: legacy.email,
        mobile: legacy.phone,
        type: legacy.contactType ?? legacy.type,
        notes: legacy.notes,
        streetAddress: address.street,
        suburb: address.suburb,
        state: address.state,
        postcode: address.postcode,
      }).filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const parsed = toContactRecord(cells, lookups);
    if (!parsed.ok) {
      say('Contact', 'problem', name, parsed.message);
      return;
    }
    const where = [address.street, address.suburb, address.state].filter(Boolean).join(', ');
    const plan = await planContact(tx, parsed.record);
    if (index === 0) {
      if (plan.action === 'skip') {
        say('Contact', 'skip', name, `already in the CRM (same email or mobile) — ${plan.message}`);
        contactId = plan.contactId;
        continue;
      }
      contactId = await applyContact(tx, parsed.record, plan, origin(''));
      if (plan.action === 'create' && contactId) {
        await tx.update(contacts).set({ source: 'Old CRM' }).where(eq(contacts.id, contactId));
        say(
          'Contact',
          'create',
          name,
          `${parsed.record.contact.email ?? ''} ${parsed.record.contact.mobile ?? ''} · ${where}`.trim(),
        );
      } else {
        say(
          'Contact',
          'update',
          name,
          `already in the CRM — fills in empty details${plan.action === 'update' && plan.addAddress ? ` and adds ${where}` : ''}`,
        );
      }
      continue;
    }
    // Further properties of the same person.
    if (plan.action === 'update' && plan.addAddress && contactId) {
      await applyContact(tx, parsed.record, { ...plan, fill: {} }, origin(''));
      say('Contact', 'update', name, `adds a second address: ${where}`);
    }
  }
}

async function migrateLead(
  tx: Tx,
  legacy: LegacyLead,
  lookups: Lookups,
  extra: Record<string, { value: string; label: string }[] | undefined>,
  origin: (subject: string) => Origin,
  say: Say,
  crmLeadId: Map<string, string>,
) {
  const subject = `${nameOf(legacy)} — ${place(legacy)}`;
  const result = toLeadRecord(leadData(legacy), lookups);
  if (!result.ok) {
    say('Lead', 'problem', subject, result.message);
    return;
  }
  const record = result.record;
  const duplicate = await findDuplicate(tx, record.lead);
  if (duplicate) {
    crmLeadId.set(legacy.id, duplicate.lead.id);
    // Leads from the live sheet had no contact yet; attach the one created above. Not a CRM
    // edit of the lead's details, so the sheet's ownership (crm_edited_at) is unchanged.
    const contact = await findMatchingContact(tx, record.lead);
    let linked = false;
    if (contact) {
      const updated = await tx
        .update(leads)
        .set({ contactId: contact.id })
        .where(and(eq(leads.id, duplicate.lead.id), isNull(leads.contactId)))
        .returning({ id: leads.id });
      linked = updated.length > 0;
    }
    say(
      'Lead',
      'skip',
      subject,
      `already in the CRM (${duplicate.reason}) — not created again${linked ? '; linked to the contact' : ''}`,
    );
    return;
  }
  const id = await createLeadFromRecord(
    tx,
    record,
    origin(
      `Migrated from the old CRM (${legacy.id}${legacy.createdAt ? `, created ${legacy.createdAt.slice(0, 10)}` : ''})`,
    ),
    null,
  );
  crmLeadId.set(legacy.id, id);

  // What the import columns don't cover: the original created date, sale date, site details.
  const createdAt = legacy.createdAt ? new Date(legacy.createdAt) : null;
  await tx
    .update(leads)
    .set({
      ...(createdAt && !Number.isNaN(createdAt.getTime()) ? { createdAt } : {}),
      saleDate: legacy.saleDate ?? null,
      addressVerified: legacy.addressVerified ?? false,
      managerRenteeFirstName: legacy.managerRenteeFirstName ?? null,
      managerRenteeLastName: legacy.managerRenteeLastName ?? null,
    })
    .where(eq(leads.id, id));
  const site = {
    houseStorey: legacy.houseStorey
      ? matchOption(legacy.houseStorey, extra.houseStoreys ?? [])
      : null,
    phase: legacy.phaseType ? matchOption(legacy.phaseType, extra.phases ?? []) : null,
    existingSystemDetails: legacy.existingSystemDetails ?? null,
  };
  if (site.houseStorey ?? site.phase ?? site.existingSystemDetails) {
    await tx
      .insert(leadSystemRequirements)
      .values({ leadId: id, ...site })
      .onConflictDoUpdate({ target: leadSystemRequirements.leadId, set: site });
  }
  const notes = [
    ...record.notes,
    ...(legacy.status === 'Converted to Project'
      ? ['becomes "Converted to Project" when its project is migrated below.']
      : []),
  ];
  say(
    'Lead',
    'create',
    subject,
    [
      `${legacy.platform ?? 'no platform'}, ${legacy.leadDate ?? 'no date'}`,
      record.pricing.sellingPriceAud ? `selling price $${record.pricing.sellingPriceAud}` : null,
      ...notes,
    ]
      .filter(Boolean)
      .join(' · '),
  );
}

type Api = ReturnType<typeof createCaller>;

async function migrateProject(
  tx: Tx,
  api: Api,
  legacy: LegacyProject,
  data: LegacyData,
  crmLeadId: Map<string, string>,
  options: MigrationOptions,
  actor: Actor,
  say: Say,
) {
  const number = legacy.projectNumber ?? legacy.projectCode;
  const subject = `${number ?? '(no number)'} — ${legacy.title ?? 'project'}`;
  if (!number) {
    say('Project', 'problem', subject, 'has no project number');
    return;
  }
  const [existing] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.projectNumber, number));
  if (existing) {
    say('Project', 'skip', subject, 'already in the CRM with this number — not migrated again');
    return;
  }
  const legacyLead =
    data.leads.find((lead) => lead.projectNumber === number) ??
    data.leads.find(
      (lead) =>
        lead.email?.toLowerCase() === legacy.customerEmail?.toLowerCase() &&
        normaliseStreet(lead.address) === normaliseStreet(legacy.streetAddress),
    );
  const leadId = legacyLead ? crmLeadId.get(legacyLead.id) : undefined;
  if (!leadId) {
    say('Project', 'problem', subject, "its lead wasn't migrated, so there is nothing to convert");
    return;
  }

  // The system design from the project (the later, post-sale record).
  const panelId = await findHardware(tx, 'panel', legacy.panelModel);
  const inverterId = await findHardware(tx, 'inverter', legacy.inverterModel);
  const design = {
    systemSizeKw: legacy.systemSizeKw ? Number(legacy.systemSizeKw).toFixed(2) : null,
    panelId,
    panelCount: panelId ? (whole(legacy.noOfPanels) ?? null) : null,
    inverterId,
    inverterCount: inverterId ? (whole(legacy.noOfInverters) ?? null) : null,
  };
  await tx
    .insert(leadSystemRequirements)
    .values({ leadId, ...design })
    .onConflictDoUpdate({ target: leadSystemRequirements.leadId, set: design });
  if (legacy.panelModel && !panelId)
    say(
      'Project',
      'problem',
      subject,
      `panel ${legacy.panelModel} isn't in the hardware catalogue — left empty`,
    );
  if (legacy.inverterModel && !inverterId)
    say(
      'Project',
      'problem',
      subject,
      `inverter ${legacy.inverterModel} isn't in the hardware catalogue — left empty`,
    );
  if (legacy.saleDate) {
    await tx.update(leads).set({ saleDate: legacy.saleDate }).where(eq(leads.id, leadId));
  }

  let projectId: string;
  try {
    ({ id: projectId } = await tx.transaction((inner) =>
      convertLead(inner, actor, leadId, { projectNumber: number }),
    ));
  } catch (error) {
    say('Project', 'problem', subject, `couldn't be created: ${refusal(error)}`);
    return;
  }
  const soldAt = legacy.saleDate ? new Date(`${legacy.saleDate}T02:00:00Z`) : null; // midday Sydney
  await tx
    .update(projects)
    .set({ title: legacy.title ?? null, ...(soldAt ? { soldAt } : {}) })
    .where(eq(projects.id, projectId));
  say(
    'Project',
    'create',
    subject,
    `from the lead above, keeps number ${number}; ${legacy.title ?? ''}, sale date ${legacy.saleDate ?? '—'}`,
  );

  if (legacyLead?.panelModel && legacy.panelModel && legacyLead.panelModel !== legacy.panelModel) {
    say(
      'Project',
      'update',
      subject,
      `panel model differs: the lead says ${legacyLead.panelModel}, the project ${legacy.panelModel} — the project's is used`,
    );
  }

  const suspect = new Set(options.includeSuspect ? [] : SUSPECT.map((s) => s.key));
  const value = (key: keyof LegacyProject) => (suspect.has(key) ? undefined : legacy[key]);
  for (const item of SUSPECT) {
    if (!options.includeSuspect && legacy[item.key]) {
      say(
        'Left out',
        'leave out',
        `${item.key} = "${legacy[item.key] ?? ''}"`,
        `${item.why} (--include-suspect brings it in)`,
      );
    }
  }

  const stage = legacy.projectStage ?? legacy.status;
  const mapped = stage ? STAGE_MAP[stage] : undefined;
  const steps: [string, () => Promise<unknown>][] = [
    [
      `stage: "${stage ?? ''}" → "${mapped ?? ''}"`,
      () =>
        mapped
          ? api.projects.setStage({ id: projectId, stage: mapped })
          : Promise.reject(new Error(`unknown stage "${stage ?? ''}"`)),
    ],
    [
      'site: storeys, roof, phase, NMI, existing system',
      async () => {
        const [current] = await tx.select().from(projects).where(eq(projects.id, projectId));
        if (!current) throw new Error('project missing');
        return api.projects.updateSite({
          id: projectId,
          values: {
            title: legacy.title ?? null,
            streetAddress: current.streetAddress,
            suburb: current.suburb,
            state: AU_STATES.find((state) => state === current.state) ?? 'QLD',
            postcode: current.postcode ?? '',
            houseStorey: legacy.houseStorey ?? current.houseStorey,
            roofType: legacy.roofType ?? current.roofType,
            phase: legacy.phase ?? current.phase,
            existingSystemDetails: current.existingSystemDetails ?? legacy.salesTeamNotes ?? null,
            managerRenteeFirstName: current.managerRenteeFirstName,
            managerRenteeLastName: current.managerRenteeLastName,
            nmi: legacy.nmi ?? null,
            saleDate: legacy.saleDate ?? current.saleDate,
            notes: value('notes') ?? null,
          },
        });
      },
    ],
    [
      'pricing: prices, deposit, balance due',
      () =>
        api.projects.updatePricing({
          id: projectId,
          values: {
            systemPriceAud: legacy.systemPrice ?? null,
            sellingPriceAud: legacy.sellingPrice ?? null,
            contractValueAud: legacy.contractValueAud ?? null,
            depositAud: legacy.deposit ?? null,
            depositReceivedDate: legacy.depositReceivedDate ?? null,
            balanceDueDate: legacy.balancePayableDate ?? null,
            customerInvoiceNumber: value('customerInvoiceNumber') ?? null,
          },
        }),
    ],
    [
      'EB verification (6 checks, documents)',
      () =>
        api.projects.updateEbVerification({
          id: projectId,
          values: {
            customerNameMatch: legacy.q1CustomerNameMatch ?? null,
            addressMatch: legacy.q2AddressMatch ?? null,
            meterMatch: legacy.q3MeterMatch ?? null,
            meterPhase: legacy.q4MeterPhase ?? null,
            openSolarSystemMatch: legacy.q5OpenSolarSystemMatch ?? null,
            openSolarPricingMatch: legacy.q6OpenSolarPricingMatch ?? null,
            docsReceived: legacy.docsReceived ?? null,
            docsReceivedDate: legacy.docsReceivedDate ?? null,
          },
        }),
    ],
    [
      'grid application',
      () =>
        api.projects.updateGridApplication({
          id: projectId,
          values: {
            electricityDistributor: legacy.electricityDistributor ?? legacy.dnsp ?? null,
            applicationRef: legacy.gridAppRef ?? null,
            status: legacy.gridAppStatus ?? null,
            appliedDate: legacy.gridAppliedDate ?? null,
            approvalDate: legacy.gridApprovalDate ?? null,
            rejectedDate: legacy.gridRejectedDate ?? null,
            energyRetailer: legacy.energyRetailer ?? null,
            retailerRef: value('retailerRef') ?? null,
          },
        }),
    ],
    [
      'finance',
      () =>
        api.projects.updateFinance({
          id: projectId,
          values: {
            financeOption:
              legacy.isOnFinance === 'No'
                ? 'No (Cash / Direct Payment)'
                : (legacy.isOnFinance ?? null),
          },
        }),
    ],
    [
      'warehouse & stock',
      () =>
        api.projects.updateWarehouse({
          id: projectId,
          values: {
            warehouse: value('warehouse') ?? null,
            salesOrderNumber: legacy.salesOrderNo ?? null,
            stockStatus: legacy.stockStatus ?? null,
            stockUsedProject: legacy.stockUsedProject ?? null,
            invoiceNumber: value('warehouseInvoiceNumber') ?? null,
            invoiceDate: value('warehouseInvoiceDate') ?? null,
            invoiceAmountAud: value('warehouseInvoiceAmount') ?? null,
            invoiceStatus: value('warehouseInvoiceStatus') ?? null,
            invoicePaidDate: null,
          },
        }),
    ],
    [
      'installation',
      () =>
        api.projects.updateInstallation({
          id: projectId,
          values: {
            status: legacy.installationStatus ?? null,
            installerCompanyId: null,
            installerQuotedAud: null,
            bookingDate: legacy.installationDate ?? null,
            bookedByUserId: null,
            completedDate: /complete/i.test(legacy.installationStatus ?? '')
              ? (legacy.installationDate ?? null)
              : null,
            docsStatus: legacy.installationDocsStatus ?? null,
            docsReceivedDate: legacy.installationDocsReceivedDate ?? null,
            installerInvoiceNumber: value('installerInvoiceNumber') ?? null,
            installerInvoiceDate: value('installerInvoiceDate') ?? null,
            installerInvoiceAmountAud: value('installerInvoiceAmount') ?? null,
            installerInvoiceStatus: value('installerInvoiceStatus') ?? null,
          },
        }),
    ],
    [
      'STC claim',
      () =>
        api.projects.updateStcClaim({
          id: projectId,
          values: {
            portal: legacy.stcTradedPortal ?? null,
            jobNumber: legacy.stcJobNo ?? null,
            status: legacy.stcStatus ?? null,
            submittedDate: legacy.stcSubmittedDate ?? null,
            solarStcs: whole(legacy.solarStcs) ?? null,
            solarStcsAmountAud: legacy.solarStcsAmount ?? null,
            solarStcsReceivedDate: legacy.solarStcReceivedDate ?? null,
            batteryStcs: whole(legacy.batteryStcs) ?? null,
            batteryStcsAmountAud: legacy.batteryStcsAmount ?? null,
            batteryStcsReceivedDate: legacy.batteryStcReceivedDate ?? null,
            adminChargesAud: legacy.adminCharges ?? null,
            customerStcRateAud: legacy.customerStcRateAud ?? null,
            internalStcRateAud: legacy.internalStcRateAud ?? null,
          },
        }),
    ],
  ];
  for (const [what, step] of steps) {
    try {
      await step();
      say('Project', 'update', subject, what);
    } catch (error) {
      say('Project', 'problem', subject, `${what} — not saved: ${refusal(error)}`);
    }
  }
  if (legacy.isOnFinance === 'No' && (legacy.financeCompanyName || legacy.financeStatus)) {
    say(
      'Left out',
      'leave out',
      `finance company "${legacy.financeCompanyName ?? ''}" / "${legacy.financeStatus ?? ''}"`,
      'the job is marked cash, and a cash job carries no finance details',
    );
  }
}
