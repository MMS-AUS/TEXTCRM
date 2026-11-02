import { zodResolver } from '@hookform/resolvers/zod';
import {
  AU_STATES,
  businessToday,
  formatPhone,
  LEAD_CONVERTED,
  leadInputSchema,
  stateForPostcode,
  type LeadInput,
  type LeadValues,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { errorMessage } from '../../lib/errors.ts';
import { useDebouncedValue, useOptions, useUsers } from '../../lib/hooks.ts';
import { useTRPC } from '../../lib/trpc.ts';
import {
  Alert,
  Button,
  Checkbox,
  DateInput,
  Drawer,
  DrawerContent,
  FormField,
  Input,
  Select,
  Textarea,
  textInput,
  toast,
} from '../../ui/index.ts';

export type EditableLead = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  mobile: string | null;
  secondaryMobile: string | null;
  streetAddress: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  platform: string | null;
  source: string | null;
  status: string;
  ownerUserId: string | null;
  leadDate: string;
  notes: string | null;
};

const NONE = '__none';
const STATE_OPTIONS = [
  { value: NONE, label: '—' },
  ...AU_STATES.map((state) => ({ value: state, label: state })),
];

/** Live duplicate check: runs once the form describes someone identifiable. */
function DuplicateNotice({
  values,
  excludeId,
  confirmed,
  onConfirmedChange,
}: {
  /** The form's current (partial, unvalidated) values. */
  values: unknown;
  excludeId?: string;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
}) {
  const trpc = useTRPC();
  const parsed = leadInputSchema.safeParse(values);
  const debounced = useDebouncedValue(parsed.success ? parsed.data : null, 400);
  const check = useQuery({
    ...trpc.leads.checkDuplicate.queryOptions({
      values: debounced ?? { firstName: '' },
      excludeId,
    }),
    enabled: debounced !== null,
  });
  if (!parsed.success || !check.data) return null;
  const { duplicate, contact } = check.data;

  if (duplicate) {
    const strong = duplicate.matchedOn !== 'name';
    return (
      <Alert
        tone={strong ? 'danger' : 'warning'}
        title={strong ? 'This lead already exists' : 'Possible duplicate'}
      >
        <p>
          <Link
            to="/leads/$leadId"
            params={{ leadId: duplicate.id }}
            className="font-medium underline"
          >
            {duplicate.name}
          </Link>{' '}
          ({duplicate.status}
          {duplicate.suburb ? `, ${duplicate.suburb}` : ''}) has the {duplicate.reason}.
          {strong && ' Add your notes to that lead instead.'}
        </p>
        {!strong && (
          <label className="mt-2 flex items-center gap-2">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(checked) => {
                onConfirmedChange(checked === true);
              }}
            />
            This is a different person
          </label>
        )}
      </Alert>
    );
  }
  if (contact && !excludeId) {
    return (
      <Alert tone="info">
        Will be linked to the existing contact <span className="font-medium">{contact.name}</span>.
      </Alert>
    );
  }
  return null;
}

