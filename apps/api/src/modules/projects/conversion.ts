import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import {
  businessToday,
  formatAud,
  LEAD_CONVERTED,
  LEAD_LOST,
  normaliseName,
  normaliseStreet,
} from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import {
  contactAddresses,
  contacts,
  leadPricing,
  leads,
  leadSystemRequirements,
  projectPricing,
  projects,
  projectSystemDesign,
  users,
} from '../../db/schema/index.ts';
import { logSystemActivity } from '../activities/service.ts';
import { recordAudit, type Actor } from '../audit.ts';
import { findMatchingContact } from '../contacts/match.ts';
import { loadLeadDetails } from '../leads/details.ts';

// Lead → Project conversion (§1.4, Step 2.5). One server transaction:
//  1. ensure a contact exists (the lead's, one matching by email/mobile, or a new one);
//  2. create the project with customer & site, system design and pricing copied from the lead;
//  3. link lead ↔ project, set the lead to "Converted to Project", log activity on both.
// Converting twice is impossible: checked here, and projects.lead_id is UNIQUE in the database.

type Lead = typeof leads.$inferSelect;

function fullName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

/** Why this lead can't be converted yet — empty when it can. */
function conversionProblems(lead: Lead, existingProjectNumber: string | null): string[] {
  const problems: string[] = [];
  if (existingProjectNumber)
    problems.push(`Already converted to project ${existingProjectNumber}.`);
  if (lead.deletedAt) problems.push('The lead is deleted. Restore it first.');
  if (lead.status === LEAD_LOST)
    problems.push('The lead is marked Lost. Move it back into the pipeline first.');
  if (!lead.streetAddress || !lead.suburb || !lead.state || !lead.postcode) {
    problems.push(
      'Add the full property address (street, suburb, state and postcode) — the job needs a site.',
    );
  }
  return problems;
}

async function existingProject(db: Db | Tx, leadId: string) {
  const [project] = await db
    .select({ id: projects.id, projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.leadId, leadId));
  return project ?? null;
}

async function linkedContact(db: Db | Tx, lead: Lead) {
  if (lead.contactId) {
    const [contact] = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        archivedAt: contacts.archivedAt,
      })
      .from(contacts)
      .where(eq(contacts.id, lead.contactId));
    if (contact && !contact.archivedAt) return contact;
  }
  return findMatchingContact(db, { email: lead.email, mobile: lead.mobile });
}

function projectTitle(systemSizeKw: string | null, battery: boolean): string {
  const solar = systemSizeKw ? `${String(Number(systemSizeKw))} kW solar` : 'Solar';
  return battery ? `${solar} + battery` : solar;
}

