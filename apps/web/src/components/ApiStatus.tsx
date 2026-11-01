import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../lib/trpc.ts';

/** Calls the public health.ping procedure — `data.status` is typed straight from the API router. */
export function ApiStatus() {
  const trpc = useTRPC();
  const ping = useQuery(trpc.health.ping.queryOptions());
  const label = ping.isPending ? 'checking…' : ping.isError ? 'unreachable' : ping.data.status;
  return (
    <p className="text-xs text-slate-500" data-testid="api-status">
      API: {label}
    </p>
  );
}
