import { TriangleAlert } from 'lucide-react';
import { Card, CardContent } from '../ui/index.ts';

/** Shown instead of the app when the Firebase web config in .env is missing. */
export function ConfigErrorPage({ missing }: { missing: string[] }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-3 py-6">
          <div className="flex items-center gap-2 text-danger-text">
            <TriangleAlert className="size-5" />
            <h1 className="text-lg font-semibold">Configuration missing</h1>
          </div>
          <p className="text-sm text-fg-muted">
            Add these to the <code className="font-mono">.env</code> file in the repo root, then
            restart <code className="font-mono">npm run dev</code>:
          </p>
          <ul className="list-inside list-disc rounded-md bg-surface-2 p-3 font-mono text-sm text-fg">
            {missing.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
