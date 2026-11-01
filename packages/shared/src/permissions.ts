/**
 * Permission model (§1.2): per-feature toggles view/create/edit/delete/export.
 * The database stores the matrix per role (role_permissions); these defaults seed it
 * and are reviewed with the team in Step 0.7.
 */

export const FEATURES = [
  'dashboard',
  'leads',
  'contacts',
  'companies',
  'projects',
  'tickets',
  'files',
  'reports',
  'users',
  'roles',
  'option_lists',
  'hardware',
  'integrations',
  'audit_log',
] as const;

export type Feature = (typeof FEATURES)[number];

export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete', 'export'] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type FeaturePermissions = Record<PermissionAction, boolean>;

export const SYSTEM_ROLE_KEYS = ['admin', 'manager', 'sales', 'operations', 'service'] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export interface RoleDefinition {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: Partial<Record<Feature, FeaturePermissions>>;
}

const ALL: FeaturePermissions = {
  view: true,
  create: true,
  edit: true,
  delete: true,
  export: true,
};
const READ: FeaturePermissions = {
  view: true,
  create: false,
  edit: false,
  delete: false,
  export: false,
};
const WRITE: FeaturePermissions = {
  view: true,
  create: true,
  edit: true,
  delete: false,
  export: false,
};
const WRITE_EXPORT: FeaturePermissions = { ...WRITE, export: true };

function grant(features: readonly Feature[], perms: FeaturePermissions) {
  return Object.fromEntries(features.map((f) => [f, perms])) as Partial<
    Record<Feature, FeaturePermissions>
  >;
}

export const DEFAULT_ROLES: readonly RoleDefinition[] = [
  {
    key: 'admin',
    name: 'Admin',
    description: 'Everything, incl. users/roles, settings, integrations, deletes, exports',
    permissions: grant(FEATURES, ALL),
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'All CRM data, reassign, reports, approve; no integration secrets',
    permissions: {
      ...grant(
        ['dashboard', 'leads', 'contacts', 'companies', 'projects', 'tickets', 'files', 'reports'],
        ALL,
      ),
      ...grant(['users', 'roles', 'option_lists', 'hardware', 'audit_log'], READ),
    },
  },
  {
    key: 'sales',
    name: 'Sales',
    description: 'Own + team leads, contacts, convert to project, communications',
    permissions: {
      ...grant(['leads', 'contacts', 'companies', 'files'], WRITE),
      ...grant(['dashboard', 'projects', 'option_lists', 'hardware'], READ),
    },
  },
  {
    key: 'operations',
    name: 'Operations',
    description: 'Projects (all stages), installers, warehouse, STC, finance fields',
    permissions: {
      ...grant(['projects'], WRITE_EXPORT),
      ...grant(['contacts', 'companies', 'files'], WRITE),
      ...grant(['dashboard', 'leads', 'tickets', 'option_lists', 'hardware'], READ),
    },
  },
  {
    key: 'service',
    name: 'Service',
    description: 'Tickets, warranty claims, read-only projects/contacts',
    permissions: {
      ...grant(['tickets', 'files'], WRITE),
      ...grant(
        ['dashboard', 'projects', 'contacts', 'companies', 'option_lists', 'hardware'],
        READ,
      ),
    },
  },
];