/** Next number of the form MMS-2026-0001, unique per year. Serialised with an advisory lock. */
async function nextProjectNumber(tx: Tx): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('project_number'))`);
  const prefix = `MMS-${businessToday().slice(0, 4)}-`;
  const [row] = await tx
    .select({
      // The ::int cast on the position matters: an untyped parameter makes Postgres pick the
      // regex form of substring(), which returns null and would restart numbering at 1.
      highest: sql<number>`coalesce(max(substring(${projects.projectNumber} from ${prefix.length + 1}::int)::int), 0)`,
    })
    .from(projects)
    .where(sql`${projects.projectNumber} ~ ${`^${prefix}[0-9]+$`}`);
  return `${prefix}${String((row?.highest ?? 0) + 1).padStart(4, '0')}`;
}

/** What "Convert to project" will do — shown in the confirmation dialog. */
export async function previewConversion(db: Db, leadId: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw new TRPCError({ code: 'NOT_FOUND', message: 'This lead does not exist.' });
  const [project, contact, details, [sales]] = await Promise.all([
    existingProject(db, leadId),
    linkedContact(db, lead),
    loadLeadDetails(db, leadId),
    lead.ownerUserId
      ? db.select({ name: users.name }).from(users).where(eq(users.id, lead.ownerUserId))
      : Promise.resolve([]),
  ]);
  const system = details.system;
  return {
    problems: conversionProblems(lead, project?.projectNumber ?? null),
    contact: contact
      ? { mode: 'existing' as const, id: contact.id, name: fullName(contact) }
      : { mode: 'new' as const, id: null, name: fullName(lead) },
    project: {
      title: projectTitle(
        system?.systemSizeKw ?? null,
        Boolean(system?.batteryId ?? system?.batteryRequired),
      ),
      address: [lead.streetAddress, lead.suburb, lead.state, lead.postcode]
        .filter(Boolean)
        .join(', '),
      stage: 'Engineering & DNSP Approval',
      salesPerson: sales?.name ?? null,
      system: [
        system?.panel && `${String(system.panelCount ?? '')} × ${system.panel.label}`,
        system?.inverter && `${String(system.inverterCount ?? '')} × ${system.inverter.label}`,
        system?.battery && `${String(system.batteryCount ?? '')} × ${system.battery.label}`,
      ].filter((line): line is string => Boolean(line)),
      systemSizeKw: system?.systemSizeKw ?? null,
      sellingPriceAud: details.pricing?.sellingPriceAud ?? null,
      depositAud: details.pricing?.depositAud ?? null,
    },
  };
}

export async function convertLead(
  tx: Tx,
  actor: Actor,
  leadId: string,
): Promise<{ id: string; projectNumber: string }> {
  // Lock the lead row so two people pressing Convert at once queue up.
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for('update');
  if (!lead) throw new TRPCError({ code: 'NOT_FOUND', message: 'This lead does not exist.' });
  const already = await existingProject(tx, leadId);
  const problems = conversionProblems(lead, already?.projectNumber ?? null);
  if (problems.length > 0) {
    throw new TRPCError({
      code: already ? 'CONFLICT' : 'BAD_REQUEST',
      message: problems.join(' '),
    });
  }
  // conversionProblems guarantees the address; this narrows the types.
  const site = {
    streetAddress: lead.streetAddress ?? '',
    suburb: lead.suburb ?? '',
    state: lead.state ?? '',
    postcode: lead.postcode,
  };

  const [system] = await tx
    .select()
    .from(leadSystemRequirements)
    .where(eq(leadSystemRequirements.leadId, leadId));
  const [pricing] = await tx.select().from(leadPricing).where(eq(leadPricing.leadId, leadId));

  // 1. The contact.
  let contact = await linkedContact(tx, lead);
  let contactCreated = false;
  if (!contact) {
    const [created] = await tx
      .insert(contacts)
      .values({
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        mobile: lead.mobile,
        secondaryMobile: lead.secondaryMobile,
        type: 'Residential',
        companyId: lead.companyId,
        ownerUserId: lead.ownerUserId,
        source: 'Lead conversion',
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      })
      .returning({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName });
    if (!created) throw new Error('Insert returned no row');
    contact = created;
    contactCreated = true;
    await recordAudit(tx, actor, {
      action: 'create',
      entityType: 'contact',
      entityId: created.id,
      after: { source: 'Lead conversion', leadId },
    });
  }

  // The property becomes one of the contact's addresses (primary if it's their first).
  const addresses = await tx
    .select()
    .from(contactAddresses)
    .where(eq(contactAddresses.contactId, contact.id));
  const known = addresses.some(
    (address) =>
      normaliseStreet(address.streetAddress) === normaliseStreet(site.streetAddress) &&
      normaliseName(address.suburb) === normaliseName(site.suburb),
  );
  if (!known) {
    await tx.insert(contactAddresses).values({
      contactId: contact.id,
      ...site,
      area: lead.area,
      nearestBigCity: lead.nearestBigCity,
      addressVerified: lead.addressVerified,
      propertyType: system?.propertyType ?? null,
      isPrimary: addresses.length === 0,
    });
  }

  // 2. The project.
  const projectNumber = await nextProjectNumber(tx);
  const battery = Boolean(system?.batteryId ?? system?.batteryRequired);
  const [project] = await tx
    .insert(projects)
    .values({
      projectNumber,
      title: projectTitle(system?.systemSizeKw ?? null, battery),
      leadId,
      contactId: contact.id,
      companyId: lead.companyId,
      salesUserId: lead.ownerUserId,
      saleDate: lead.saleDate ?? businessToday(),
      ...site,
      area: lead.area,
      nearestBigCity: lead.nearestBigCity,
      houseStorey: system?.houseStorey ?? null,
      roofType: system?.roofType ?? null,
      phase: system?.phase ?? null,
      existingSystemDetails: system?.existingSystemDetails ?? null,
      managerRenteeFirstName: lead.managerRenteeFirstName,
      managerRenteeLastName: lead.managerRenteeLastName,
      notes: lead.notes,
      metaLeadgenId: lead.metaLeadgenId,
      fbclid: lead.fbclid,
      fbp: lead.fbp,
      soldAt: new Date(),
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId,
    })
    .returning({ id: projects.id });
  if (!project) throw new Error('Insert returned no row');

  if (system) {
    await tx.insert(projectSystemDesign).values({
      projectId: project.id,
      systemSizeKw: system.systemSizeKw,
      panelId: system.panelId,
      panelCount: system.panelCount,
      inverterId: system.inverterId,
      inverterCount: system.inverterCount,
      batteryId: system.batteryId,
      batteryCount: system.batteryCount,
    });
  }
  if (pricing) {
    await tx.insert(projectPricing).values({
      projectId: project.id,
      systemPriceAud: pricing.systemPriceAud,
      sellingPriceAud: pricing.sellingPriceAud,
      depositAud: pricing.depositAud,
      depositReceivedDate: pricing.depositReceivedDate,
    });
  }

  // 3. Link and log on both sides.
  await tx
    .update(leads)
    .set({
      status: LEAD_CONVERTED,
      convertedAt: new Date(),
      contactId: contact.id,
      crmEditedAt: new Date(),
      updatedByUserId: actor.userId,
    })
    .where(eq(leads.id, leadId));

  const contactName = fullName(contact);
  await logSystemActivity(tx, {
    entityType: 'lead',
    entityId: leadId,
    authorUserId: actor.userId,
    subject: `Converted to project ${projectNumber}`,
    metadata: { projectId: project.id, projectNumber, from: lead.status, to: LEAD_CONVERTED },
  });
  await logSystemActivity(tx, {
    entityType: 'project',
    entityId: project.id,
    authorUserId: actor.userId,
    subject: `Project created from ${contactName}'s lead${pricing?.sellingPriceAud ? ` (${formatAud(pricing.sellingPriceAud)})` : ''}`,
    metadata: { leadId, contactCreated },
  });
  await recordAudit(tx, actor, {
    action: 'convert_to_project',
    entityType: 'lead',
    entityId: leadId,
    before: { status: lead.status },
    after: { status: LEAD_CONVERTED, projectId: project.id, projectNumber },
  });
  await recordAudit(tx, actor, {
    action: 'create',
    entityType: 'project',
    entityId: project.id,
    after: { projectNumber, leadId, contactId: contact.id, contactCreated },
  });
  return { id: project.id, projectNumber };
}
