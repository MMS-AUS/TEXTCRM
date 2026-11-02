import type { ErrorComponentProps } from '@tanstack/react-router';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '../ui/index.ts';

/** Shown when a page crashes. Technical details only in development. */
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="grid size-11 place-items-center rounded-lg bg-danger-subtle text-danger-text">
        <TriangleAlert className="size-5" />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 max-w-sm text-sm text-fg-muted">
          This page hit an unexpected error. Try again; if it keeps happening, tell an admin what
          you were doing.
        </p>
        {import.meta.env.DEV && (
          <pre className="mt-4 max-w-xl overflow-x-auto rounded-md bg-surface-2 p-3 text-left font-mono text-xs text-danger-text">
            {error instanceof Error ? error.message : String(error)}
          </pre>
        )}
      </div>
      <Button onClick={reset}>
        <RotateCw />
        Try again
      </Button>
    </main>
  );
}
