import { zodResolver } from '@hookform/resolvers/zod';
import {
  addressInputSchema,
  areaForPostcode,
  AU_STATES,
  nearestBigCity,
  stateForPostcode,
  type AddressInput,
  type AddressValues,
} from '@mms/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { errorMessage } from '../../lib/errors.ts';
import { useTRPC } from '../../lib/trpc.ts';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  FormField,
  Input,
  Select,
  textInput,
  toast,
} from '../../ui/index.ts';

export type EditableAddress = {
  id: string;
  propertyType: string | null;
  streetAddress: string;
  suburb: string;
  state: string;
  postcode: string | null;
  isPrimary: boolean;
  notes: string | null;
};

const STATE_OPTIONS = AU_STATES.map((state) => ({ value: state, label: state }));

function AddressForm({
  contactId,
  address,
  isFirst,
  onDone,
}: {
  contactId: string;
  address?: EditableAddress;
  isFirst: boolean;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const add = useMutation(trpc.contacts.addAddress.mutationOptions());
  const update = useMutation(trpc.contacts.updateAddress.mutationOptions());

  const form = useForm<AddressInput, unknown, AddressValues>({
    resolver: zodResolver(addressInputSchema),
    defaultValues: {
      streetAddress: address?.streetAddress ?? '',
      suburb: address?.suburb ?? '',
      state: AU_STATES.find((state) => state === address?.state),
      postcode: address?.postcode ?? '',
      propertyType: address?.propertyType ?? '',
      isPrimary: address?.isPrimary ?? isFirst,
      notes: address?.notes ?? '',
    },
  });
  const { control } = form;
  const postcode = useWatch({ control, name: 'postcode' });
  const makePrimary = useWatch({ control, name: 'isPrimary' }) === true;
  const area = areaForPostcode(postcode);
  const city = nearestBigCity(postcode, null);

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      if (address) await update.mutateAsync({ id: address.id, address: values });
      else await add.mutateAsync({ contactId, address: values });
      await queryClient.invalidateQueries(trpc.contacts.pathFilter());
      toast({ title: address ? 'Address updated' : 'Address added', tone: 'success' });
      onDone();
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
        <FormField
          control={control}
          name="streetAddress"
          label="Street address"
          required
          className="sm:col-span-4"
        >
          {(field, props) => (
            <Input {...props} {...textInput(field)} placeholder="12 Church St" autoFocus />
          )}
        </FormField>
        <FormField
          control={control}
          name="suburb"
          label="Suburb"
          required
          className="sm:col-span-2"
        >
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
        <FormField control={control} name="postcode" label="Postcode" required>
          {(field, props) => (
            <Input
              {...props}
              {...textInput(field)}
              inputMode="numeric"
              maxLength={4}
              onChange={(event) => {
                field.onChange(event.target.value);
                // Fill in the state from the postcode if it's still empty.
                const state = stateForPostcode(event.target.value);
                // Typed as always set, but it starts empty on a new address.
                const current: string | undefined = form.getValues('state');
                if (state && !current) form.setValue('state', state);
              }}
            />
          )}
        </FormField>
        <FormField control={control} name="state" label="State" required>
          {(field, props) => (
            <Select
              {...props}
              name={field.name}
              value={field.value}
              onValueChange={field.onChange}
              options={STATE_OPTIONS}
              placeholder="State"
            />
          )}
        </FormField>
        {area && (
          <p className="-mt-2 text-xs text-fg-muted sm:col-span-4">
            {area} · nearest city {city}
          </p>
        )}
        <FormField
          control={control}
          name="propertyType"
          label="Property"
          hint="e.g. Home, Investment property, Rental"
          className="sm:col-span-4"
        >
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
        <FormField control={control} name="notes" label="Site notes" className="sm:col-span-4">
          {(field, props) => (
            <Input {...props} {...textInput(field)} placeholder="Access, pets, gate code…" />
          )}
        </FormField>
        {!address?.isPrimary && !isFirst && (
          <label className="flex items-center gap-2 text-sm sm:col-span-4">
            <Checkbox
              checked={makePrimary}
              onCheckedChange={(checked) => {
                form.setValue('isPrimary', checked === true);
              }}
            />
            Make this the primary address
          </label>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          {address ? 'Save address' : 'Add address'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function AddressFormDialog({
  open,
  onOpenChange,
  contactId,
  address,
  isFirst,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  address?: EditableAddress;
  isFirst: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={address ? 'Edit address' : 'Add address'}
        description="Area and nearest city are worked out from the postcode."
        className="max-w-xl"
      >
        <AddressForm
          contactId={contactId}
          address={address}
          isFirst={isFirst}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
