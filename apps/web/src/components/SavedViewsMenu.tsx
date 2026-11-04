import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, ChevronDown, Plus, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../lib/errors.ts';
import { useTRPC } from '../lib/trpc.ts';
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  toast,
} from '../ui/index.ts';

/** Your own named filter sets for a list page ("My new Meta leads"). */
export function SavedViewsMenu({
  page,
  current,
  onApply,
}: {
  page: 'leads' | 'projects' | 'tickets';
  /** The list's current URL search params, saved as-is. */
  current: Record<string, unknown>;
  onApply: (search: Record<string, unknown>) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const views = useQuery(trpc.savedViews.list.queryOptions({ page }));
  const create = useMutation(trpc.savedViews.create.mutationOptions());
  const remove = useMutation(trpc.savedViews.remove.mutationOptions());
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries(trpc.savedViews.pathFilter());

  const save = async () => {
    setError(null);
    try {
      // Saved without the page number: a view should open on its first page.
      const search = { ...current };
      delete search.page;
      await create.mutateAsync({ page, name, search });
      await refresh();
      toast({ title: `Saved "${name.trim()}"`, tone: 'success' });
      setSaving(false);
      setName('');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm">
            <Bookmark />
            Views
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>My views</DropdownMenuLabel>
          {(views.data ?? []).map((view) => (
            <DropdownMenuItem
              key={view.id}
              onSelect={() => {
                onApply(view.search);
              }}
            >
              {view.name}
            </DropdownMenuItem>
          ))}
          {views.data?.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-fg-muted">No saved views yet.</p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setSaving(true);
            }}
          >
            <Plus />
            Save current filters…
          </DropdownMenuItem>
          {(views.data?.length ?? 0) > 0 && (
            <DropdownMenuItem
              onSelect={() => {
                setManaging(true);
              }}
            >
              <Settings2 />
              Manage views…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent
          title="Save view"
          description="Saves the current search, filters and sort. Only you can see your views."
          className="max-w-md"
        >
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <DialogBody className="flex flex-col gap-3">
              {error && <Alert tone="danger">{error}</Alert>}
              <Field label="Name" required>
                {(props) => (
                  <Input
                    {...props}
                    autoFocus
                    maxLength={60}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                    placeholder="e.g. My new Meta leads"
                  />
                )}
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setSaving(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={create.isPending}
                disabled={!name.trim()}
              >
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={managing} onOpenChange={setManaging}>
        <DialogContent title="Manage views" className="max-w-md">
          <DialogBody>
            <ul className="flex flex-col divide-y divide-line">
              {(views.data ?? []).map((view) => (
                <li key={view.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  {view.name}
                  <IconButton
                    label={`Delete ${view.name}`}
                    size="sm"
                    onClick={() => {
                      void remove
                        .mutateAsync({ id: view.id })
                        .then(refresh)
                        .catch((caught: unknown) => {
                          toast({
                            title: "Couldn't delete the view",
                            description: errorMessage(caught),
                            tone: 'danger',
                          });
                        });
                    }}
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
