import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/auth-context.ts';
import { ApiStatus } from '../components/ApiStatus.tsx';
import { BrandMark } from '../components/BrandMark.tsx';
import { Button, Card, CardContent } from '../ui/index.ts';

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.5 10.5 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <Card className="w-full max-w-sm shadow-sm">
        <CardContent className="flex flex-col gap-6 px-7 py-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <BrandMark variant="square" size="lg" />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Sign in to MMS CRM</h1>
              <p className="mt-1 text-sm text-fg-muted">
                Use your Make My Solar Google Workspace account.
              </p>
            </div>
          </div>
          {message && (
            <p
              role="alert"
              className="flex gap-2 rounded-md bg-danger-subtle p-3 text-sm text-danger-text"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {message}
            </p>
          )}
          <Button size="lg" onClick={onSignIn} loading={pending} className="w-full">
            {!pending && <GoogleLogo />}
            {pending ? 'Waiting for Google…' : 'Sign in with Google'}
          </Button>
        </CardContent>
      </Card>
      <ApiStatus />
    </main>
  );
}
