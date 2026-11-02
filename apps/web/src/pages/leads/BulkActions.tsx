import { LEAD_CONVERTED } from '@mms/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { useCan, useOptions, useUsers } from '../../lib/hooks.ts';
import { useTRPC } from '../../lib/trpc.ts';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '../../ui/index.ts';

type Result = { updated: number; skipped: { id: string; reason: string }[] };

/** Assign, change status or delete the selected leads. Leads the rules refuse are reported. */
export function BulkActions({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const users = useUsers();
  const statuses = useOptions(['leadStatuses']);
  const assign = useMutation(trpc.leads.bulkAssign.mutationOptions());
  const setStatus = useMutation(trpc.leads.bulkSetStatus.mutationOptions());
  const remove = useMutation(trpc.leads.bulkDelete.mutationOptions());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const report = async (verb: string, result: Result) => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.leads.pathFilter()),
      queryClient.invalidateQueries(trpc.activities.pathFilter()),
    ]);
    const plural = (n: number) => `${String(n)} lead${n === 1 ? '' : 's'}`;
    toast({
      title: `${plural(result.updated)} ${verb}`,
      description: result.skipped.length
        ? `${plural(result.skipped.length)} skipped: ${result.skipped[0]?.reason ?? ''}`
        : undefined,
      tone: result.skipped.length ? 'neutral' : 'success',
    });
    onDone();
  };
  const fail = (error: unknown) => {
    toast({ title: 'Nothing was changed', description: errorMessage(error), tone: 'danger' });
  };

  if (!can('leads', 'edit') && !can('leads', 'delete')) return null;

  return (
    <>
      {can('leads', 'edit') && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <UserPlus />
                Assign
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-72">
              <DropdownMenuLabel>Assign to</DropdownMenuLabel>
              {(users.data ?? []).map((user) => (
                <DropdownMenuItem
                  key={user.id}
                  onSelect={() => {
                    assign
                      .mutateAsync({ ids, ownerUserId: user.id })
                      .then((result) => report(`assigned to ${user.name}`, result))
                      .catch(fail);
                  }}
                >
                  {user.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  assign
                    .mutateAsync({ ids, ownerUserId: null })
                    .then((result) => report('unassigned', result))
                    .catch(fail);
                }}
              >
                Unassign
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                Status
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Change status to</DropdownMenuLabel>
              {statuses
                .options('leadStatuses')
                .filter((option) => option.value !== LEAD_CONVERTED)
                .map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() => {
                      setStatus
                        .mutateAsync({ ids, status: option.value })
                        .then((result) => report(`moved to ${option.label}`, result))
                        .catch(fail);
                    }}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      {can('leads', 'delete') && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setConfirmingDelete(true);
          }}
        >
          <Trash2 />
          Delete
        </Button>
      )}
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${String(ids.length)} lead${ids.length === 1 ? '' : 's'}?`}
        description="They'll be hidden from the list. An admin can restore them from the Deleted filter."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await report('deleted', await remove.mutateAsync({ ids }));
        }}
      />
    </>
  );
}
