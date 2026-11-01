import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { auditLog, roles, users } from '../db/schema/index.ts';

export const upsertUserInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1),
  roleKey: z.string().trim().min(1),
});

export type UpsertUserInput = z.input<typeof upsertUserInputSchema>;

/**
 * Adds a person to the allowlist, or re-activates and updates them if they already exist.
 * Used by the `user:create` CLI to create the first admin (until the admin UI in Step 2.10).
 */
export async function upsertUser(
  db: Db,
  rawInput: UpsertUserInput,
  allowedEmailDomain: string,
): Promise<{ id: string; created: boolean }> {
  const input = upsertUserInputSchema.parse(rawInput);
  if (!input.email.endsWith(`@${allowedEmailDomain}`)) {
    throw new Error(`Only @${allowedEmailDomain} accounts can be added.`);
  }

  return db.transaction(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.key, input.roleKey));
    if (!role) {
      throw new Error(`Role "${input.roleKey}" does not exist. Run \`npm run db:seed\` first.`);
    }

    const [existing] = await tx.select().from(users).where(eq(users.email, input.email));
    const values = { name: input.name, roleId: role.id, isActive: true, deactivatedAt: null };

    let id: string;
    if (existing) {
      await tx.update(users).set(values).where(eq(users.id, existing.id));
      id = existing.id;
    } else {
      const [created] = await tx
        .insert(users)
        .values({ ...values, email: input.email })
        .returning({ id: users.id });
      if (!created) throw new Error('Insert returned no row');
      id = created.id;
    }

    await tx.insert(auditLog).values({
      actorType: 'system',
      action: existing ? 'update' : 'create',
      entityType: 'user',
      entityId: id,
      changes: {
        ...(existing
          ? {
              before: {
                name: existing.name,
                roleId: existing.roleId,
                isActive: existing.isActive,
              },
            }
          : {}),
        after: { email: input.email, name: input.name, roleId: role.id, isActive: true },
      },
    });

    return { id, created: !existing };
  });
}
