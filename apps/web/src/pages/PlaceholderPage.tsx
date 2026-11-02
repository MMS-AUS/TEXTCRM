import type { Feature } from '@mms/shared';
import { Construction, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { canView } from '../app/nav.ts';
import { useProfile } from '../auth/auth-context.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import { Card, EmptyState } from '../ui/index.ts';

function NoAccess() {
  return (
    <EmptyState
      icon={<Lock />}
      title="No access"
      description="Your role can't view this area. Ask an admin if you need it."
    />
  );
}

/** Renders `children` only if the role can view one of `features` (the API checks too). */
export function FeatureGate({
  title,
  features,
  children,
}: {
  title: string;
  features: readonly Feature[];
  children: ReactNode;
}) {
  const { permissions } = useProfile();
  if (canView(permissions, features)) return children;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} />
      <Card>
        <NoAccess />
      </Card>
    </div>
  );
}

/** An empty page for a section that is built in a later step. */
export function PlaceholderPage({
  title,
  description,
  step,
  features,
}: {
  title: string;
  description: string;
  step: string;
  features: readonly Feature[];
}) {
  const { permissions } = useProfile();
  const allowed = canView(permissions, features);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      <Card>
        {allowed ? (
          <EmptyState
            icon={<Construction />}
            title={`${title} is on its way`}
            description={`This screen is built in ${step} of the plan.`}
          />
        ) : (
          <NoAccess />
        )}
      </Card>
    </div>
  );
}
