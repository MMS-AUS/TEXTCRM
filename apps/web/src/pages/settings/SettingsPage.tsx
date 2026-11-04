import { Link } from '@tanstack/react-router';
import {
  Building2,
  ChevronRight,
  Cog,
  Cpu,
  FileSpreadsheet,
  ListChecks,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { PageHeader } from '../../components/PageHeader.tsx';
import { useCan } from '../../lib/hooks.ts';
import { Card, EmptyState } from '../../ui/index.ts';

type Section = {
  to:
    | '/settings/users'
    | '/settings/roles'
    | '/settings/option-lists'
    | '/settings/hardware'
    | '/settings/company'
    | '/settings/imports'
    | '/settings/sheet-sync'
    | '/settings/jobs'
    | '/settings/integrations';
  title: string;
  description: string;
  icon: ReactNode;
  visible: boolean;
};

/** Settings home: one card per area the role can open. */
export function SettingsPage() {
  const can = useCan();
  const canWrite = (feature: 'leads' | 'contacts' | 'hardware') =>
    can(feature, 'create') && can(feature, 'edit');
  const groups: { title: string; sections: Section[] }[] = [
    {
      title: 'Team',
      sections: [
        {
          to: '/settings/users',
          title: 'Users',
          description: 'Invite staff, set their role, and deactivate people who leave.',
          icon: <Users />,
          visible: can('users', 'view'),
        },
        {
          to: '/settings/roles',
          title: 'Roles & permissions',
          description: 'What each role can view, create, edit, delete and export.',
          icon: <ShieldCheck />,
          visible: can('roles', 'view'),
        },
      ],
    },
    {
      title: 'Business',
      sections: [
        {
          to: '/settings/company',
          title: 'Company profile',
          description: 'Legal name, ABN, licences and contact details.',
          icon: <Building2 />,
          visible: can('users', 'view'),
        },
        {
          to: '/settings/option-lists',
          title: 'Option lists',
          description: 'The choices in every dropdown: add, reword, reorder or archive.',
          icon: <ListChecks />,
          visible: can('option_lists', 'view'),
        },
        {
          to: '/settings/hardware',
          title: 'Hardware catalogue',
          description: 'Panels, inverters and batteries offered in system designs.',
          icon: <Cpu />,
          visible: can('hardware', 'view'),
        },
      ],
    },
    {
      title: 'Data',
      sections: [
        {
          to: '/settings/imports',
          title: 'Import',
          description: 'Leads, contacts or catalogue items from a CSV, Excel file or Google Sheet.',
          icon: <Upload />,
          visible: canWrite('leads') || canWrite('contacts') || canWrite('hardware'),
        },
        {
          to: '/settings/integrations',
          title: 'Integrations',
          description: 'Gmail, Xero and MessageMedia SMS: connect, test, disconnect.',
          icon: <PlugZap />,
          visible: true,
        },
        {
          to: '/settings/sheet-sync',
          title: 'Live sheet sync',
          description: 'New rows in your lead sheets become leads every few minutes.',
          icon: <RefreshCw />,
          visible: can('integrations', 'view'),
        },
        {
          to: '/settings/jobs',
          title: 'Background jobs',
          description: 'Imports, syncs and scheduled tasks — and anything that failed.',
          icon: <Cog />,
          visible: can('integrations', 'view'),
        },
      ],
    },
  ];
  const visible = groups
    .map((group) => ({ ...group, sections: group.sections.filter((s) => s.visible) }))
    .filter((group) => group.sections.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />
      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileSpreadsheet />}
            title="Nothing here for your role"
            description="Ask an admin if you need access to settings."
          />
        </Card>
      ) : (
        visible.map((group) => (
          <section key={group.title} aria-label={group.title} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-fg-muted">{group.title}</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.sections.map((section) => (
                <Link
                  key={section.to}
                  to={section.to}
                  className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs transition-shadow hover:shadow-sm"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent-text [&_svg]:size-4.5">
                    {section.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 font-medium">
                      {section.title}
                      <ChevronRight className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                    </span>
                    <span className="mt-0.5 block text-sm text-fg-muted">
                      {section.description}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

export function SettingsBackLink() {
  return (
    <Link
      to="/settings"
      className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
    >
      <ChevronRight className="size-4 rotate-180" />
      Settings
    </Link>
  );
}
