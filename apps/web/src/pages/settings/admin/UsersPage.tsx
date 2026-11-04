import { zodResolver } from '@hookform/resolvers/zod';
import {
  inviteUserSchema,
  updateUserSchema,
  type InviteUserInput,
  type UpdateUserInput,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm, type FieldValues, type Path } from 'react-hook-form';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { PageHeader } from '../../../components/PageHeader.tsx';
import { When } from '../../../components/When.tsx';
import { errorMessage } from '../../../lib/errors.ts';
import { useCan } from '../../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../../lib/trpc.ts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FormField,
  IconButton,
  Input,
  Select,
  Skeleton,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  textInput,
  toast,
} from '../../../ui/index.ts';
import { SettingsBackLink } from '../SettingsPage.tsx';

type User = RouterOutputs['admin']['users']['list'][number];

function useRoles() {
  const trpc = useTRPC();
  return useQuery(trpc.admin.users.roleOptions.queryOptions());
}

function RoleField<T extends FieldValues>({
  control,
}: {
  control: Parameters<typeof FormField<T, Path<T>>>[0]['control'];
}) {
  const roles = useRoles();
  return (
    <FormField control={control} name={'roleId' as Path<T>} label="Role" required>
      {(field, props) => (
        <Select
          {...props}
          name={field.name}
          value={typeof field.value === 'string' ? field.value : ''}
          onValueChange={field.onChange}
          placeholder={roles.isPending ? 'Loading…' : 'Choose a role'}
          options={(roles.data ?? []).map((role) => ({ value: role.id, label: role.name }))}
        />
      )}
    </FormField>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const invite = useMutation(trpc.admin.users.invite.mutationOptions());
  const [error, setError] = useState<string | null>(null);
  const form = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { email: '', name: '', roleId: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await invite.mutateAsync(values);
      await queryClient.invalidateQueries(trpc.admin.users.pathFilter());
      toast({
        title: `${values.name} added`,
        description: 'They can now sign in with their Google Workspace account.',
        tone: 'success',
      });
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });
  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="contents">
      <DialogBody className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField
          control={form.control}
          name="email"
          label="Work email"
          required
          hint="Their @makemysolar.com.au Google account."
        >
          {(field, props) => <Input {...props} {...textInput(field)} type="email" autoFocus />}
        </FormField>
        <FormField control={form.control} name="name" label="Name" required>
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
        <RoleField<InviteUserInput> control={form.control} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          Add user
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditForm({ user, onDone }: { user: User; onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const update = useMutation(trpc.admin.users.update.mutationOptions());
  const [error, setError] = useState<string | null>(null);
  const form = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      name: user.name,
      roleId: user.roleId,
      phone: user.phone ?? '',
      department: user.department ?? '',
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await update.mutateAsync({ id: user.id, values });
      await queryClient.invalidateQueries(trpc.admin.users.pathFilter());
      toast({ title: 'User saved', tone: 'success' });
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });
  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="contents">
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
        <FormField control={form.control} name="name" label="Name" required>
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
        <RoleField<UpdateUserInput> control={form.control} />
        <FormField control={form.control} name="phone" label="Phone">
          {(field, props) => <Input {...props} {...textInput(field)} type="tel" />}
        </FormField>
        <FormField control={form.control} name="department" label="Department">
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Settings → Users (Step 2.10): onboard and offboard staff without touching the database. */
export function UsersPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const query = useQuery(trpc.admin.users.list.queryOptions());
  const setActive = useMutation(trpc.admin.users.setActive.mutationOptions());
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deactivating, setDeactivating] = useState<User | null>(null);

  const reactivate = (user: User) => {
    setActive
      .mutateAsync({ id: user.id, active: true })
      .then(() => queryClient.invalidateQueries(trpc.admin.users.pathFilter()))
      .then(() => {
        toast({ title: `${user.name} can sign in again`, tone: 'success' });
      })
      .catch((error: unknown) => {
        toast({ title: "Couldn't reactivate", description: errorMessage(error), tone: 'danger' });
      });
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsBackLink />
      <PageHeader
        title="Users"
        description="Only people listed here can sign in, with their Google Workspace account."
        actions={
          can('users', 'create') && (
            <Button
              variant="primary"
              onClick={() => {
                setInviting(true);
              }}
            >
              <UserPlus />
              Add user
            </Button>
          )
        }
      />
      <Card>
        <CardContent>
          {query.isPending ? (
            <Skeleton className="h-48" />
          ) : query.isError ? (
            <Alert tone="danger">{errorMessage(query.error)}</Alert>
          ) : (
            <Table aria-label="Users">
              <TableHead>
                <tr>
                  <TableHeaderCell>Person</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Last sign-in</TableHeaderCell>
                  <TableHeaderCell />
                </tr>
              </TableHead>
              <tbody>
                {query.data.map((user) => (
                  <TableRow key={user.id} className={user.isActive ? undefined : 'opacity-70'}>
                    <TableCell wrap>
                      <span className="flex items-center gap-3">
                        <Avatar name={user.name} size="sm" />
                        <span>
                          <span className="block font-medium">
                            {user.name}
                            {user.isYou && (
                              <span className="font-normal text-fg-muted"> (you)</span>
                            )}
                          </span>
                          <span className="text-xs text-fg-muted">{user.email}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>{user.roleName}</TableCell>
                    <TableCell>
                      {user.isActive ? (
                        user.hasSignedIn ? (
                          <Badge tone="success" dot>
                            Active
                          </Badge>
                        ) : (
                          <Badge tone="info" dot>
                            Invited
                          </Badge>
                        )
                      ) : (
                        <Badge dot>Deactivated</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {user.lastSignInAt ? (
                        <When iso={user.lastSignInAt} />
                      ) : (
                        <span className="text-fg-subtle">Never</span>
                      )}
                    </TableCell>
                    <TableCell end>
                      {can('users', 'edit') && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton size="sm" label={`Actions for ${user.name}`}>
                              <MoreHorizontal />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditing(user);
                              }}
                            >
                              Edit
                            </DropdownMenuItem>
                            {user.isActive ? (
                              !user.isYou && (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setDeactivating(user);
                                  }}
                                >
                                  Deactivate
                                </DropdownMenuItem>
                              )
                            ) : (
                              <DropdownMenuItem
                                onSelect={() => {
                                  reactivate(user);
                                }}
                              >
                                Reactivate
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent
          title="Add a user"
          description="They sign in with Google — there's no password to send."
        >
          {inviting && (
            <InviteForm
              onDone={() => {
                setInviting(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent title={`Edit ${editing?.name ?? ''}`} className="max-w-xl">
          {editing && (
            <EditForm
              user={editing}
              onDone={() => {
                setEditing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null);
        }}
        title={`Deactivate ${deactivating?.name ?? ''}?`}
        description="They are signed out and can't sign in again. Their leads, tasks and history stay, and you can reactivate them later."
        confirmLabel="Deactivate"
        destructive
        onConfirm={async () => {
          if (!deactivating) return;
          const result = await setActive.mutateAsync({ id: deactivating.id, active: false });
          await queryClient.invalidateQueries(trpc.admin.users.pathFilter());
          toast({
            title: `${deactivating.name} deactivated`,
            description: result.sessionsRevoked
              ? 'Signed out on every device.'
              : 'Their next action in the CRM signs them out.',
            tone: 'success',
          });
        }}
      />
    </div>
  );
}
