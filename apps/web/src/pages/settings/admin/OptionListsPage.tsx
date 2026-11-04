import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Lock, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../../components/PageHeader.tsx';
import { SearchBox } from '../../../components/SearchBox.tsx';
import { errorMessage } from '../../../lib/errors.ts';
import { useCan } from '../../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../../lib/trpc.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Skeleton,
  Switch,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toast,
  Tooltip,
} from '../../../ui/index.ts';
import { SettingsBackLink } from '../SettingsPage.tsx';

type Option = RouterOutputs['admin']['optionLists']['items']['options'][number];

function useRefresh() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.admin.optionLists.pathFilter()),
      queryClient.invalidateQueries(trpc.optionLists.pathFilter()),
    ]);
}

function RenameDialog({ option, onDone }: { option: Option; onDone: () => void }) {
  const trpc = useTRPC();
  const refresh = useRefresh();
  const rename = useMutation(trpc.admin.optionLists.rename.mutationOptions());
  const [label, setLabel] = useState(option.label);
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        rename
          .mutateAsync({ id: option.id, label })
          .then(refresh)
          .then(() => {
            toast({ title: 'Option reworded', tone: 'success' });
            onDone();
          })
          .catch(() => undefined);
      }}
    >
      <DialogBody className="flex flex-col gap-4">
        {rename.isError && <Alert tone="danger">{errorMessage(rename.error)}</Alert>}
        <Field
          label="Shown as"
          hint={`Records keep the stored value "${option.value}", so nothing already saved changes.`}
        >
          {(props) => (
            <Input
              {...props}
              value={label}
              autoFocus
              onChange={(event) => {
                setLabel(event.target.value);
              }}
            />
          )}
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={rename.isPending} disabled={!label.trim()}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function ListEditor({ listKey }: { listKey: string }) {
  const trpc = useTRPC();
  const can = useCan();
  const refresh = useRefresh();
  const query = useQuery(trpc.admin.optionLists.items.queryOptions({ key: listKey }));
  const add = useMutation(trpc.admin.optionLists.add.mutationOptions());
  const move = useMutation(trpc.admin.optionLists.move.mutationOptions());
  const setArchived = useMutation(trpc.admin.optionLists.setArchived.mutationOptions());
  const [label, setLabel] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState<Option | null>(null);
  const canEdit = can('option_lists', 'edit');

  const act = (work: Promise<unknown>, success?: string) =>
    work
      .then(refresh)
      .then(() => {
        if (success) toast({ title: success, tone: 'success' });
      })
      .catch((error: unknown) => {
        toast({
          title: "Couldn't change the list",
          description: errorMessage(error),
          tone: 'danger',
        });
      });

  if (query.isPending) return <Skeleton className="h-96" />;
  if (query.isError) return <Alert tone="danger">{errorMessage(query.error)}</Alert>;
  const list = query.data;
  const shown = list.options.filter((o) => showArchived || !o.archived);

  return (
    <Card>
      <CardHeader
        actions={
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
            Show archived
          </label>
        }
      >
        <CardTitle>{list.name}</CardTitle>
        <CardDescription>
          {list.fixed
            ? 'This list is built into the app: options can be reworded, not added or archived.'
            : 'Archived options leave the dropdowns; records that already use them keep showing them.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table aria-label={`${list.name} options`}>
          <TableHead>
            <tr>
              <TableHeaderCell>Option</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell />
            </tr>
          </TableHead>
          <tbody>
            {shown.map((option, index) => (
              <TableRow key={option.id} className={option.archived ? 'opacity-60' : undefined}>
                <TableCell wrap>
                  <span className="block">{option.label}</span>
                  {option.value !== option.label && (
                    <span className="text-xs text-fg-muted">Stored as “{option.value}”</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1.5">
                    {option.archived && <Badge>Archived</Badge>}
                    {option.protection && (
                      <Tooltip
                        content={
                          option.protection === 'fixed-list'
                            ? 'Built into the app'
                            : "Used by the app's rules — can't be archived"
                        }
                      >
                        <span tabIndex={0}>
                          <Badge>
                            <Lock className="size-3" />
                            Locked
                          </Badge>
                        </span>
                      </Tooltip>
                    )}
                  </span>
                </TableCell>
                <TableCell end>
                  {canEdit && (
                    <span className="flex justify-end gap-1">
                      <IconButton
                        size="sm"
                        label={`Move ${option.label} up`}
                        disabled={index === 0}
                        onClick={() =>
                          void act(move.mutateAsync({ id: option.id, direction: 'up' }))
                        }
                      >
                        <ArrowUp />
                      </IconButton>
                      <IconButton
                        size="sm"
                        label={`Move ${option.label} down`}
                        disabled={index === shown.length - 1}
                        onClick={() =>
                          void act(move.mutateAsync({ id: option.id, direction: 'down' }))
                        }
                      >
                        <ArrowDown />
                      </IconButton>
                      <IconButton
                        size="sm"
                        label={`Reword ${option.label}`}
                        onClick={() => {
                          setRenaming(option);
                        }}
                      >
                        <Pencil />
                      </IconButton>
                      {option.archived ? (
                        <IconButton
                          size="sm"
                          label={`Restore ${option.label}`}
                          onClick={() =>
                            void act(
                              setArchived.mutateAsync({ id: option.id, archived: false }),
                              'Option restored',
                            )
                          }
                        >
                          <ArchiveRestore />
                        </IconButton>
                      ) : (
                        !option.protection && (
                          <IconButton
                            size="sm"
                            label={`Archive ${option.label}`}
                            onClick={() =>
                              void act(
                                setArchived.mutateAsync({ id: option.id, archived: true }),
                                'Option archived',
                              )
                            }
                          >
                            <Archive />
                          </IconButton>
                        )
                      )}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
        {can('option_lists', 'create') && !list.fixed && (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void act(
                add.mutateAsync({ key: list.key, label }).then(() => {
                  setLabel('');
                }),
                'Option added',
              );
            }}
          >
            <Field label="New option" className="flex-1">
              {(props) => (
                <Input
                  {...props}
                  value={label}
                  onChange={(event) => {
                    setLabel(event.target.value);
                  }}
                />
              )}
            </Field>
            <Button type="submit" loading={add.isPending} disabled={!label.trim()}>
              <Plus />
              Add
            </Button>
          </form>
        )}
      </CardContent>
      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent title="Reword option">
          {renaming && (
            <RenameDialog
              option={renaming}
              onDone={() => {
                setRenaming(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Settings → Option lists (Step 2.10): the choices in every dropdown (§1.6). */
export function OptionListsPage() {
  const trpc = useTRPC();
  const lists = useQuery(trpc.optionLists.list.queryOptions());
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const shown = (lists.data ?? []).filter((list) =>
    list.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const current = selected ?? shown[0]?.key ?? null;

  return (
    <div className="flex flex-col gap-6">
      <SettingsBackLink />
      <PageHeader
        title="Option lists"
        description="The choices offered in dropdowns across the CRM."
      />
      {lists.isPending ? (
        <Skeleton className="h-96" />
      ) : lists.isError ? (
        <Alert tone="danger">{errorMessage(lists.error)}</Alert>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[18rem_1fr]">
          <Card>
            <CardContent className="flex flex-col gap-2 py-3">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="Find a list"
                label="Find a list"
              />
              <ul aria-label="Option lists" className="flex max-h-[70dvh] flex-col overflow-y-auto">
                {shown.map((list) => (
                  <li key={list.key}>
                    <button
                      type="button"
                      aria-current={list.key === current}
                      onClick={() => {
                        setSelected(list.key);
                      }}
                      className={cn(
                        'flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2',
                        list.key === current && 'bg-surface-2 font-medium',
                      )}
                    >
                      <span className="truncate">{list.name}</span>
                      <span className="text-xs text-fg-muted tabular-nums">
                        {list.activeOptions}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          {current && <ListEditor key={current} listKey={current} />}
        </div>
      )}
    </div>
  );
}
