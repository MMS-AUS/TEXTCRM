import { TRPCError } from '@trpc/server';
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  companyProfileSchema,
  FEATURES,
  hardwareListInputSchema,
  hardwareSaveSchema,
  inviteUserSchema,
  normaliseMatrix,
  optionLabelSchema,
  optionProtection,
  permissionMatrixSchema,
  roleInputSchema,
  updateUserSchema,
  type HardwareCatalogKind,
  type PermissionMatrix,
} from '@mms/shared';
import { toPermissionMatrix } from '../../auth/users-repo.ts';
import type { Db, Tx } from '../../db/client.ts';
import {
  companyProfile,
  hardwareBatteries,
  hardwareInverters,
  hardwarePanels,
  optionLists,
  options,
  rolePermissions,
  roles,
  users,
} from '../../db/schema/index.ts';
import { permissionProcedure, protectedProcedure, router } from '../../trpc/trpc.ts';
import { diff, recordAudit, type Actor } from '../audit.ts';
import { containsPattern } from '../search.ts';
import { reassignOpenLeads, reassignPreview, reassignTarget } from './reassign.ts';

// Settings → admin (Step 2.10). Guards that keep the CRM usable: there is always at least one
// active admin, nobody can lock themselves out, the Admin role always has every permission,
// and option values the app's rules depend on can't be archived.

type Ctx = { user: { id: string }; meta: Actor['meta'] };
const actorOf = (ctx: Ctx): Actor => ({ userId: ctx.user.id, meta: ctx.meta });
const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });
const conflict = (message: string) => new TRPCError({ code: 'CONFLICT', message });
const notFound = (what: string) =>
  new TRPCError({ code: 'NOT_FOUND', message: `This ${what} no longer exists.` });

const ADMIN_ROLE = 'admin';

async function activeAdmins(db: Db | Tx, excludeUserId?: string) {
  const [row] = await db
    .select({ count: count() })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(
      and(
        eq(roles.key, ADMIN_ROLE),
        eq(users.isActive, true),
        excludeUserId ? ne(users.id, excludeUserId) : undefined,
      ),
    );
  return row?.count ?? 0;
}

async function loadRole(db: Db | Tx, id: string) {
  const [role] = await db.select().from(roles).where(eq(roles.id, id));
  if (!role) throw notFound('role');
  return role;
}

async function loadUser(db: Db | Tx, id: string) {
  const [row] = await db
    .select({ user: users, roleKey: roles.key })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, id));
  if (!row) throw notFound('user');
  return row;
}

// ── Users ────────────────────────────────────────────────────────────────

const managers = alias(users, 'managers');

