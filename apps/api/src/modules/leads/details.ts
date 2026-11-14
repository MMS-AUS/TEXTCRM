import { TRPCError } from '@trpc/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  formatAud,
  formatDateLong,
  leadPricingSchema,
  leadSystemSchema,
  systemSizeKw,
} from '@mms/shared';
import type { Db, Tx } from '../../db/client.ts';
import {
  hardwareBatteries,
  hardwareInverters,
  hardwarePanels,
  leadPricing,
  leads,
  leadSystemInverters,
  leadSystemRequirements,
} from '../../db/schema/index.ts';
import { permissionProcedure } from '../../trpc/trpc.ts';
import { logSystemActivity } from '../activities/service.ts';
import { diff, recordAudit } from '../audit.ts';
import { checkInverterLines } from '../hardware/inverter-lines.ts';
import { assertHardware, hardwareOptions } from '../hardware/router.ts';
import { assertOption } from '../options.ts';

/** System requirements + pricing for the lead page, with catalog labels for chosen hardware. */
export async function loadLeadDetails(db: Db, leadId: string) {
  const [[system], [pricing], inverterRows] = await Promise.all([
    db.select().from(leadSystemRequirements).where(eq(leadSystemRequirements.leadId, leadId)),
    db.select().from(leadPricing).where(eq(leadPricing.leadId, leadId)),
    db
      .select()
      .from(leadSystemInverters)
      .where(eq(leadSystemInverters.leadId, leadId))
      .orderBy(asc(leadSystemInverters.position), asc(leadSystemInverters.createdAt)),
  ]);
  const label = async (kind: 'panel' | 'inverter' | 'battery', id: string | null | undefined) => {
    if (!id) return null;
    const table = {
      panel: hardwarePanels,
      inverter: hardwareInverters,
      battery: hardwareBatteries,
    }[kind];
    const [option] = await hardwareOptions(db, kind, eq(table.id, id), 1);
    return option ?? null;
  };
  const [panel, battery, inverters] = await Promise.all([
    label('panel', system?.panelId),
    label('battery', system?.batteryId),
    Promise.all(
      inverterRows.map(async (row) => ({
        inverterId: row.inverterId,
        count: row.count,
        type: row.type as 'grid' | 'hybrid',
        inverter: await label('inverter', row.inverterId),
      })),
    ),
  ]);
  return {
    system: system
      ? {
          systemSizeKw: system.systemSizeKw,
          batteryRequired: system.batteryRequired,
          propertyType: system.propertyType,
          roofType: system.roofType,
          houseStorey: system.houseStorey,
          phase: system.phase,
          existingSystemDetails: system.existingSystemDetails,
          quarterlyBillAud: system.quarterlyBillAud,
          panelId: system.panelId,
          panelCount: system.panelCount,
          batteryId: system.batteryId,
          batteryCount: system.batteryCount,
          inverters,
          panel,
          battery,
        }
      : null,
    pricing: pricing
      ? {
          systemPriceAud: pricing.systemPriceAud,
          sellingPriceAud: pricing.sellingPriceAud,
          depositAud: pricing.depositAud,
          depositReceivedDate: pricing.depositReceivedDate,
        }
      : null,
  };
}

async function editableLead(tx: Tx, id: string) {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, id));
  if (!lead) throw new TRPCError({ code: 'NOT_FOUND', message: 'This lead does not exist.' });
  if (lead.deletedAt) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This lead is deleted. Restore it before making changes.',
    });
  }
  return lead;
}

/** Marks the lead as edited in the CRM (§1.8: the sheet sync no longer overwrites it). */
async function touchLead(tx: Tx, id: string, userId: string) {
  await tx
    .update(leads)
    .set({ crmEditedAt: new Date(), updatedByUserId: userId })
    .where(eq(leads.id, id));
}

