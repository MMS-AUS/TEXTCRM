import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../lib/trpc.ts';
import { Badge } from '../ui/index.ts';

/** Calls the public health.ping procedure — `data.status` is typed straight from the API router. */
export function ApiStatus() {
  const trpc = useTRPC();
  const ping = useQuery(trpc.health.ping.queryOptions());
  const label = ping.isPending ? 'checking…' : ping.isError ? 'unreachable' : ping.data.status;
  const tone = ping.isPending ? 'neutral' : ping.isError ? 'danger' : 'success';
  return (
    <Badge tone={tone} dot data-testid="api-status">
      API: {label}
    </Badge>
  );
}
