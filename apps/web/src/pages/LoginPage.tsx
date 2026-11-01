import { useState } from 'react';
import { useAuth } from '../auth/auth-context.ts';
import { ApiStatus } from '../components/ApiStatus.tsx';

// Minimal styling until the design system (Phase 1).
export function LoginPage() {
  const { state, signInWithGoogle } = useAuth();
  const [pending, setPending] = useState(false);
  const message = state.status === 'signedOut' ? state.message : undefined;

  const onSignIn = () => {
    setPending(true);
    void signInWithGoogle().finally(() => {
      setPending(false);
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">MMS CRM</h1>
        <p className="mt-1 text-sm text-slate-600">
          Sign in with your Make My Solar Google Workspace account.
        </p>
        {message && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {message}
          </p>
        )}
        <button
          type="button"
          onClick={onSignIn}
          disabled={pending}
          className="mt-6 w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {pending ? 'Waiting for Google…' : 'Sign in with Google'}
        </button>
        <div className="mt-6">
          <ApiStatus />
        </div>
      </div>
    </main>
  );
}