export const leadDetailProcedures = {
  updateSystem: permissionProcedure('leads', 'edit')
    .input(z.object({ id: z.uuid(), values: leadSystemSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await editableLead(tx, input.id);
        const [existing] = await tx
          .select()
          .from(leadSystemRequirements)
          .where(eq(leadSystemRequirements.leadId, input.id));
        const { inverters, ...systemValues } = input.values;
        const values = { ...systemValues };
        await assertOption(tx, 'roofTypes', values.roofType, 'roof type', existing?.roofType);
        await assertOption(tx, 'houseStoreys', values.houseStorey, 'storey', existing?.houseStorey);
        await assertOption(tx, 'phases', values.phase, 'phase', existing?.phase);
        await assertHardware(tx, 'panel', values.panelId, existing?.panelId);
        await assertHardware(tx, 'battery', values.batteryId, existing?.batteryId);
        if (values.batteryId) values.batteryRequired = true;

        // Inverters: each must be a catalog model (an archived one is fine if it is already here).
        const currentRows = await tx
          .select()
          .from(leadSystemInverters)
          .where(eq(leadSystemInverters.leadId, input.id))
          .orderBy(asc(leadSystemInverters.position), asc(leadSystemInverters.createdAt));
        // The system size is the inverters' total capacity whenever there are inverters.
        const capacity = await checkInverterLines(
          tx,
          inverters,
          new Set(currentRows.map((row) => row.inverterId)),
        );
        if (capacity) values.systemSizeKw = capacity;

        // No size given but panels chosen: work it out from the panel wattage.
        if (!values.systemSizeKw && values.panelId && values.panelCount) {
          const [panel] = await tx
            .select({ sizeW: hardwarePanels.sizeW })
            .from(hardwarePanels)
            .where(eq(hardwarePanels.id, values.panelId));
          if (panel) values.systemSizeKw = systemSizeKw(values.panelCount, panel.sizeW);
        }

        const invertersBefore = currentRows.map((row) => ({
          inverterId: row.inverterId,
          count: row.count,
          type: row.type,
        }));
        const changes = diff(
          { ...(existing ?? {}), inverters: invertersBefore },
          { ...values, inverters },
        );
        if (!changes) return { id: input.id };
        await tx
          .insert(leadSystemRequirements)
          .values({ leadId: input.id, ...values })
          .onConflictDoUpdate({ target: leadSystemRequirements.leadId, set: values });
        await tx.delete(leadSystemInverters).where(eq(leadSystemInverters.leadId, input.id));
        if (inverters.length > 0) {
          await tx.insert(leadSystemInverters).values(
            inverters.map((row, position) => ({
              leadId: input.id,
              position,
              inverterId: row.inverterId,
              count: row.count,
              type: row.type,
            })),
          );
        }
        await touchLead(tx, input.id, ctx.user.id);
        await recordAudit(
          tx,
          { userId: ctx.user.id, meta: ctx.meta },
          { action: 'update_system', entityType: 'lead', entityId: input.id, ...changes },
        );
        return { id: input.id };
      }),
    ),

  updatePricing: permissionProcedure('leads', 'edit')
    .input(z.object({ id: z.uuid(), values: leadPricingSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await editableLead(tx, input.id);
        const [existing] = await tx
          .select()
          .from(leadPricing)
          .where(eq(leadPricing.leadId, input.id));
        const values = input.values;
        const changes = diff(existing ?? {}, values);
        if (!changes) return { id: input.id };
        await tx
          .insert(leadPricing)
          .values({ leadId: input.id, ...values })
          .onConflictDoUpdate({ target: leadPricing.leadId, set: values });
        await touchLead(tx, input.id, ctx.user.id);
        if (values.depositReceivedDate && !existing?.depositReceivedDate) {
          await logSystemActivity(tx, {
            entityType: 'lead',
            entityId: input.id,
            authorUserId: ctx.user.id,
            subject: `Deposit of ${formatAud(values.depositAud)} received on ${formatDateLong(values.depositReceivedDate)}`,
            metadata: { depositAud: values.depositAud, date: values.depositReceivedDate },
          });
        }
        await recordAudit(
          tx,
          { userId: ctx.user.id, meta: ctx.meta },
          { action: 'update_pricing', entityType: 'lead', entityId: input.id, ...changes },
        );
        return { id: input.id };
      }),
    ),
};
