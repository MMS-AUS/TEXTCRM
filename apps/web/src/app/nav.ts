import { hasPermission, type Feature, type PermissionMatrix } from '@mms/shared';
import {
  FolderKanban,
  LayoutDashboard,
  LifeBuoy,
  Settings,
  UserRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  to: '/dashboard' | '/leads' | '/contacts' | '/projects' | '/tickets' | '/settings';
  label: string;
  icon: LucideIcon;
  /** Shown when the role can view any of these features (the API enforces it as well). */
  features: readonly Feature[];
};

/** Settings appears for anyone who can view at least one admin area. */
export const SETTINGS_FEATURES: readonly Feature[] = [
  'users',
  'roles',
  'option_lists',
  'hardware',
  'integrations',
  'audit_log',
];

export const MAIN_NAV: readonly NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, features: ['dashboard'] },
  { to: '/leads', label: 'Leads', icon: Zap, features: ['leads'] },
  { to: '/contacts', label: 'Contacts', icon: UserRound, features: ['contacts'] },
  { to: '/projects', label: 'Projects', icon: FolderKanban, features: ['projects'] },
  { to: '/tickets', label: 'Tickets', icon: LifeBuoy, features: ['tickets'] },
];

export const SETTINGS_NAV: NavItem = {
  to: '/settings',
  label: 'Settings',
  icon: Settings,
  features: SETTINGS_FEATURES,
};

export function canView(permissions: PermissionMatrix, features: readonly Feature[]): boolean {
  return features.some((feature) => hasPermission(permissions, feature, 'view'));
}

export function visibleNav(permissions: PermissionMatrix) {
  return {
    main: MAIN_NAV.filter((item) => canView(permissions, item.features)),
    settings: canView(permissions, SETTINGS_NAV.features) ? SETTINGS_NAV : null,
  };
}
