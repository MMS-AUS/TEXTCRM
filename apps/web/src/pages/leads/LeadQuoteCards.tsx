import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatAud,
  INVERTER_TYPE_LABELS,
  LEAD_PIPELINE,
  leadPricingSchema,
  leadSystemSchema,
  systemSizeKw,
  type LeadPricingInput,
  type LeadPricingValues,
  type LeadSystemInput,
  type LeadSystemValues,
} from '@mms/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { DetailList } from '../../components/DetailList.tsx';
import { InverterLinesEditor } from '../../components/InverterLinesEditor.tsx';
import {
  inverterDefaults,
  useInverterLines,
  type InverterFields,
} from '../../components/inverter-lines.ts';
import {
  HardwarePicker,
  type HardwareKind,
  type HardwareOption,
} from '../../components/HardwarePicker.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { formatDate } from '../../lib/format.ts';
import { useOptions } from '../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DateInput,
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

type Lead = RouterOutputs['leads']['get'];

const NONE = '__none';

function SectionCard({
  title,
  editable,
  onEdit,
  children,
}: {
  title: string;
  editable: boolean;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        actions={
          editable && (
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Pencil />
              Edit
            </Button>
          )
        }
      >
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="py-1">{children}</CardContent>
    </Card>
  );
}

function useSaveLead() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.leads.pathFilter()),
      queryClient.invalidateQueries(trpc.activities.pathFilter()),
    ]);
}

// ── System requirements ───────────────────────────────────────────────────