const usersRouter = router({
  list: permissionProcedure('users', 'view').query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        phone: users.phone,
        department: users.department,
        managerUserId: users.managerUserId,
        managerName: managers.name,
        roleId: users.roleId,
        roleName: roles.name,
        roleKey: roles.key,
        isActive: users.isActive,
        hasSignedIn: sql<boolean>`${users.firebaseUid} is not null`,
        lastSignInAt: users.lastSignInAt,
        deactivatedAt: users.deactivatedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .leftJoin(managers, eq(managers.id, users.managerUserId))
      .orderBy(desc(users.isActive), asc(users.name));
    return rows.map((row) => ({
      ...row,
      lastSignInAt: row.lastSignInAt?.toISOString() ?? null,
      deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      isYou: row.id === ctx.user.id,
    }));
  }),

  /** "Invite" = add to the sign-in allowlist with a role. They sign in with Google. */
  invite: permissionProcedure('users', 'create')
    .input(inviteUserSchema)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const domain = ctx.allowedEmailDomain;
        if (!input.email.endsWith(`@${domain}`)) {
          throw bad(`Only @${domain} Google Workspace accounts can be added.`);
        }
        await loadRole(tx, input.roleId);
        const [existing] = await tx.select().from(users).where(eq(users.email, input.email));
        if (existing) {
          throw conflict(
            existing.isActive
              ? `${existing.name} already has access.`
              : `${existing.name} was deactivated. Reactivate them instead.`,
          );
        }
        const [created] = await tx
          .insert(users)
          .values({ email: input.email, name: input.name, roleId: input.roleId })
          .returning({ id: users.id });
        if (!created) throw new Error('Insert returned no row');
        await recordAudit(tx, actorOf(ctx), {
          action: 'invite',
          entityType: 'user',
          entityId: created.id,
          after: input,
        });
        return { id: created.id };
      }),
    ),

  update: permissionProcedure('users', 'edit')
    .input(z.object({ id: z.uuid(), values: updateUserSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const { user, roleKey } = await loadUser(tx, input.id);
        const role = await loadRole(tx, input.values.roleId);
        if (role.id !== user.roleId) {
          if (user.id === ctx.user.id) {
            throw bad("You can't change your own role — ask another admin.");
          }
          if (roleKey === ADMIN_ROLE && user.isActive && (await activeAdmins(tx, user.id)) === 0) {
            throw bad(`${user.name} is the only active admin. Make someone else an admin first.`);
          }
        }
        const { managerUserId, ...rest } = input.values;
        const values = managerUserId === undefined ? rest : { ...rest, managerUserId };
        if (managerUserId && managerUserId !== user.managerUserId) {
          if (managerUserId === user.id) throw bad('Someone can’t be their own manager.');
          const [manager] = await tx
            .select({ isActive: users.isActive })
            .from(users)
            .where(eq(users.id, managerUserId));
          if (!manager?.isActive) throw bad('Choose an active user as the manager.');
        }
        const changes = diff(user, values);
        if (!changes) return { id: user.id };
        await tx.update(users).set(values).where(eq(users.id, user.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'update',
          entityType: 'user',
          entityId: user.id,
          ...changes,
        });
        return { id: user.id };
      }),
    ),

  /** Before deactivating: how many open leads will move, and to whom. */
  deactivationPreview: permissionProcedure('users', 'view')
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const { user } = await loadUser(ctx.db, input.id);
      return reassignPreview(ctx.db, user);
    }),

  /**
   * Offboarding: a deactivated user can't sign in or use an open session (checked on every
   * request); their Firebase sessions are also revoked when the service account is set up.
   * Their open leads move to their manager (or the primary admin) in the same transaction —
   * if that fails, they stay active. Their records and history stay.
   */
  setActive: permissionProcedure('users', 'edit')
    .input(z.object({ id: z.uuid(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.transaction(async (tx) => {
        const { user, roleKey } = await loadUser(tx, input.id);
        if (user.isActive === input.active) {
          return { user, changed: false, reassigned: { count: 0, to: null as string | null } };
        }
        if (!input.active) {
          if (user.id === ctx.user.id) throw bad("You can't deactivate yourself.");
          if (roleKey === ADMIN_ROLE && (await activeAdmins(tx, user.id)) === 0) {
            throw bad(`${user.name} is the only active admin. Make someone else an admin first.`);
          }
        }
        await tx
          .update(users)
          .set({ isActive: input.active, deactivatedAt: input.active ? null : new Date() })
          .where(eq(users.id, user.id));
        let reassigned: { count: number; to: string | null } = { count: 0, to: null };
        if (!input.active) {
          const target = await reassignTarget(tx, user);
          if (target) {
            const moved = await reassignOpenLeads(tx, actorOf(ctx), user, target);
            reassigned = { count: moved, to: moved ? target.name : null };
          } else if ((await reassignPreview(tx, user)).openLeads > 0) {
            throw bad(`Nobody can take over ${user.name}’s open leads. Add another active admin.`);
          }
        }
        await recordAudit(tx, actorOf(ctx), {
          action: input.active ? 'reactivate' : 'deactivate',
          entityType: 'user',
          entityId: user.id,
          before: { isActive: user.isActive },
          after: { isActive: input.active },
        });
        return { user, changed: true, reassigned };
      });
      let sessionsRevoked = false;
      if (result.changed && !input.active && result.user.firebaseUid && ctx.sessions) {
        try {
          await ctx.sessions.revoke(result.user.firebaseUid);
          sessionsRevoked = true;
        } catch (error) {
          // The deactivation stands either way; the next request is refused regardless.
          ctx.log.warn(
            { err: error, userId: result.user.id },
            'Could not revoke Firebase sessions',
          );
        }
      }
      return { id: input.id, sessionsRevoked, reassigned: result.reassigned };
    }),

  roleOptions: permissionProcedure('users', 'view').query(({ ctx }) =>
    ctx.db
      .select({ id: roles.id, name: roles.name, key: roles.key })
      .from(roles)
      .orderBy(asc(roles.name)),
  ),
});

