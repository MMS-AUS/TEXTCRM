import { useQuery } from '@tanstack/react-query';
import { useProfile } from '../auth/auth-context.ts';
import { ApiStatus } from '../components/ApiStatus.tsx';
import { MyTasks } from '../components/MyTasks.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { useTRPC } from '../lib/trpc.ts';
import { Card, CardContent, Skeleton } from '../ui/index.ts';

/** Placeholder until the real dashboard (Step 2.9). */
export function DashboardPage() {
  const profile = useProfile();
  const trpc = useTRPC();
  // A permission-checked procedure (option_lists:view) to prove the authenticated path end to end.
  const lists = useQuery(trpc.optionLists.list.queryOptions());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Welcome, ${profile.name}`}
        description="Your dashboard widgets arrive in Step 2.9."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent>
            <p className="text-sm text-fg-muted">Role</p>
            <div className="mt-1 text-lg font-semibold">{profile.role.name}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-fg-muted">Option lists</p>
            <div
              className="mt-1 text-lg font-semibold tabular-nums"
              data-testid="option-list-count"
            >
              {lists.isPending ? (
                <Skeleton className="mt-1.5 h-4 w-8" />
              ) : lists.isError ? (
                'unavailable'
              ) : (
                lists.data.length
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-fg-muted">Status</p>
            <div className="mt-1.5">
              <ApiStatus />
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="max-w-2xl">
        <MyTasks />
      </div>
    </div>
  );
}
