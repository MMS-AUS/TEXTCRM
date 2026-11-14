import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURES, SYSTEM_ROLE_KEYS } from '@mms/shared';
import { createTestDb, truncateAll } from '../test/db.ts';
import { optionLists, options, rolePermissions, roles } from './schema/index.ts';
import { loadLegacySeedInput, seed, type SeedInput } from './seed.ts';

describe('seed', () => {
  const db = createTestDb();
  let input: SeedInput;

  beforeAll(async () => {
    await truncateAll(db);
    input = await loadLegacySeedInput();
  });
  afterAll(() => db.$client.end());

  it('loads everything on the first run', async () => {
    const s = await seed(db, input);
    expect(s.roles).toEqual({ inserted: SYSTEM_ROLE_KEYS.length, total: SYSTEM_ROLE_KEYS.length });
    expect(s.rolePermissions.total).toBe(SYSTEM_ROLE_KEYS.length * FEATURES.length);
    expect(s.optionLists).toHaveLength(49); // the old platforms list is folded into leadSources
    expect(s.hardware.panels).toEqual({ inserted: 791, total: 791 });
    expect(s.hardware.inverters).toEqual({ inserted: 854, total: 854 });
    expect(s.hardware.batteries).toEqual({ inserted: 427, total: 427 });
  });

  it('is idempotent: a second run inserts nothing and leaves the same counts', async () => {
    const before = await countAll();
    const s = await seed(db, input);
    expect(s.roles.inserted + s.rolePermissions.inserted).toBe(0);
    expect(s.optionLists.every((l) => l.inserted === 0)).toBe(true);
    expect(Object.values(s.hardware).every((h) => h.inserted === 0)).toBe(true);
    expect(await countAll()).toEqual(before);
  });

  it('does not overwrite an option an admin has renamed', async () => {
    const [list] = await db.select().from(optionLists).where(eq(optionLists.key, 'phases'));
    if (!list) throw new Error('phases list missing');
    const singlePhase = and(eq(options.listId, list.id), eq(options.value, 'Single Phase'));
    await db.update(options).set({ label: 'Single phase (1Φ)' }).where(singlePhase);

    await seed(db, input);

    const [opt] = await db.select().from(options).where(singlePhase);
    expect(opt?.label).toBe('Single phase (1Φ)');
  });

  it('skips the lists that become user references or derived values', async () => {
    const keys = (await db.select({ key: optionLists.key }).from(optionLists)).map((r) => r.key);
    expect(keys).not.toContain('salesPersons');
    expect(keys).not.toContain('panelBrands');
    expect(keys).toContain('leadStatuses');
  });

  it('gives admin every permission', async () => {
    const [admin] = await db.select().from(roles).where(eq(roles.key, 'admin'));
    if (!admin) throw new Error('admin role missing');
    const perms = await db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, admin.id));
    expect(perms).toHaveLength(FEATURES.length);
    expect(
      perms.every((p) => p.canView && p.canCreate && p.canEdit && p.canDelete && p.canExport),
    ).toBe(true);
  });

  async function countAll() {
    return {
      roles: await db.$count(roles),
      rolePermissions: await db.$count(rolePermissions),
      optionLists: await db.$count(optionLists),
      options: await db.$count(options),
    };
  }
});
