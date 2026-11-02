import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useAuth } from '../auth/auth-context.ts';
import { ApiStatus } from '../components/ApiStatus.tsx';
import { BrandMark } from '../components/BrandMark.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import { useTRPC } from '../lib/trpc.ts';
import { Button, Card, CardContent, Skeleton } from '../ui/index.ts';

/** Placeholder behind RequireAuth until the app shell (Step 1.3) and real dashboard (Step 2.9). */
export function DashboardPage() {
  const { state, signOut } = useAuth();
  const trpc = useTRPC();
  // A permission-checked procedure (option_lists:view) to prove the authenticated path end to end.
  const lists = useQuery(trpc.optionLists.list.queryOptions());

  if (state.status !== 'signedIn') return null;
  const { profile } = state;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-semibold tracking-tight">MMS CRM</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-fg-muted sm:inline">{profile.email}</span>
            <ThemeToggle />
            <Button size="sm" onClick={() => void signOut()}>
              <LogOut />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {profile.name}</h1>
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
      </main>
    </div>
  );
}
