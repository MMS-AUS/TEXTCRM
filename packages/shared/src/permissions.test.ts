import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, FEATURES, SYSTEM_ROLE_KEYS } from './permissions.ts';

describe('DEFAULT_ROLES', () => {
  it('defines every system role exactly once', () => {
    expect(DEFAULT_ROLES.map((r) => r.key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
  });

  it('gives admin full access to every feature', () => {
    const admin = DEFAULT_ROLES.find((r) => r.key === 'admin');
    for (const f of FEATURES) {
      expect(admin?.permissions[f]).toEqual({
        view: true,
        create: true,
        edit: true,
        delete: true,
        export: true,
      });
    }
  });

  it('keeps integration secrets admin-only', () => {
    for (const role of DEFAULT_ROLES.filter((r) => r.key !== 'admin')) {
      expect(role.permissions.integrations?.view ?? false).toBe(false);
    }
  });
});
