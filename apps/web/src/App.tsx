import { useEffect, useState } from 'react';
import { healthResponseSchema } from '@mms/shared';

type ApiState = 'checking' | 'ok' | 'unreachable';

// Placeholder until the app shell (Step 1.3). Shows whether the API is reachable.
export function App() {
  const [api, setApi] = useState<ApiState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((res) => res.json())
      .then((body: unknown) => {
        healthResponseSchema.parse(body);
        setApi('ok');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('API health check failed', error);
        setApi('unreachable');
      });
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-6 text-slate-900">
      <h1 className="text-3xl font-semibold tracking-tight">MMS CRM</h1>
      <p className="text-slate-600">Make My Solar — scaffold placeholder</p>
      <p className="text-sm" data-testid="api-status">
        API: {api === 'checking' ? 'checking…' : api === 'ok' ? 'ok' : 'unreachable'}
      </p>
    </main>
  );
}
