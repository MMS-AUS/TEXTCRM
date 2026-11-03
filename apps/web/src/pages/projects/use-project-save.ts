import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../lib/errors.ts';
import { useTRPC } from '../../lib/trpc.ts';
import { toast } from '../../ui/index.ts';

/** Save → refresh the project and its timeline → toast, or keep the API's error for the dialog. */
export function useProjectSave(message: string, onDone: () => void) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await Promise.all([
        queryClient.invalidateQueries(trpc.projects.pathFilter()),
        queryClient.invalidateQueries(trpc.activities.pathFilter()),
      ]);
      toast({ title: message, tone: 'success' });
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };
  return { error, run };
}
