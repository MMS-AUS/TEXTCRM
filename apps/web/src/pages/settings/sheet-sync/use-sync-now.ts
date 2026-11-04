import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../../lib/errors.ts';
import { useTRPC } from '../../../lib/trpc.ts';
import { toast } from '../../../ui/index.ts';

/** "Sync now": queues a run of one sheet and refreshes the history. */
export function useSyncNow() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const syncNow = useMutation(trpc.sheetSync.syncNow.mutationOptions());
  return {
    pendingId: syncNow.isPending ? syncNow.variables.id : null,
    run: (id: string) => {
      syncNow
        .mutateAsync({ id })
        .then(() => {
          toast({
            title: 'Sync queued',
            description: 'It runs within a few seconds — the history updates by itself.',
            tone: 'success',
          });
          return queryClient.invalidateQueries(trpc.sheetSync.pathFilter());
        })
        .catch((error: unknown) => {
          toast({
            title: "Couldn't start the sync",
            description: errorMessage(error),
            tone: 'danger',
          });
        });
    },
  };
}