function LeadForm({ lead, onDone }: { lead?: EditableLead; onDone: (id: string) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const options = useOptions(['platforms', 'leadSources', 'leadStatuses']);
  const users = useUsers();
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const create = useMutation(trpc.leads.create.mutationOptions());
  const update = useMutation(trpc.leads.update.mutationOptions());

  const form = useForm<LeadInput, unknown, LeadValues>({
    resolver: zodResolver(leadInputSchema),
    defaultValues: {
      firstName: lead?.firstName ?? '',
      lastName: lead?.lastName ?? '',
      email: lead?.email ?? '',
      mobile: formatPhone(lead?.mobile),
      secondaryMobile: formatPhone(lead?.secondaryMobile),
      streetAddress: lead?.streetAddress ?? '',
      suburb: lead?.suburb ?? '',
      state: AU_STATES.find((state) => state === lead?.state) ?? '',
      postcode: lead?.postcode ?? '',
      platform: lead?.platform ?? '',
      source: lead?.source ?? '',
      status: lead?.status ?? 'New',
      ownerUserId: lead?.ownerUserId ?? '',
      leadDate: lead?.leadDate ?? businessToday(),
      notes: lead?.notes ?? '',
    },
  });
  const { control } = form;
  const watched = useWatch({ control });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const id = lead
        ? (await update.mutateAsync({ id: lead.id, values })).id
        : (await create.mutateAsync({ values, confirmNotDuplicate: confirmed })).id;
      await Promise.all([
        queryClient.invalidateQueries(trpc.leads.pathFilter()),
        queryClient.invalidateQueries(trpc.activities.pathFilter()),
        queryClient.invalidateQueries(trpc.contacts.pathFilter()),
      ]);
      toast({ title: lead ? 'Lead updated' : 'Lead added', tone: 'success' });
      onDone(id);
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  const statusOptions = options
    .options('leadStatuses')
    .filter((option) => option.value !== LEAD_CONVERTED || lead?.status === LEAD_CONVERTED);
  const ownerOptions = [
    { value: NONE, label: 'Unassigned' },
    ...(users.data ?? []).map((user) => ({ value: user.id, label: user.name })),
  ];

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <DuplicateNotice
          values={watched}
          excludeId={lead?.id}
          confirmed={confirmed}
          onConfirmedChange={setConfirmed}
        />

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-sm font-semibold">Customer</legend>
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
          <FormField control={control} name="email" label="Email" className="sm:col-span-2">
            {(field, props) => <Input {...props} {...textInput(field)} type="email" />}
          </FormField>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-4">
          <legend className="mb-3 text-sm font-semibold">Property</legend>
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
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-sm font-semibold">Lead</legend>
          <FormField control={control} name="platform" label="Platform">
            {(field, props) => (
              <Select
                {...props}
                name={field.name}
                value={field.value || NONE}
                onValueChange={(value) => {
                  field.onChange(value === NONE ? '' : value);
                }}
                options={[{ value: NONE, label: '—' }, ...options.options('platforms')]}
              />
            )}
          </FormField>
          <FormField control={control} name="source" label="Source">
            {(field, props) => (
              <Select
                {...props}
                name={field.name}
                value={field.value || NONE}
                onValueChange={(value) => {
                  field.onChange(value === NONE ? '' : value);
                }}
                options={[{ value: NONE, label: '—' }, ...options.options('leadSources')]}
              />
            )}
          </FormField>
          <FormField control={control} name="status" label="Status">
            {(field, props) => (
              <Select
                {...props}
                name={field.name}
                value={field.value}
                onValueChange={field.onChange}
                options={statusOptions}
                disabled={lead?.status === LEAD_CONVERTED}
              />
            )}
          </FormField>
          <FormField control={control} name="ownerUserId" label="Sales person">
            {(field, props) => (
              <Select
                {...props}
                name={field.name}
                value={field.value || NONE}
                onValueChange={(value) => {
                  field.onChange(value === NONE ? '' : value);
                }}
                options={ownerOptions}
              />
            )}
          </FormField>
          <FormField control={control} name="leadDate" label="Lead date">
            {(field, props) => (
              <DateInput {...props} value={field.value} onChange={field.onChange} />
            )}
          </FormField>
          <FormField control={control} name="notes" label="Notes" className="sm:col-span-2">
            {(field, props) => <Textarea {...props} {...textInput(field)} rows={3} />}
          </FormField>
        </fieldset>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button
          variant="ghost"
          onClick={() => {
            onDone('');
          }}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          {lead ? 'Save changes' : 'Add lead'}
        </Button>
      </div>
    </form>
  );
}

export function LeadFormDrawer({
  open,
  onOpenChange,
  lead,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: EditableLead;
  onSaved?: (id: string) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={lead ? 'Edit lead' : 'New lead'}
        description={lead ? undefined : 'We check for an existing lead as you type.'}
        className="w-[min(36rem,calc(100%-2rem))]"
      >
        <LeadForm
          lead={lead}
          onDone={(id) => {
            onOpenChange(false);
            if (id) onSaved?.(id);
          }}
        />
      </DrawerContent>
    </Drawer>
  );
}
