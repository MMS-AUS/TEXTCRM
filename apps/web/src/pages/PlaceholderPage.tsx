import type { Feature } from '@mms/shared';
import { Construction, Lock } from 'lucide-react';
import { canView } from '../app/nav.ts';
import { useProfile } from '../auth/auth-context.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import { Card, EmptyState } from '../ui/index.ts';

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
          <EmptyState
            icon={<Lock />}
            title="No access"
            description="Your role can't view this area. Ask an admin if you need it."
          />
        )}
      </Card>
    </div>
  );
}