// ── Roles & permissions ──────────────────────────────────────────────────

async function roleMatrix(db: Db | Tx, roleId: string): Promise<PermissionMatrix> {
  const rows = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  return toPermissionMatrix(rows);
}

async function writeMatrix(tx: Tx, roleId: string, matrix: PermissionMatrix) {
  for (const feature of FEATURES) {
    const p = matrix[feature];
    const values = {
      canView: p.view,
      canCreate: p.create,
      canEdit: p.edit,
      canDelete: p.delete,
      canExport: p.export,
    };
    await tx
      .insert(rolePermissions)
      .values({ roleId, feature, ...values })
      .onConflictDoUpdate({
        target: [rolePermissions.roleId, rolePermissions.feature],
        set: values,
      });
  }
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'role';

const rolesRouter = router({
  list: permissionProcedure('roles', 'view').query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        role: roles,
        users: sql<number>`(select count(*)::int from users u where u.role_id = ${roles.id} and u.is_active)`,
      })
      .from(roles)
      .orderBy(desc(roles.isSystem), asc(roles.name));
    return Promise.all(
      rows.map(async ({ role, users: activeUsers }) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        locked: role.key === ADMIN_ROLE,
        activeUsers,
        permissions: await roleMatrix(ctx.db, role.id),
      })),
    );
  }),

  create: permissionProcedure('roles', 'create')
    .input(roleInputSchema.extend({ copyFromRoleId: z.uuid().optional() }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const [clash] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(sql`lower(${roles.name}) = lower(${input.name})`);
        if (clash) throw conflict(`There is already a role called "${input.name}".`);
        let key = slug(input.name);
        for (
          let n = 2;
          (await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key))).length;
          n++
        ) {
          key = `${slug(input.name)}-${String(n)}`;
        }
        const [created] = await tx
          .insert(roles)
          .values({ key, name: input.name, description: input.description, isSystem: false })
          .returning({ id: roles.id });
        if (!created) throw new Error('Insert returned no row');
        const start = input.copyFromRoleId
          ? await roleMatrix(tx, (await loadRole(tx, input.copyFromRoleId)).id)
          : toPermissionMatrix([]);
        await writeMatrix(tx, created.id, start);
        await recordAudit(tx, actorOf(ctx), {
          action: 'create',
          entityType: 'role',
          entityId: created.id,
          after: { ...input, key },
        });
        return { id: created.id };
      }),
    ),

  update: permissionProcedure('roles', 'edit')
    .input(z.object({ id: z.uuid(), values: roleInputSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const role = await loadRole(tx, input.id);
        if (role.isSystem && role.name !== input.values.name) {
          throw bad('Built-in roles keep their names. You can change the description.');
        }
        const changes = diff(role, input.values);
        if (!changes) return { id: role.id };
        await tx.update(roles).set(input.values).where(eq(roles.id, role.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'update',
          entityType: 'role',
          entityId: role.id,
          ...changes,
        });
        return { id: role.id };
      }),
    ),

  /** Saves a role's whole matrix. View is switched on wherever another action is. */
  setPermissions: permissionProcedure('roles', 'edit')
    .input(z.object({ id: z.uuid(), permissions: permissionMatrixSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const role = await loadRole(tx, input.id);
        if (role.key === ADMIN_ROLE) {
          throw bad('The Admin role always has every permission, so nobody gets locked out.');
        }
        const before = await roleMatrix(tx, role.id);
        const after = normaliseMatrix(input.permissions);
        await writeMatrix(tx, role.id, after);
        const changes = diff(before, after);
        if (changes) {
          await recordAudit(tx, actorOf(ctx), {
            action: 'update_permissions',
            entityType: 'role',
            entityId: role.id,
            ...changes,
          });
        }
        return { id: role.id, permissions: after };
      }),
    ),

  remove: permissionProcedure('roles', 'delete')
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const role = await loadRole(tx, input.id);
        if (role.isSystem) throw bad('Built-in roles can’t be deleted.');
        const [assigned] = await tx
          .select({ count: count() })
          .from(users)
          .where(eq(users.roleId, role.id));
        if (assigned && assigned.count > 0) {
          throw bad(
            `${String(assigned.count)} ${assigned.count === 1 ? 'person has' : 'people have'} this role. Give them another role first.`,
          );
        }
        await tx.delete(roles).where(eq(roles.id, role.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'delete',
          entityType: 'role',
          entityId: role.id,
          before: { name: role.name },
        });
        return { id: role.id };
      }),
    ),
});

