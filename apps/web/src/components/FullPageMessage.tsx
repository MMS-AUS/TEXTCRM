import type { ReactNode } from 'react';
import { Spinner } from '../ui/index.ts';

export function FullPageMessage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center gap-2 p-4 text-sm text-fg-muted">
      <Spinner />
      {children}
    </main>
  );
}
