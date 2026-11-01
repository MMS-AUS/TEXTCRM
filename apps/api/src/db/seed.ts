import { readFile } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { DEFAULT_ROLES, FEATURES, type FeaturePermissions } from '@mms/shared';
import { requireDatabaseUrl } from '../env.ts';
import { createDb, type Db, type Tx } from './client.ts';
import {
  hardwareBatteries,
  hardwareInverters,
  hardwarePanels,
  optionLists,
  options,
  rolePermissions,
  roles,
} from './schema/index.ts';
import { buildHardware, buildOptionLists, type OptionListSeed } from './seed-data.ts';

/**
 * Idempotent reference-data seed: roles + default permissions, option lists, hardware catalog.
 * Only inserts what is missing — never overwrites rows an admin has since edited, so running it
 * twice leaves the same row counts.
 */

interface Count {
  inserted: number;
  total: number;
}

export interface SeedSummary {
  roles: Count;
  rolePermissions: Count;
  optionLists: (Count & { key: string })[];
  hardware: { panels: Count; inverters: Count; batteries: Count };
}

export interface SeedInput {
  dropdowns: unknown;
  hardware: unknown;
}

const CHUNK_SIZE = 500;
const NO_ACCESS: FeaturePermissions = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  export: false,
};

export async function seed(db: Db, input: SeedInput): Promise<SeedSummary> {
  // Validate both files before touching the database.
  const lists = buildOptionLists(input.dropdowns);
  const hardware = buildHardware(input.hardware);

  return db.transaction(async (tx) => {
    const roleCounts = await seedRoles(tx);
    const listCounts = await seedOptionLists(tx, lists);

    const panels = await inChunks(hardware.panels, async (chunk) =>
      tx
        .insert(hardwarePanels)
        .values(chunk.map((r) => ({ ...r, source: 'legacy-seed' })))
        .onConflictDoNothing({ target: [hardwarePanels.manufacturer, hardwarePanels.model] })
        .returning({ id: hardwarePanels.id }),
    );
    const inverters = await inChunks(hardware.inverters, async (chunk) =>
      tx
        .insert(hardwareInverters)
        .values(chunk.map((r) => ({ ...r, source: 'legacy-seed' })))
        .onConflictDoNothing({ target: [hardwareInverters.manufacturer, hardwareInverters.model] })
        .returning({ id: hardwareInverters.id }),
    );
    const batteries = await inChunks(hardware.batteries, async (chunk) =>
      tx
        .insert(hardwareBatteries)
        .values(chunk.map((r) => ({ ...r, source: 'legacy-seed' })))
        .onConflictDoNothing({ target: [hardwareBatteries.manufacturer, hardwareBatteries.model] })
        .returning({ id: hardwareBatteries.id }),
    );

    return {
      ...roleCounts,
      optionLists: listCounts,
      hardware: {
        panels: { inserted: panels, total: await tx.$count(hardwarePanels) },
        inverters: { inserted: inverters, total: await tx.$count(hardwareInverters) },
        batteries: { inserted: batteries, total: await tx.$count(hardwareBatteries) },
      },
    };
  });
}

async function inChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown[]>) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    inserted += (await insert(rows.slice(i, i + CHUNK_SIZE))).length;
  }
  return inserted;
}

async function seedRoles(tx: Tx): Promise<Pick<SeedSummary, 'roles' | 'rolePermissions'>> {
  const insertedRoles = await tx
    .insert(roles)
    .values(
      DEFAULT_ROLES.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: true,
      })),
    )
    .onConflictDoNothing({ target: roles.key })
    .returning({ id: roles.id });

  const roleRows = await tx
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(
      inArray(
        roles.key,
        DEFAULT_ROLES.map((r) => r.key),
      ),
    );
  const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]));

  const permissionRows = DEFAULT_ROLES.flatMap((role) => {
    const roleId = roleIdByKey.get(role.key);
    if (!roleId) throw new Error(`Role ${role.key} missing after insert`);
    return FEATURES.map((feature) => {
      const p = role.permissions[feature] ?? NO_ACCESS;
      return {
        roleId,
        feature,
        canView: p.view,
        canCreate: p.create,
        canEdit: p.edit,
        canDelete: p.delete,
        canExport: p.export,
      };
    });
  });

  const insertedPermissions = await tx
    .insert(rolePermissions)
    .values(permissionRows)
    .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.feature] })
    .returning({ roleId: rolePermissions.roleId });

  return {
    roles: { inserted: insertedRoles.length, total: await tx.$count(roles) },
    rolePermissions: {
      inserted: insertedPermissions.length,
      total: await tx.$count(rolePermissions),
    },
  };
}

async function seedOptionLists(tx: Tx, lists: OptionListSeed[]) {
  const counts: SeedSummary['optionLists'] = [];
  for (const list of lists) {
    await tx
      .insert(optionLists)
      .values({ key: list.key, name: list.name })
      .onConflictDoNothing({ target: optionLists.key });
    const [row] = await tx
      .select({ id: optionLists.id })
      .from(optionLists)
      .where(eq(optionLists.key, list.key));
    if (!row) throw new Error(`Option list ${list.key} missing after insert`);

    const inserted =
      list.options.length === 0
        ? []
        : await tx
            .insert(options)
            .values(list.options.map((o) => ({ ...o, listId: row.id })))
            .onConflictDoNothing({ target: [options.listId, options.value] })
            .returning({ id: options.id });

    counts.push({
      key: list.key,
      inserted: inserted.length,
      total: await tx.$count(options, eq(options.listId, row.id)),
    });
  }
  return counts;
}

async function readLegacyJson(fileName: string): Promise<unknown> {
  const url = new URL(`../../../../legacy-reference/${fileName}`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8')) as unknown;
}

export async function loadLegacySeedInput(): Promise<SeedInput> {
  return {
    dropdowns: await readLegacyJson('dropdown_lists.json'),
    hardware: await readLegacyJson('hardware_catalog.json'),
  };
}

function printSummary(s: SeedSummary) {
  const line = (label: string, c: Count) => {
    console.log(`  ${label.padEnd(36)} ${String(c.total).padStart(5)} rows  (+${c.inserted} new)`);
  };

  console.log('\nRoles');
  line('roles', s.roles);
  line('role_permissions', s.rolePermissions);
  console.log(`\nOption lists (${s.optionLists.length})`);
  for (const l of s.optionLists) line(l.key, l);
  console.log('\nHardware catalog');
  line('hardware_panels', s.hardware.panels);
  line('hardware_inverters', s.hardware.inverters);
  line('hardware_batteries', s.hardware.batteries);
}

if (import.meta.main) {
  const db = createDb(requireDatabaseUrl('DATABASE_URL'));
  try {
    const summary = await seed(db, await loadLegacySeedInput());
    printSummary(summary);
    console.log('\nSeed complete.');
  } finally {
    await db.$client.end();
  }
}
