import {
  FEATURE_LABELS,
  FEATURES,
  normaliseMatrix,
  PERMISSION_ACTION_LABELS,
  PERMISSION_ACTIONS,
  type PermissionMatrix,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { PageHeader } from '../../../components/PageHeader.tsx';
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
  Checkbox,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  Skeleton,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toast,
} from '../../../ui/index.ts';
import { SettingsBackLink } from '../SettingsPage.tsx';

type Role = RouterOutputs['admin']['roles']['list'][number];

function Matrix({ role, canEdit }: { role: Role; canEdit: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const save = useMutation(trpc.admin.roles.setPermissions.mutationOptions());
  const [draft, setDraft] = useState<PermissionMatrix>(role.permissions);
  const editable = canEdit && !role.locked;
  const dirty = JSON.stringify(draft) !== JSON.stringify(role.permissions);

  return (
    <Card>
      <CardHeader
        actions={
          editable && (
            <>
              <Button
                variant="ghost"
                disabled={!dirty}
                onClick={() => {
                  setDraft(role.permissions);
                }}
              >
                Undo changes
              </Button>
              <Button
                variant="primary"
                disabled={!dirty}
                loading={save.isPending}
                onClick={() => {
                  save
                    .mutateAsync({ id: role.id, permissions: draft })
                    .then(() => queryClient.invalidateQueries(trpc.admin.roles.pathFilter()))
                    .then(() => {
                      toast({
                        title: `${role.name} permissions saved`,
                        description: 'People with this role get them on their next page load.',
                        tone: 'success',
                      });
                    })
                    .catch((error: unknown) => {
                      toast({
                        title: "Couldn't save",
                        description: errorMessage(error),
                        tone: 'danger',
                      });
                    });
                }}
              >
                Save permissions
              </Button>
            </>
          )
        }
      >
        <CardTitle className="flex items-center gap-2">
          {role.name}
          {role.locked && <Lock className="size-4 text-fg-muted" aria-label="Locked" />}
        </CardTitle>
        <CardDescription>
          {role.locked
            ? 'Admins always have every permission, so the CRM can never be locked.'
            : (role.description ??
              'Switching on create, edit, delete or export also switches on view.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table aria-label={`Permissions for ${role.name}`}>
          <TableHead>
            <tr>
              <TableHeaderCell>Area</TableHeaderCell>
              {PERMISSION_ACTIONS.map((action) => (
                <TableHeaderCell key={action} className="text-center">
                  {PERMISSION_ACTION_LABELS[action]}
                </TableHeaderCell>
              ))}
            </tr>
          </TableHead>
          <tbody>
            {FEATURES.map((feature) => (
              <TableRow key={feature}>
                <TableCell>{FEATURE_LABELS[feature]}</TableCell>
                {PERMISSION_ACTIONS.map((action) => (
                  <TableCell key={action} className="text-center">
                    <Checkbox
                      aria-label={`${FEATURE_LABELS[feature]}: ${PERMISSION_ACTION_LABELS[action]}`}
                      checked={draft[feature][action]}
                      disabled={!editable}
                      onCheckedChange={(checked) => {
                        const next = structuredClone(draft);
                        next[feature][action] = checked === true;
                        if (action === 'view' && checked !== true) {
                          next[feature] = {
                            view: false,
                            create: false,
                            edit: false,
                            delete: false,
                            export: false,
                          };
                        }
                        setDraft(normaliseMatrix(next));
                      }}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}

function NewRoleDialog({
  open,
  onOpenChange,
  roles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
  onCreated: (id: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const create = useMutation(trpc.admin.roles.create.mutationOptions());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState('__none');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New role"
        description="Start empty or from an existing role's permissions."
      >
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            create
              .mutateAsync({
                name,
                description,
                copyFromRoleId: copyFrom === '__none' ? undefined : copyFrom,
              })
              .then(async ({ id }) => {
                await queryClient.invalidateQueries(trpc.admin.roles.pathFilter());
                toast({ title: `${name} created`, tone: 'success' });
                onOpenChange(false);
                onCreated(id);
              })
              .catch(() => undefined);
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            {create.isError && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
            <Field label="Name" required>
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  autoFocus
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              )}
            </Field>
            <Field label="What it's for">
              {(props) => (
                <Input
                  {...props}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                />
              )}
            </Field>
            <Field label="Copy permissions from">
              {(props) => (
                <Select
                  {...props}
                  value={copyFrom}
                  onValueChange={setCopyFrom}
                  options={[
                    { value: '__none', label: 'Nothing (no access)' },
                    ...roles.map((r) => ({ value: r.id, label: r.name })),
                  ]}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
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
              Create role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → Roles & permissions (Step 2.10): the §1.2 matrix, enforced on the server. */
export function RolesPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const query = useQuery(trpc.admin.roles.list.queryOptions());
  const remove = useMutation(trpc.admin.roles.remove.mutationOptions());
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const roles = query.data ?? [];
  const role = roles.find((r) => r.id === selected) ?? roles[0];

  return (
    <div className="flex flex-col gap-6">
      <SettingsBackLink />
      <PageHeader
        title="Roles & permissions"
        description="Permissions are checked by the server on every action — hiding a button is not the security."
        actions={
          can('roles', 'create') && (
            <Button
              variant="primary"
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus />
              New role
            </Button>
          )
        }
      />
      {query.isPending ? (
        <Skeleton className="h-96" />
      ) : query.isError ? (
        <Alert tone="danger">{errorMessage(query.error)}</Alert>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[16rem_1fr]">
          <Card>
            <CardContent className="py-2">
              <ul aria-label="Roles" className="flex flex-col">
                {roles.map((r) => (
                  <li key={r.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-current={r.id === role?.id}
                      onClick={() => {
                        setSelected(r.id);
                      }}
                      className={cn(
                        'flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-2',
                        r.id === role?.id && 'bg-surface-2 font-medium',
                      )}
                    >
                      <span className="truncate">{r.name}</span>
                      <span className="flex items-center gap-1.5">
                        {!r.isSystem && <Badge>Custom</Badge>}
                        <span className="text-xs text-fg-muted tabular-nums">{r.activeUsers}</span>
                      </span>
                    </button>
                    {!r.isSystem && can('roles', 'delete') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${r.name}`}
                        onClick={() => {
                          setDeleting(r);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="px-2.5 pt-2 text-xs text-fg-muted">
                Numbers are active people with each role.
              </p>
            </CardContent>
          </Card>
          {role && (
            <Matrix
              key={`${role.id}-${JSON.stringify(role.permissions)}`}
              role={role}
              canEdit={can('roles', 'edit')}
            />
          )}
        </div>
      )}
      <NewRoleDialog
        open={creating}
        onOpenChange={setCreating}
        roles={roles}
        onCreated={setSelected}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete the ${deleting?.name ?? ''} role?`}
        description="Only a role nobody has can be deleted."
        confirmLabel="Delete role"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await remove.mutateAsync({ id: deleting.id });
          await queryClient.invalidateQueries(trpc.admin.roles.pathFilter());
          setSelected(null);
          toast({ title: 'Role deleted', tone: 'success' });
        }}
      />
    </div>
  );
}