// ── Option lists ─────────────────────────────────────────────────────────

async function loadOption(db: Db | Tx, id: string) {
  const [row] = await db
    .select({ option: options, listKey: optionLists.key })
    .from(options)
    .innerJoin(optionLists, eq(optionLists.id, options.listId))
    .where(eq(options.id, id));
  if (!row) throw notFound('option');
  return row;
}

const optionListsAdminRouter = router({
  /** Every option of one list, archived ones too, in display order. */
  items: permissionProcedure('option_lists', 'view')
    .input(z.object({ key: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const [list] = await ctx.db.select().from(optionLists).where(eq(optionLists.key, input.key));
      if (!list) throw notFound('list');
      const rows = await ctx.db
        .select()
        .from(options)
        .where(eq(options.listId, list.id))
        .orderBy(asc(options.sortOrder), asc(options.label));
      return {
        key: list.key,
        name: list.name,
        description: list.description,
        fixed: optionProtection(list.key, '') === 'fixed-list',
        options: rows.map((row) => ({
          id: row.id,
          value: row.value,
          label: row.label,
          archived: row.archivedAt !== null,
          protection: optionProtection(list.key, row.value),
        })),
      };
    }),

  add: permissionProcedure('option_lists', 'create')
    .input(optionLabelSchema.extend({ key: z.string().min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const [list] = await tx.select().from(optionLists).where(eq(optionLists.key, input.key));
        if (!list) throw notFound('list');
        if (optionProtection(list.key, '') === 'fixed-list') {
          throw bad(`${list.name} is built into the app — its options can be reworded, not added.`);
        }
        const [clash] = await tx
          .select({ label: options.label, archivedAt: options.archivedAt })
          .from(options)
          .where(
            and(
              eq(options.listId, list.id),
              or(
                sql`lower(${options.value}) = lower(${input.label})`,
                sql`lower(${options.label}) = lower(${input.label})`,
              ),
            ),
          );
        if (clash) {
          throw conflict(
            clash.archivedAt
              ? `"${clash.label}" is already in the list (archived). Restore it instead.`
              : `"${clash.label}" is already in the list.`,
          );
        }
        const [last] = await tx
          .select({ max: sql<number>`coalesce(max(${options.sortOrder}), 0)::int` })
          .from(options)
          .where(eq(options.listId, list.id));
        const [created] = await tx
          .insert(options)
          .values({
            listId: list.id,
            value: input.label,
            label: input.label,
            sortOrder: (last?.max ?? 0) + 1,
          })
          .returning({ id: options.id });
        if (!created) throw new Error('Insert returned no row');
        await recordAudit(tx, actorOf(ctx), {
          action: 'add_option',
          entityType: 'option_list',
          entityId: list.key,
          after: { label: input.label },
        });
        return { id: created.id };
      }),
    ),

  /** Rewords what people see. The stored value stays, so old records keep matching. */
  rename: permissionProcedure('option_lists', 'edit')
    .input(optionLabelSchema.extend({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const { option, listKey } = await loadOption(tx, input.id);
        if (option.label === input.label) return { id: option.id };
        const [clash] = await tx
          .select({ id: options.id })
          .from(options)
          .where(
            and(
              eq(options.listId, option.listId),
              ne(options.id, option.id),
              sql`lower(${options.label}) = lower(${input.label})`,
            ),
          );
        if (clash) throw conflict(`"${input.label}" is already in the list.`);
        await tx.update(options).set({ label: input.label }).where(eq(options.id, option.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'rename_option',
          entityType: 'option_list',
          entityId: listKey,
          before: { label: option.label },
          after: { label: input.label, value: option.value },
        });
        return { id: option.id };
      }),
    ),

  move: permissionProcedure('option_lists', 'edit')
    .input(z.object({ id: z.uuid(), direction: z.enum(['up', 'down']) }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const { option } = await loadOption(tx, input.id);
        const siblings = await tx
          .select({ id: options.id })
          .from(options)
          .where(eq(options.listId, option.listId))
          .orderBy(asc(options.sortOrder), asc(options.label));
        const index = siblings.findIndex((s) => s.id === option.id);
        const target = input.direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= siblings.length) return { id: option.id };
        const order = siblings.map((s) => s.id);
        [order[index], order[target]] = [order[target] ?? '', order[index] ?? ''];
        // Renumber the whole list so ties from older data can't make a move a no-op.
        for (const [position, id] of order.entries()) {
          await tx
            .update(options)
            .set({ sortOrder: position + 1 })
            .where(eq(options.id, id));
        }
        return { id: option.id };
      }),
    ),

  /** Archived options leave the pickers; records that use them keep showing them. */
  setArchived: permissionProcedure('option_lists', 'edit')
    .input(z.object({ id: z.uuid(), archived: z.boolean() }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const { option, listKey } = await loadOption(tx, input.id);
        if (input.archived) {
          const protection = optionProtection(listKey, option.value);
          if (protection === 'fixed-list')
            throw bad('This list is built into the app — its options can’t be archived.');
          if (protection === 'protected')
            throw bad(
              `"${option.label}" is used by the app's rules, so it can't be archived. You can reword it.`,
            );
        }
        if ((option.archivedAt !== null) === input.archived) return { id: option.id };
        await tx
          .update(options)
          .set({ archivedAt: input.archived ? new Date() : null })
          .where(eq(options.id, option.id));
        await recordAudit(tx, actorOf(ctx), {
          action: input.archived ? 'archive_option' : 'restore_option',
          entityType: 'option_list',
          entityId: listKey,
          after: { value: option.value },
        });
        return { id: option.id };
      }),
    ),
});

