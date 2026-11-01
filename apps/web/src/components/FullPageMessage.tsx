import type { ReactNode } from 'react';

export function FullPageMessage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-sm text-slate-600">
      {children}
    </main>
  );
}
