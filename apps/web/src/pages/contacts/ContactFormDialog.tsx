import { zodResolver } from '@hookform/resolvers/zod';
import {
  contactInputSchema,
  formatPhone,
  type ContactInput,
  type ContactValues,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { errorMessage } from '../../lib/errors.ts';
import { useCan, useDebouncedValue, useOptions } from '../../lib/hooks.ts';
import { useTRPC } from '../../lib/trpc.ts';
import { EmailTagsInput } from '../../components/EmailTagsInput.tsx';
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
} from '../../ui/index.ts';

export type EditableContact = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  extraEmails: string[];
  mobile: string | null;
  secondaryMobile: string | null;
  type: string;
  companyId: string | null;
  companyName: string | null;
  notes: string | null;
};

function CompanyPicker({
  value,
  initialLabel,
  onChange,
  props,
}: {
  value: string | null;
  initialLabel: string | null;
  onChange: (value: string | null) => void;
  props: { id: string; invalid: boolean; 'aria-describedby': string | undefined };
}) {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const [label, setLabel] = useState(initialLabel);
  const debounced = useDebouncedValue(search, 200);
  const results = useQuery(trpc.companies.search.queryOptions({ search: debounced }));
  return (
    <Combobox
      {...props}
      value={value}
      selectedLabel={label}
      options={(results.data ?? []).map((company) => ({
        value: company.id,
        label: company.name,
        description: company.suburb ?? undefined,
      }))}
      loading={results.isFetching}
      onSearchChange={setSearch}
      onSelect={(next, option) => {
        setLabel(option?.label ?? null);
        onChange(next);
      }}
      placeholder="No company"
      searchPlaceholder="Search companies"
      emptyText="No companies match."
      clearLabel="No company"
    />
  );
}

function ContactForm({
  contact,
  defaultCompany,
  onDone,
}: {
  contact?: EditableContact;
  defaultCompany?: { id: string; name: string };
  onDone: (id: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const types = useOptions(['contactTypes']);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<ContactInput, unknown, ContactValues>({
    resolver: zodResolver(contactInputSchema),
    defaultValues: {
      firstName: contact?.firstName ?? '',
      lastName: contact?.lastName ?? '',
      email: [contact?.email, ...(contact?.extraEmails ?? [])].filter(Boolean).join(' '),
      mobile: formatPhone(contact?.mobile),
      secondaryMobile: formatPhone(contact?.secondaryMobile),
      type: contact?.type ?? 'Residential',
      companyId: contact?.companyId ?? defaultCompany?.id ?? null,
      notes: contact?.notes ?? '',
    },
  });

  const onSaved = async (id: string, message: string) => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.contacts.pathFilter()),
      queryClient.invalidateQueries(trpc.companies.pathFilter()),
    ]);
    toast({ title: message, tone: 'success' });
    onDone(id);
  };
  const create = useMutation(trpc.contacts.create.mutationOptions());
  const update = useMutation(trpc.contacts.update.mutationOptions());

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      if (contact) {
        await update.mutateAsync({ id: contact.id, values });
        await onSaved(contact.id, 'Contact updated');
      } else {
        const created = await create.mutateAsync(values);
        await onSaved(created.id, 'Contact added');
      }
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  const { control } = form;
  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="contents">
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        {serverError && (
          <Alert tone="danger" className="sm:col-span-2">
            {serverError}
          </Alert>
        )}
        <FormField control={control} name="firstName" label="First name" required>
          {(field, props) => <Input {...props} {...textInput(field)} autoFocus />}
        </FormField>
        <FormField control={control} name="lastName" label="Last name">
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
        <FormField control={control} name="mobile" label="Mobile" hint="e.g. 0412 345 678">
          {(field, props) => <Input {...props} {...textInput(field)} type="tel" />}
        </FormField>
        <FormField control={control} name="secondaryMobile" label="Other phone">
          {(field, props) => <Input {...props} {...textInput(field)} type="tel" />}
        </FormField>
        <FormField
          control={control}
          name="email"
          label="Email"
          hint="Press Space to add another address. The first one is the primary."
          className="sm:col-span-2"
        >
          {(field, props) => (
            <EmailTagsInput
              props={props}
              name={field.name}
              value={typeof field.value === 'string' ? field.value : ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        </FormField>
        <FormField control={control} name="type" label="Type" required>
          {(field, props) => (
            <Select
              {...props}
              name={field.name}
              value={field.value}
              onValueChange={field.onChange}
              options={types.options('contactTypes')}
              placeholder={types.isPending ? 'Loading…' : 'Choose a type'}
            />
          )}
        </FormField>
        {can('companies', 'view') && (
          <FormField control={control} name="companyId" label="Company">
            {(field, props) => (
              <CompanyPicker
                props={props}
                value={field.value ?? null}
                initialLabel={contact?.companyName ?? defaultCompany?.name ?? null}
                onChange={field.onChange}
              />
            )}
          </FormField>
        )}
        <FormField control={control} name="notes" label="Notes" className="sm:col-span-2">
          {(field, props) => <Textarea {...props} {...textInput(field)} rows={3} />}
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => {
            onDone('');
          }}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          {contact ? 'Save changes' : 'Add contact'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Add or edit a contact. `onSaved` receives the contact's id. */
export function ContactFormDialog({
  open,
  onOpenChange,
  contact,
  defaultCompany,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: EditableContact;
  defaultCompany?: { id: string; name: string };
  onSaved?: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={contact ? 'Edit contact' : 'New contact'}
        description={contact ? undefined : 'Add a person. You can add their addresses next.'}
        className="max-w-xl"
      >
        <ContactForm
          contact={contact}
          defaultCompany={defaultCompany}
          onDone={(id) => {
            onOpenChange(false);
            if (id) onSaved?.(id);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