// ── Hardware catalogue ───────────────────────────────────────────────────

const HARDWARE_TABLES = {
  panel: hardwarePanels,
  inverter: hardwareInverters,
  battery: hardwareBatteries,
} as const;

function sizeOf(kind: HardwareCatalogKind, row: Record<string, unknown>) {
  if (kind === 'panel') return { value: row.sizeW as string, unit: 'W' };
  if (kind === 'inverter') return { value: row.sizeKw as string, unit: 'kW' };
  return { value: row.usableCapacityKwh as string, unit: 'kWh' };
}

const hardwareCatalogRouter = router({
  list: permissionProcedure('hardware', 'view')
    .input(hardwareListInputSchema)
    .query(async ({ ctx, input }) => {
      const table = HARDWARE_TABLES[input.kind];
      const pattern = containsPattern(input.search);
      const where = and(
        input.archived ? isNotNull(table.archivedAt) : isNull(table.archivedAt),
        input.search
          ? or(
              ilike(table.manufacturer, pattern),
              ilike(table.model, pattern),
              ilike(table.series, pattern),
            )
          : undefined,
      );
      const [rows, [total]] = await Promise.all([
        ctx.db
          .select()
          .from(table)
          .where(where)
          .orderBy(asc(table.manufacturer), asc(table.model))
          .limit(input.pageSize)
          .offset(input.page * input.pageSize),
        ctx.db.select({ count: count() }).from(table).where(where),
      ]);
      return {
        total: total?.count ?? 0,
        rows: rows.map((row) => {
          const size = sizeOf(input.kind, row);
          return {
            id: row.id,
            manufacturer: row.manufacturer,
            model: row.model,
            series: row.series,
            size: size.value,
            unit: size.unit,
            sizeLabel: 'sizeLabel' in row ? row.sizeLabel : null,
            source: row.source,
            archived: row.archivedAt !== null,
          };
        }),
      };
    }),

  save: protectedProcedure.input(hardwareSaveSchema).mutation(({ ctx, input }) => {
    const action = input.id ? 'edit' : 'create';
    if (!ctx.user.permissions.hardware[action]) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Your role does not allow this action.' });
    }
    return ctx.db.transaction(async (tx) => {
      const table = HARDWARE_TABLES[input.kind];
      const { manufacturer, model } = input.values;
      const [clash] = await tx
        .select({ id: table.id })
        .from(table)
        .where(
          and(
            sql`lower(${table.manufacturer}) = lower(${manufacturer})`,
            sql`lower(${table.model}) = lower(${model})`,
            input.id ? ne(table.id, input.id) : undefined,
          ),
        );
      if (clash) throw conflict(`${manufacturer} ${model} is already in the catalogue.`);
      if (input.id) {
        const [existing] = await tx.select().from(table).where(eq(table.id, input.id));
        if (!existing) throw notFound('catalogue item');
        const changes = diff(existing, input.values);
        if (!changes) return { id: existing.id };
        await tx.update(table).set(input.values).where(eq(table.id, existing.id));
        await recordAudit(tx, actorOf(ctx), {
          action: 'update',
          entityType: `hardware_${input.kind}`,
          entityId: existing.id,
          ...changes,
        });
        return { id: existing.id };
      }
      // A discriminated union keeps kind and values in step; Drizzle needs the table's type.
      const [created] = await tx
        .insert(table)
        .values({ ...(input.values as typeof hardwarePanels.$inferInsert), source: 'manual' })
        .returning({ id: table.id });
      if (!created) throw new Error('Insert returned no row');
      await recordAudit(tx, actorOf(ctx), {
        action: 'create',
        entityType: `hardware_${input.kind}`,
        entityId: created.id,
        after: input.values,
      });
      return { id: created.id };
    });
  }),

  /** Catalogue items are never deleted (projects reference them) — they are archived. */
  setArchived: permissionProcedure('hardware', 'edit')
    .input(
      z.object({
        kind: z.enum(['panel', 'inverter', 'battery']),
        id: z.uuid(),
        archived: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const table = HARDWARE_TABLES[input.kind];
      const [updated] = await ctx.db
        .update(table)
        .set({ archivedAt: input.archived ? new Date() : null })
        .where(eq(table.id, input.id))
        .returning({ id: table.id });
      if (!updated) throw notFound('catalogue item');
      await recordAudit(ctx.db, actorOf(ctx), {
        action: input.archived ? 'archive' : 'restore',
        entityType: `hardware_${input.kind}`,
        entityId: input.id,
      });
      return { id: input.id };
    }),
});

// ── Company profile ──────────────────────────────────────────────────────

const companyRouter = router({
  /** Anyone signed in may read the business's own details (used on documents later). */
  get: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db.select().from(companyProfile);
    return row
      ? { ...row, updatedAt: row.updatedAt.toISOString(), createdAt: row.createdAt.toISOString() }
      : null;
  }),

  save: permissionProcedure('users', 'edit')
    .input(companyProfileSchema)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(companyProfile);
        const changes = diff(existing ?? {}, input);
        if (!changes) return { saved: false };
        await tx
          .insert(companyProfile)
          .values({ id: true, ...input, updatedByUserId: ctx.user.id })
          .onConflictDoUpdate({
            target: companyProfile.id,
            set: { ...input, updatedByUserId: ctx.user.id },
          });
        await recordAudit(tx, actorOf(ctx), {
          action: 'update',
          entityType: 'company_profile',
          entityId: 'company',
          ...changes,
        });
        return { saved: true };
      }),
    ),
});

export const adminRouter = router({
  users: usersRouter,
  roles: rolesRouter,
  optionLists: optionListsAdminRouter,
  hardware: hardwareCatalogRouter,
  company: companyRouter,
});
