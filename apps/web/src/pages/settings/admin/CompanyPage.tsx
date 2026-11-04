import { zodResolver } from '@hookform/resolvers/zod';
import {
  AU_STATES,
  companyProfileSchema,
  formatAbn,
  type CompanyProfileInput,
  type CompanyProfileValues,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageHeader } from '../../../components/PageHeader.tsx';
import { errorMessage } from '../../../lib/errors.ts';
import { useCan } from '../../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../../lib/trpc.ts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardFooter,
  FormField,
  Input,
  Select,
  Skeleton,
  textInput,
  toast,
} from '../../../ui/index.ts';
import { SettingsBackLink } from '../SettingsPage.tsx';

type Profile = RouterOutputs['admin']['company']['get'];

function CompanyForm({ profile, editable }: { profile: Profile; editable: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const save = useMutation(trpc.admin.company.save.mutationOptions());
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CompanyProfileInput, unknown, CompanyProfileValues>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: {
      legalName: profile?.legalName ?? '',
      tradingName: profile?.tradingName ?? '',
      abn: formatAbn(profile?.abn),
      phone: profile?.phone ?? '',
      email: profile?.email ?? '',
      website: profile?.website ?? '',
      streetAddress: profile?.streetAddress ?? '',
      suburb: profile?.suburb ?? '',
      state: AU_STATES.find((s) => s === profile?.state) ?? '',
      postcode: profile?.postcode ?? '',
      electricalLicence: profile?.electricalLicence ?? '',
      cecAccreditation: profile?.cecAccreditation ?? '',
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await save.mutateAsync(values);
      await queryClient.invalidateQueries(trpc.admin.company.pathFilter());
      toast({ title: 'Company profile saved', tone: 'success' });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });
  const { control } = form;
  const text = (
    name: keyof CompanyProfileInput,
    label: string,
    extra: { hint?: string; required?: boolean; wide?: boolean; type?: string } = {},
  ) => (
    <FormField
      control={control}
      name={name}
      label={label}
      hint={extra.hint}
      required={extra.required}
      className={extra.wide ? 'sm:col-span-2' : undefined}
    >
      {(field, props) => (
        <Input {...props} {...textInput(field)} type={extra.type} disabled={!editable} />
      )}
    </FormField>
  );

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {error && (
            <Alert tone="danger" className="sm:col-span-2">
              {error}
            </Alert>
          )}
          {text('legalName', 'Legal name', { required: true })}
          {text('tradingName', 'Trading name')}
          {text('abn', 'ABN', { hint: 'Checked with the ATO checksum.' })}
          {text('phone', 'Phone', { type: 'tel' })}
          {text('email', 'Email', { type: 'email' })}
          {text('website', 'Website')}
          {text('streetAddress', 'Street address', { wide: true })}
          {text('suburb', 'Suburb')}
          <div className="grid grid-cols-2 gap-4">
            <FormField control={control} name="state" label="State">
              {(field, props) => (
                <Select
                  {...props}
                  name={field.name}
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                  disabled={!editable}
                  options={AU_STATES.map((s) => ({ value: s, label: s }))}
                />
              )}
            </FormField>
            {text('postcode', 'Postcode')}
          </div>
          {text('electricalLicence', 'Electrical contractor licence')}
          {text('cecAccreditation', 'CEC accreditation')}
        </CardContent>
        {editable && (
          <CardFooter>
            <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
              Save
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  );
}

/** Settings → Company profile (Step 2.10): the business's own details. */
export function CompanyPage() {
  const trpc = useTRPC();
  const can = useCan();
  const query = useQuery(trpc.admin.company.get.queryOptions());
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsBackLink />
      <PageHeader
        title="Company profile"
        description="Used on quotes, invoices and customer emails as those arrive."
      />
      {query.isPending ? (
        <Skeleton className="h-96" />
      ) : query.isError ? (
        <Alert tone="danger">{errorMessage(query.error)}</Alert>
      ) : (
        <CompanyForm profile={query.data} editable={can('users', 'edit')} />
      )}
    </div>
  );
}
