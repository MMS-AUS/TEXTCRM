import { zodResolver } from '@hookform/resolvers/zod';
import {
  abnLookupUrl,
  AU_STATES,
  companyInputSchema,
  formatAbn,
  formatPhone,
  parseAbn,
  stateForPostcode,
  type CompanyInput,
  type CompanyValues,
} from '@mms/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { errorMessage } from '../../lib/errors.ts';
import { useOptions } from '../../lib/hooks.ts';
import { useTRPC } from '../../lib/trpc.ts';
import { EmailTagsInput } from '../../components/EmailTagsInput.tsx';
import {
  Alert,
  Button,
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

export type EditableCompany = {
  id: string;
  name: string;
  type: string | null;
  abn: string | null;
  phone: string | null;
  email: string | null;
  extraEmails: string[];
  website: string | null;
  streetAddress: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  notes: string | null;
};

const NONE = '__none';
const STATE_OPTIONS = [
  { value: NONE, label: '—' },
  ...AU_STATES.map((state) => ({ value: state, label: state })),
];

function CompanyForm({
  company,
  onDone,
}: {
  company?: EditableCompany;
  onDone: (id: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const types = useOptions(['companyTypes']);
  const [serverError, setServerError] = useState<string | null>(null);
  const create = useMutation(trpc.companies.create.mutationOptions());
  const update = useMutation(trpc.companies.update.mutationOptions());

  const form = useForm<CompanyInput, unknown, CompanyValues>({
    resolver: zodResolver(companyInputSchema),
    defaultValues: {
      name: company?.name ?? '',
      type: company?.type ?? '',
      abn: formatAbn(company?.abn),
      phone: formatPhone(company?.phone),
      email: [company?.email, ...(company?.extraEmails ?? [])].filter(Boolean).join(' '),
      website: company?.website ?? '',
      streetAddress: company?.streetAddress ?? '',
      suburb: company?.suburb ?? '',
      state: AU_STATES.find((state) => state === company?.state) ?? '',
      postcode: company?.postcode ?? '',
      notes: company?.notes ?? '',
    },
  });
  const { control } = form;
  const abn = useWatch({ control, name: 'abn' });
  const parsedAbn = abn ? parseAbn(abn) : null;

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const id = company
        ? (await update.mutateAsync({ id: company.id, values })).id
        : (await create.mutateAsync(values)).id;
      await Promise.all([
        queryClient.invalidateQueries(trpc.companies.pathFilter()),
        queryClient.invalidateQueries(trpc.contacts.pathFilter()),
      ]);
      toast({ title: company ? 'Company updated' : 'Company added', tone: 'success' });
      onDone(id);
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="contents">
      <DialogBody className="grid gap-4 sm:grid-cols-4">
        {serverError && (
          <Alert tone="danger" className="sm:col-span-4">
            {serverError}
          </Alert>
        )}
        <FormField control={control} name="name" label="Name" required className="sm:col-span-4">
          {(field, props) => <Input {...props} {...textInput(field)} autoFocus />}
        </FormField>
        <FormField control={control} name="type" label="Type" className="sm:col-span-2">
          {(field, props) => (
            <Select
              {...props}
              name={field.name}
              value={field.value || NONE}
              onValueChange={(value) => {
                field.onChange(value === NONE ? '' : value);
              }}
              options={[{ value: NONE, label: 'No type' }, ...types.options('companyTypes')]}
            />
          )}
        </FormField>
        <FormField control={control} name="abn" label="ABN" className="sm:col-span-2">
          {(field, props) => (
            <Input {...props} {...textInput(field)} inputMode="numeric" placeholder="11 digits" />
          )}
        </FormField>
        {parsedAbn?.ok && (
          <p className="-mt-2 flex items-center gap-1.5 text-xs text-success-text sm:col-span-4">
            <CircleCheck className="size-3.5" />
            Valid ABN format.
            <a
              href={abnLookupUrl(parsedAbn.abn)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent-text hover:underline"
            >
              Check it on ABN Lookup
              <ExternalLink className="size-3" />
            </a>
          </p>
        )}
        <FormField control={control} name="phone" label="Phone" className="sm:col-span-2">
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
        <FormField control={control} name="website" label="Website" className="sm:col-span-4">
          {(field, props) => (
            <Input {...props} {...textInput(field)} placeholder="example.com.au" />
          )}
        </FormField>
        <FormField
          control={control}
          name="streetAddress"
          label="Street address"
          className="sm:col-span-4"
        >
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
        <FormField control={control} name="suburb" label="Suburb" className="sm:col-span-2">
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
        <FormField control={control} name="postcode" label="Postcode">
          {(field, props) => (
            <Input
              {...props}
              {...textInput(field)}
              inputMode="numeric"
              maxLength={4}
              onChange={(event) => {
                field.onChange(event.target.value);
                const state = stateForPostcode(event.target.value);
                if (state && !form.getValues('state')) form.setValue('state', state);
              }}
            />
          )}
        </FormField>
        <FormField control={control} name="state" label="State">
          {(field, props) => (
            <Select
              {...props}
              name={field.name}
              value={field.value || NONE}
              onValueChange={(value) => {
                field.onChange(value === NONE ? '' : value);
              }}
              options={STATE_OPTIONS}
            />
          )}
        </FormField>
        <FormField control={control} name="notes" label="Notes" className="sm:col-span-4">
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
          {company ? 'Save changes' : 'Add company'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CompanyFormDialog({
  open,
  onOpenChange,
  company,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: EditableCompany;
  onSaved?: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={company ? 'Edit company' : 'New company'}
        description={
          company ? undefined : 'Commercial customers, installers, suppliers and other businesses.'
        }
        className="max-w-xl"
      >
        <CompanyForm
          company={company}
          onDone={(id) => {
            onOpenChange(false);
            if (id) onSaved?.(id);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
