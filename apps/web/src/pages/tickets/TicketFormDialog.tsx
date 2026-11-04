import { zodResolver } from '@hookform/resolvers/zod';
import {
  TICKET_PRIORITIES,
  ticketInputSchema,
  type TicketInput,
  type TicketValues,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { errorMessage } from '../../lib/errors.ts';
import { formatPhone } from '@mms/shared';
import { useDebouncedValue, useOptions, useUsers } from '../../lib/hooks.ts';
import { useTRPC } from '../../lib/trpc.ts';
import {
  Alert,
  Button,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  FormField,
  Input,
  Select,
  Textarea,
  textInput,
  toast,
  type FieldControlProps,
} from '../../ui/index.ts';

const NONE = '__none';

export type TicketDefaults = Partial<TicketInput> & {
  id?: string;
  contactName?: string | null;
};

function CustomerPicker({
  value,
  initialLabel,
  onChange,
  props,
}: {
  value: string | null;
  initialLabel: string | null;
  onChange: (value: string | null) => void;
  props: FieldControlProps;
}) {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const [label, setLabel] = useState(initialLabel);
  const debounced = useDebouncedValue(search, 200);
  const results = useQuery(trpc.tickets.customerSearch.queryOptions({ search: debounced }));
  return (
    <Combobox
      {...props}
      value={value}
      selectedLabel={label}
      options={(results.data ?? []).map((c) => ({
        value: c.id,
        label: c.name,
        description: [c.email, formatPhone(c.mobile)].filter(Boolean).join(' · ') || undefined,
      }))}
      loading={results.isFetching}
      onSearchChange={setSearch}
      onSelect={(next, option) => {
        setLabel(option?.label ?? null);
        onChange(next);
      }}
      placeholder="Choose the customer"
      searchPlaceholder="Search name, email or phone"
      emptyText="No customers match."
    />
  );
}

function TicketForm({ ticket, onDone }: { ticket: TicketDefaults; onDone: (id?: string) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const users = useUsers();
  const options = useOptions(['ticketCategories']);
  const create = useMutation(trpc.tickets.create.mutationOptions());
  const update = useMutation(trpc.tickets.update.mutationOptions());
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<TicketInput, unknown, TicketValues>({
    resolver: zodResolver(ticketInputSchema),
    defaultValues: {
      contactId: ticket.contactId ?? '',
      projectId: ticket.projectId ?? '',
      title: ticket.title ?? '',
      description: ticket.description ?? '',
      category: ticket.category ?? '',
      priority: ticket.priority ?? 'Medium',
      assignedUserId: ticket.assignedUserId ?? '',
    },
  });
  const contactId = useWatch({ control: form.control, name: 'contactId' });
  const projects = useQuery({
    ...trpc.tickets.contactProjects.queryOptions({ contactId }),
    enabled: Boolean(contactId),
  });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      let id = ticket.id;
      if (ticket.id) {
        await update.mutateAsync({ id: ticket.id, values });
      } else {
        ({ id } = await create.mutateAsync(values));
      }
      await Promise.all([
        queryClient.invalidateQueries(trpc.tickets.pathFilter()),
        queryClient.invalidateQueries(trpc.activities.pathFilter()),
      ]);
      toast({ title: ticket.id ? 'Ticket saved' : 'Ticket opened', tone: 'success' });
      onDone(id);
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  const { control } = form;
  const select = (choices: { value: string; label: string }[]) =>
    function render(
      field: { name: string; value: unknown; onChange: (value: string) => void },
      props: FieldControlProps,
    ) {
      return (
        <Select
          {...props}
          name={field.name}
          value={typeof field.value === 'string' && field.value ? field.value : NONE}
          onValueChange={(value) => {
            field.onChange(value === NONE ? '' : value);
          }}
          options={[{ value: NONE, label: '—' }, ...choices]}
        />
      );
    };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="contents">
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        {serverError && (
          <Alert tone="danger" className="sm:col-span-2">
            {serverError}
          </Alert>
        )}
        <FormField control={control} name="contactId" label="Customer" required>
          {(field, props) => (
            <CustomerPicker
              props={props}
              value={field.value || null}
              initialLabel={ticket.contactName ?? null}
              onChange={(next) => {
                field.onChange(next ?? '');
                form.setValue('projectId', '');
              }}
            />
          )}
        </FormField>
        <FormField
          control={control}
          name="projectId"
          label="Project"
          hint={
            contactId && projects.data?.length === 0 ? 'This customer has no projects.' : undefined
          }
        >
          {select(
            (projects.data ?? []).map((p) => ({
              value: p.id,
              label: [p.projectNumber, p.title ?? p.suburb].filter(Boolean).join(' · '),
            })),
          )}
        </FormField>
        <FormField
          control={control}
          name="title"
          label="Problem"
          required
          className="sm:col-span-2"
        >
          {(field, props) => (
            <Input
              {...props}
              {...textInput(field)}
              placeholder="e.g. Inverter showing a red alarm"
            />
          )}
        </FormField>
        <FormField control={control} name="category" label="Category">
          {select(options.options('ticketCategories'))}
        </FormField>
        <FormField control={control} name="priority" label="Priority" required>
          {(field, props) => (
            <Select
              {...props}
              name={field.name}
              value={field.value ?? 'Medium'}
              onValueChange={field.onChange}
              options={TICKET_PRIORITIES.map((p) => ({ value: p, label: p }))}
            />
          )}
        </FormField>
        <FormField control={control} name="assignedUserId" label="Service handler">
          {select((users.data ?? []).map((u) => ({ value: u.id, label: u.name })))}
        </FormField>
        <FormField control={control} name="description" label="Details" className="sm:col-span-2">
          {(field, props) => <Textarea {...props} {...textInput(field)} rows={3} />}
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => {
            onDone();
          }}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          {ticket.id ? 'Save changes' : 'Open ticket'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Open a ticket (optionally for a known customer/project), or edit one's core details. */
export function TicketFormDialog({
  open,
  onOpenChange,
  ticket = {},
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket?: TicketDefaults;
  onSaved?: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={ticket.id ? 'Edit ticket' : 'New service ticket'}
        description={
          ticket.id ? undefined : 'Log a problem for a customer. You can triage it next.'
        }
        className="max-w-xl"
      >
        {open && (
          <TicketForm
            ticket={ticket}
            onDone={(id) => {
              onOpenChange(false);
              if (id) onSaved?.(id);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
