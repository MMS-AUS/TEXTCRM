import { Link } from '@tanstack/react-router';
import { ChevronRight, Cog, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageHeader } from '../../components/PageHeader.tsx';
import { useCan } from '../../lib/hooks.ts';
import { Alert, Card, EmptyState } from '../../ui/index.ts';

type Section = {
  to: '/settings/jobs' | '/settings/imports' | '/settings/sheet-sync';
  title: string;
  description: string;
  icon: ReactNode;
  visible: boolean;
};

/** Settings home: one card per area the role can open. */
export function SettingsPage() {
  const can = useCan();
  const canImport = (feature: 'leads' | 'contacts') =>
    can(feature, 'create') && can(feature, 'edit');
  const sections: Section[] = [
    {
      to: '/settings/imports',
      title: 'Import',
      description: 'Bring leads or contacts in from a CSV, Excel file or Google Sheet.',
      icon: <Upload />,
      visible: canImport('leads') || canImport('contacts'),
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
  ];
  const visible = sections.filter((section) => section.visible);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />
      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileSpreadsheet />}
            title="Nothing here for your role"
            description="Ask an admin if you need access to imports or integrations."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((section) => (
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
                <span className="mt-0.5 block text-sm text-fg-muted">{section.description}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
      <Alert tone="info" title="More settings coming">
        Users, roles, option lists and the hardware catalogue are managed here from Step 2.10.
      </Alert>
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