function SystemForm({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const trpc = useTRPC();
  const refresh = useSaveLead();
  const options = useOptions(['roofTypes', 'houseStoreys', 'phases']);
  const update = useMutation(trpc.leads.updateSystem.mutationOptions());
  const [serverError, setServerError] = useState<string | null>(null);
  const system = lead.system;
  const [panelWatts, setPanelWatts] = useState<string | null>(
    system?.panel?.spec.replace(' W', '') ?? null,
  );

  const form = useForm<LeadSystemInput, unknown, LeadSystemValues>({
    resolver: zodResolver(leadSystemSchema),
    defaultValues: {
      panelId: system?.panelId ?? null,
      panelCount: system?.panelCount ?? '',
      inverters: inverterDefaults(system?.inverters),
      batteryId: system?.batteryId ?? null,
      batteryCount: system?.batteryCount ?? '',
      systemSizeKw: system?.systemSizeKw ?? '',
      batteryRequired: system?.batteryRequired ?? false,
      propertyType: system?.propertyType ?? '',
      roofType: system?.roofType ?? '',
      houseStorey: system?.houseStorey ?? '',
      phase: system?.phase ?? '',
      quarterlyBillAud: system?.quarterlyBillAud ?? '',
      existingSystemDetails: system?.existingSystemDetails ?? '',
    },
  });
  const { control } = form;
  const panelCount = Number(useWatch({ control, name: 'panelCount' }) ?? 0);
  const batteryRequired = useWatch({ control, name: 'batteryRequired' }) === true;
  const suggestedKw = panelWatts && panelCount > 0 ? systemSizeKw(panelCount, panelWatts) : null;

  // The inverter lines drive the system size (their total capacity).
  const inverterControl = control as unknown as Control<InverterFields>;
  const savedInverters = system?.inverters ?? [];
  const inverters = useInverterLines(inverterControl, savedInverters);
  const calculatedKw = inverters.calculatedKw;

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await update.mutateAsync({ id: lead.id, values });
      await refresh();
      toast({ title: 'System requirements saved', tone: 'success' });
      onDone();
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  const optionSelect = (key: 'roofTypes' | 'houseStoreys' | 'phases') =>
    function OptionSelect(
      field: { name: string; value: unknown; onChange: (v: string) => void },
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
          options={[{ value: NONE, label: '—' }, ...options.options(key)]}
        />
      );
    };

  const hardwareRow = (
    kind: HardwareKind,
    idName: 'panelId' | 'batteryId',
    countName: 'panelCount' | 'batteryCount',
    label: string,
    initial: HardwareOption | null,
  ) => (
    <>
      <FormField control={control} name={idName} label={label} className="sm:col-span-3">
        {(field, props) => (
          <HardwarePicker
            kind={kind}
            props={props}
            value={field.value ?? null}
            initial={initial}
            onChange={(option) => {
              field.onChange(option?.id ?? null);
              if (kind === 'panel') setPanelWatts(option?.spec.replace(' W', '') ?? null);
              if (kind === 'battery' && option) form.setValue('batteryRequired', true);
            }}
          />
        )}
      </FormField>
      <FormField control={control} name={countName} label="How many">
        {(field, props) => (
          <Input
            {...props}
            name={field.name}
            value={field.value === null || field.value === undefined ? '' : String(field.value)}
            onChange={(event) => {
              field.onChange(event.target.value);
            }}
            onBlur={field.onBlur}
            inputMode="numeric"
          />
        )}
      </FormField>
    </>
  );

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="contents">
      <DialogBody className="grid gap-4 sm:grid-cols-4">
        {serverError && (
          <Alert tone="danger" className="sm:col-span-4">
            {serverError}
          </Alert>
        )}
        {hardwareRow('panel', 'panelId', 'panelCount', 'Panels', system?.panel ?? null)}
        <InverterLinesEditor control={inverterControl} lines={inverters} saved={savedInverters} />
        {hardwareRow('battery', 'batteryId', 'batteryCount', 'Battery', system?.battery ?? null)}
        <FormField
          control={control}
          name="systemSizeKw"
          label="System size (kW)"
          hint={
            calculatedKw
              ? 'Calculated from the inverters above.'
              : suggestedKw
                ? `${suggestedKw} kW from the panels — leave empty to use it.`
                : undefined
          }
          className="sm:col-span-2"
        >
          {(field, props) => (
            <Input
              {...props}
              {...textInput(field)}
              {...(calculatedKw ? { value: calculatedKw, readOnly: true } : {})}
              inputMode="decimal"
              placeholder={suggestedKw ?? ''}
            />
          )}
        </FormField>
        <FormField
          control={control}
          name="quarterlyBillAud"
          label="Quarterly bill"
          className="sm:col-span-2"
        >
          {(field, props) => (
            <Input {...props} {...textInput(field)} inputMode="decimal" placeholder="$" />
          )}
        </FormField>
        <label className="flex items-center gap-2 text-sm sm:col-span-4">
          <Checkbox
            checked={batteryRequired}
            onCheckedChange={(checked) => {
              form.setValue('batteryRequired', checked === true);
            }}
          />
          Customer wants a battery
        </label>
        <FormField control={control} name="roofType" label="Roof" className="sm:col-span-2">
          {optionSelect('roofTypes')}
        </FormField>
        <FormField control={control} name="houseStorey" label="Storeys">
          {optionSelect('houseStoreys')}
        </FormField>
        <FormField control={control} name="phase" label="Phase">
          {optionSelect('phases')}
        </FormField>
        <FormField
          control={control}
          name="propertyType"
          label="Property"
          hint="e.g. House, Townhouse, Farm"
          className="sm:col-span-4"
        >
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
        <FormField
          control={control}
          name="existingSystemDetails"
          label="Existing system"
          className="sm:col-span-4"
        >
          {(field, props) => (
            <Textarea
              {...props}
              {...textInput(field)}
              rows={2}
              placeholder="e.g. 5 kW from 2012, inverter failing"
            />
          )}
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

function hardwareLine(count: number | null, option: HardwareOption | null) {
  if (!option) return null;
  return `${count ? `${String(count)} × ` : ''}${option.label} (${option.spec})`;
}

export function SystemCard({ lead, editable }: { lead: Lead; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const system = lead.system;
  return (
    <>
      <SectionCard
        title="System requirements"
        editable={editable}
        onEdit={() => {
          setEditing(true);
        }}
      >
        {system ? (
          <DetailList
            items={[
              { label: 'Panels', value: hardwareLine(system.panelCount, system.panel) },
              ...system.inverters.map((row, index) => ({
                label: system.inverters.length > 1 ? `Inverter ${String(index + 1)}` : 'Inverter',
                value: row.inverter
                  ? `${hardwareLine(row.count, row.inverter) ?? ''} · ${INVERTER_TYPE_LABELS[row.type]}`
                  : null,
              })),
              {
                label: 'Battery',
                value:
                  hardwareLine(system.batteryCount, system.battery) ??
                  (system.batteryRequired ? 'Wanted — model not chosen' : null),
              },
              { label: 'System size', value: system.systemSizeKw && `${system.systemSizeKw} kW` },
              {
                label: 'Property',
                value: [system.propertyType, system.roofType, system.houseStorey, system.phase]
                  .filter(Boolean)
                  .join(' · '),
              },
              { label: 'Quarterly bill', value: formatAud(system.quarterlyBillAud) },
              { label: 'Existing', value: system.existingSystemDetails },
            ]}
          />
        ) : (
          <p className="py-3 text-sm text-fg-muted">Not recorded yet.</p>
        )}
      </SectionCard>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent
          title="System requirements"
          description="Choose hardware from the catalog. The size is worked out from the panels if you leave it empty."
          className="max-w-2xl"
        >
          <SystemForm
            lead={lead}
            onDone={() => {
              setEditing(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Pricing & deposit ─────────────────────────────────────────────────────

function PricingForm({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const trpc = useTRPC();
  const refresh = useSaveLead();
  const update = useMutation(trpc.leads.updatePricing.mutationOptions());
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<LeadPricingInput, unknown, LeadPricingValues>({
    resolver: zodResolver(leadPricingSchema),
    defaultValues: {
      systemPriceAud: lead.pricing?.systemPriceAud ?? '',
      sellingPriceAud: lead.pricing?.sellingPriceAud ?? '',
      depositAud: lead.pricing?.depositAud ?? '',
      depositReceivedDate: lead.pricing?.depositReceivedDate ?? '',
    },
  });
  const { control } = form;

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await update.mutateAsync({ id: lead.id, values });
      await refresh();
      toast({ title: 'Pricing saved', tone: 'success' });
      onDone();
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  const money = (
    name: 'systemPriceAud' | 'sellingPriceAud' | 'depositAud',
    label: string,
    hint?: string,
  ) => (
    <FormField control={control} name={name} label={label} hint={hint}>
      {(field, props) => (
        <Input {...props} {...textInput(field)} inputMode="decimal" placeholder="$" />
      )}
    </FormField>
  );

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="contents">
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        {serverError && (
          <Alert tone="danger" className="sm:col-span-2">
            {serverError}
          </Alert>
        )}
        {money('systemPriceAud', 'System price', 'Before rebates')}
        {money('sellingPriceAud', 'Selling price', 'After rebates — what the customer pays')}
        {money('depositAud', 'Deposit')}
        <FormField control={control} name="depositReceivedDate" label="Deposit received">
          {(field, props) => (
            <DateInput
              {...props}
              value={typeof field.value === 'string' ? field.value : ''}
              onChange={field.onChange}
            />
          )}
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

const DEPOSIT_STEP = LEAD_PIPELINE.indexOf('Deposit Received');

export function PricingCard({ lead, editable }: { lead: Lead; editable: boolean }) {
  const trpc = useTRPC();
  const refresh = useSaveLead();
  const setStatus = useMutation(trpc.leads.setStatus.mutationOptions());
  const [editing, setEditing] = useState(false);
  const pricing = lead.pricing;
  const step = LEAD_PIPELINE.findIndex((status) => status === lead.status);
  const suggestDeposit =
    editable && Boolean(pricing?.depositReceivedDate) && step >= 0 && step < DEPOSIT_STEP;

  return (
    <>
      <SectionCard
        title="Pricing & deposit"
        editable={editable}
        onEdit={() => {
          setEditing(true);
        }}
      >
        {pricing ? (
          <DetailList
            items={[
              { label: 'System price', value: formatAud(pricing.systemPriceAud) },
              { label: 'Selling price', value: formatAud(pricing.sellingPriceAud) },
              { label: 'Deposit', value: formatAud(pricing.depositAud) },
              {
                label: 'Received',
                value: pricing.depositReceivedDate && formatDate(pricing.depositReceivedDate),
              },
            ]}
          />
        ) : (
          <p className="py-3 text-sm text-fg-muted">No pricing yet.</p>
        )}
        {suggestDeposit && (
          <div className="border-t border-line py-3">
            <Button
              size="sm"
              variant="primary"
              loading={setStatus.isPending}
              onClick={() => {
                setStatus
                  .mutateAsync({ id: lead.id, status: 'Deposit Received' })
                  .then(refresh)
                  .then(() => {
                    toast({ title: 'Moved to Deposit Received', tone: 'success' });
                  })
                  .catch((error: unknown) => {
                    toast({
                      title: 'Nothing was changed',
                      description: errorMessage(error),
                      tone: 'danger',
                    });
                  });
              }}
            >
              Move lead to Deposit Received
            </Button>
          </div>
        )}
      </SectionCard>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="Pricing & deposit" className="max-w-lg">
          <PricingForm
            lead={lead}
            onDone={() => {
              setEditing(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
