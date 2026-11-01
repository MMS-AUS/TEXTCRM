import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context.ts';
import { ApiStatus } from '../components/ApiStatus.tsx';
import { useTRPC } from '../lib/trpc.ts';

/** Placeholder behind RequireAuth until the real dashboard (Step 2.9). */
export function DashboardPage() {
  const { state, signOut } = useAuth();
  const trpc = useTRPC();
  // A permission-checked procedure (option_lists:view) to prove the authenticated path end to end.
  const lists = useQuery(trpc.optionLists.list.queryOptions());

  if (state.status !== 'signedIn') return null;
  const { profile } = state;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <span className="font-semibold tracking-tight">MMS CRM</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-slate-600 sm:inline">{profile.email}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {profile.name}</h1>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-xs text-slate-500">Role</dt>
            <dd className="mt-1 font-medium">{profile.role.name}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-xs text-slate-500">Option lists</dt>
            <dd className="mt-1 font-medium" data-testid="option-list-count">
              {lists.isPending ? '…' : lists.isError ? 'unavailable' : lists.data.length}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-xs text-slate-500">Status</dt>
            <dd className="mt-1">
              <ApiStatus />
            </dd>
          </div>
        </dl>
      </main>
    </div>
  );
}
