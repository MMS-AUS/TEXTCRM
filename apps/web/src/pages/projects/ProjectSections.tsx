import { zodResolver } from '@hookform/resolvers/zod';
import {
  AU_STATES,
  formatAud,
  projectPricingSchema,
  projectSiteSchema,
  projectSystemSchema,
  stateForPostcode,
  systemSizeKw,
  type ProjectPricingInput,
  type ProjectPricingValues,
  type ProjectSiteInput,
  type ProjectSiteValues,
  type ProjectSystemInput,
  type ProjectSystemValues,
} from '@mms/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch, type Control, type FieldPath } from 'react-hook-form';
import { DetailList } from '../../components/DetailList.tsx';
import {
  HardwarePicker,
  type HardwareKind,
  type HardwareOption,
} from '../../components/HardwarePicker.tsx';
import { formatDate } from '../../lib/format.ts';
import { useOptions } from '../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Alert,
  Badge,
  DateInput,
  Dialog,
  DialogBody,
  DialogContent,
  FormField,
  Input,
  Select,
  Textarea,
  textInput,
} from '../../ui/index.ts';
import { FormFooter, SectionCard } from './SectionForm.tsx';
import { useProjectSave } from './use-project-save.ts';

type Project = RouterOutputs['projects']['get'];
const NONE = '__none';

// ── Customer & site ───────────────────────────────────────────────────────

function OptionSelectField<T extends Record<string, unknown>>({
  control,
  name,
  label,
  options,
  className,
}: {
  control: Control<T, unknown, unknown>;
  name: FieldPath<T>;
  label: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <FormField control={control} name={name} label={label} className={className}>
      {(field, props) => (
        <Select
          {...props}
          name={field.name}
          value={typeof field.value === 'string' && field.value ? field.value : NONE}
          onValueChange={(value) => {
            field.onChange(value === NONE ? '' : value);
          }}
          options={[{ value: NONE, label: '—' }, ...options]}
        />
      )}
    </FormField>
  );
}

function SiteForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.updateSite.mutationOptions());
  const options = useOptions(['roofTypes', 'houseStoreys', 'phases']);
  const save = useProjectSave('Site saved', onDone);
  const form = useForm<ProjectSiteInput, unknown, ProjectSiteValues>({
    resolver: zodResolver(projectSiteSchema),
    defaultValues: {
      title: project.title ?? '',
      streetAddress: project.streetAddress,
      suburb: project.suburb,
      state: AU_STATES.find((s) => s === project.state),
      postcode: project.postcode ?? '',
      houseStorey: project.houseStorey ?? '',
      roofType: project.roofType ?? '',
      phase: project.phase ?? '',
      existingSystemDetails: project.existingSystemDetails ?? '',
      managerRenteeFirstName: project.managerRenteeFirstName ?? '',
      managerRenteeLastName: project.managerRenteeLastName ?? '',
      nmi: project.nmi ?? '',
      saleDate: project.saleDate ?? '',
      notes: project.notes ?? '',
    },
  });
  const { control } = form;
  const submit = form.handleSubmit((values) =>
    save.run(() => update.mutateAsync({ id: project.id, values })),
  );

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="contents">
      <DialogBody className="grid gap-4 sm:grid-cols-4">
        {save.error && (
          <Alert tone="danger" className="sm:col-span-4">
            {save.error}
          </Alert>
        )}
        <FormField control={control} name="title" label="Job title" className="sm:col-span-4">
          {(field, props) => (
            <Input {...props} {...textInput(field)} placeholder="e.g. 10 kW solar + battery" />
          )}
        </FormField>
        <FormField
          control={control}
          name="streetAddress"
          label="Street address"
          required
          className="sm:col-span-4"
        >
          {(field, props) => <Input {...props} {...textInput(field)} />}
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
                const state = stateForPostcode(event.target.value);
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
              options={AU_STATES.map((s) => ({ value: s, label: s }))}
              placeholder="State"
            />
          )}
        </FormField>
        <OptionSelectField
          control={control}
          name="roofType"
          label="Roof"
          options={options.options('roofTypes')}
          className="sm:col-span-2"
        />
        <OptionSelectField
          control={control}
          name="houseStorey"
          label="Storeys"
          options={options.options('houseStoreys')}
        />
        <OptionSelectField
          control={control}
          name="phase"
          label="Phase"
          options={options.options('phases')}
        />
        <FormField
          control={control}
          name="nmi"
          label="NMI"
          hint="10–11 characters, from the bill"
          className="sm:col-span-2"
        >
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
        <FormField control={control} name="saleDate" label="Sale date" className="sm:col-span-2">
          {(field, props) => (
            <DateInput
              {...props}
              value={typeof field.value === 'string' ? field.value : ''}
              onChange={field.onChange}
            />
          )}
        </FormField>
        <FormField
          control={control}
          name="managerRenteeFirstName"
          label="Tenant / manager first name"
          className="sm:col-span-2"
        >
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
        <FormField
          control={control}
          name="managerRenteeLastName"
          label="Last name"
          className="sm:col-span-2"
        >
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
        <FormField
          control={control}
          name="existingSystemDetails"
          label="Existing system"
          className="sm:col-span-4"
        >
          {(field, props) => <Textarea {...props} {...textInput(field)} rows={2} />}
        </FormField>
        <FormField control={control} name="notes" label="Notes" className="sm:col-span-4">
          {(field, props) => <Textarea {...props} {...textInput(field)} rows={3} />}
        </FormField>
      </DialogBody>
      <FormFooter onCancel={onDone} saving={form.formState.isSubmitting} />
    </form>
  );
}

export function SiteCard({ project, editable }: { project: Project; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const tenant = [project.managerRenteeFirstName, project.managerRenteeLastName]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <SectionCard
        title="Customer & site"
        editable={editable}
        onEdit={() => {
          setEditing(true);
        }}
      >
        <DetailList
          items={[
            {
              label: 'Site',
              value: (
                <span className="flex flex-col gap-1.5">
                  {[
                    project.streetAddress,
                    `${project.suburb} ${project.state} ${project.postcode ?? ''}`,
                  ].join(', ')}
                  <span className="flex flex-wrap gap-1.5">
                    {project.area && <Badge>{project.area}</Badge>}
                    {project.nearestBigCity && <Badge>Near {project.nearestBigCity}</Badge>}
                  </span>
                </span>
              ),
            },
            {
              label: 'Property',
              value: [project.roofType, project.houseStorey, project.phase]
                .filter(Boolean)
                .join(' · '),
            },
            { label: 'NMI', value: project.nmi },
            { label: 'Tenant / manager', value: tenant },
            { label: 'Existing', value: project.existingSystemDetails },
            { label: 'Sold', value: formatDate(project.saleDate) },
          ]}
        />
        {project.notes && (
          <div className="border-t border-line py-3 text-sm">
            <p className="text-fg-muted">Notes</p>
            <p className="mt-1 whitespace-pre-wrap">{project.notes}</p>
          </div>
        )}
      </SectionCard>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="Customer & site" className="max-w-2xl">
          <SiteForm
            project={project}
            onDone={() => {
              setEditing(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── System design ─────────────────────────────────────────────────────────

function SystemForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.updateSystem.mutationOptions());
  const save = useProjectSave('System design saved', onDone);
  const system = project.system;
  const [panelWatts, setPanelWatts] = useState(system?.panel?.spec.replace(' W', '') ?? null);
  const form = useForm<ProjectSystemInput, unknown, ProjectSystemValues>({
    resolver: zodResolver(projectSystemSchema),
    defaultValues: {
      systemSizeKw: system?.systemSizeKw ?? '',
      panelId: system?.panelId ?? null,
      panelCount: system?.panelCount ?? '',
      inverterId: system?.inverterId ?? null,
      inverterCount: system?.inverterCount ?? '',
      batteryId: system?.batteryId ?? null,
      batteryCount: system?.batteryCount ?? '',
    },
  });
  const { control } = form;
  const panelCount = Number(useWatch({ control, name: 'panelCount' }) ?? 0);
  const suggested = panelWatts && panelCount > 0 ? systemSizeKw(panelCount, panelWatts) : null;
  const submit = form.handleSubmit((values) =>
    save.run(() => update.mutateAsync({ id: project.id, values })),
  );

  const row = (
    kind: HardwareKind,
    idName: 'panelId' | 'inverterId' | 'batteryId',
    countName: 'panelCount' | 'inverterCount' | 'batteryCount',
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
        {save.error && (
          <Alert tone="danger" className="sm:col-span-4">
            {save.error}
          </Alert>
        )}
        {row('panel', 'panelId', 'panelCount', 'Panels', system?.panel ?? null)}
        {row('inverter', 'inverterId', 'inverterCount', 'Inverter', system?.inverter ?? null)}
        {row('battery', 'batteryId', 'batteryCount', 'Battery', system?.battery ?? null)}
        <FormField
          control={control}
          name="systemSizeKw"
          label="System size (kW)"
          hint={suggested ? `${suggested} kW from the panels — leave empty to use it.` : undefined}
          className="sm:col-span-2"
        >
          {(field, props) => (
            <Input
              {...props}
              {...textInput(field)}
              inputMode="decimal"
              placeholder={suggested ?? ''}
            />
          )}
        </FormField>
      </DialogBody>
      <FormFooter onCancel={onDone} saving={form.formState.isSubmitting} />
    </form>
  );
}

function hardwareLine(count: number | null, option: HardwareOption | null) {
  if (!option) return null;
  return `${count ? `${String(count)} × ` : ''}${option.label} (${option.spec})`;
}

export function SystemDesignCard({ project, editable }: { project: Project; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const system = project.system;
  return (
    <>
      <SectionCard
        title="System design"
        editable={editable}
        onEdit={() => {
          setEditing(true);
        }}
      >
        {system ? (
          <DetailList
            items={[
              { label: 'Panels', value: hardwareLine(system.panelCount, system.panel) },
              { label: 'Inverter', value: hardwareLine(system.inverterCount, system.inverter) },
              { label: 'Battery', value: hardwareLine(system.batteryCount, system.battery) },
              { label: 'System size', value: system.systemSizeKw && `${system.systemSizeKw} kW` },
            ]}
          />
        ) : (
          <p className="py-3 text-sm text-fg-muted">Not designed yet.</p>
        )}
      </SectionCard>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="System design" className="max-w-2xl">
          <SystemForm
            project={project}
            onDone={() => {
              setEditing(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Pricing & payments ────────────────────────────────────────────────────

function PricingForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.updatePricing.mutationOptions());
  const save = useProjectSave('Pricing saved', onDone);
  const pricing = project.pricing;
  const form = useForm<ProjectPricingInput, unknown, ProjectPricingValues>({
    resolver: zodResolver(projectPricingSchema),
    defaultValues: {
      systemPriceAud: pricing?.systemPriceAud ?? '',
      sellingPriceAud: pricing?.sellingPriceAud ?? '',
      contractValueAud: pricing?.contractValueAud ?? '',
      depositAud: pricing?.depositAud ?? '',
      depositReceivedDate: pricing?.depositReceivedDate ?? '',
      balanceDueDate: pricing?.balanceDueDate ?? '',
      customerInvoiceNumber: pricing?.customerInvoiceNumber ?? '',
    },
  });
  const { control } = form;
  const submit = form.handleSubmit((values) =>
    save.run(() => update.mutateAsync({ id: project.id, values })),
  );
  const money = (
    name: 'systemPriceAud' | 'sellingPriceAud' | 'contractValueAud' | 'depositAud',
    label: string,
    hint?: string,
  ) => (
    <FormField control={control} name={name} label={label} hint={hint}>
      {(field, props) => (
        <Input {...props} {...textInput(field)} inputMode="decimal" placeholder="$" />
      )}
    </FormField>
  );
  const date = (name: 'depositReceivedDate' | 'balanceDueDate', label: string) => (
    <FormField control={control} name={name} label={label}>
      {(field, props) => (
        <DateInput
          {...props}
          value={typeof field.value === 'string' ? field.value : ''}
          onChange={field.onChange}
        />
      )}
    </FormField>
  );
  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="contents">
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        {save.error && (
          <Alert tone="danger" className="sm:col-span-2">
            {save.error}
          </Alert>
        )}
        {money('systemPriceAud', 'System price', 'Before rebates')}
        {money('sellingPriceAud', 'Selling price', 'After rebates')}
        {money('contractValueAud', 'Contract value', 'If different from the selling price')}
        {money('depositAud', 'Deposit')}
        {date('depositReceivedDate', 'Deposit received')}
        {date('balanceDueDate', 'Balance due')}
        <FormField
          control={control}
          name="customerInvoiceNumber"
          label="Customer invoice no."
          className="sm:col-span-2"
        >
          {(field, props) => <Input {...props} {...textInput(field)} />}
        </FormField>
      </DialogBody>
      <FormFooter onCancel={onDone} saving={form.formState.isSubmitting} />
    </form>
  );
}

export function PaymentsCard({ project, editable }: { project: Project; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const pricing = project.pricing;
  return (
    <>
      <SectionCard
        title="Pricing & payments"
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
              { label: 'Contract value', value: formatAud(pricing.contractValueAud) },
              {
                label: 'Deposit',
                value:
                  pricing.depositAud &&
                  `${formatAud(pricing.depositAud)}${pricing.depositReceivedDate ? ` · received ${formatDate(pricing.depositReceivedDate)}` : ' · not received'}`,
              },
              {
                label: 'Balance',
                value: pricing.balancePayableAud && (
                  <span className="font-semibold">
                    {formatAud(pricing.balancePayableAud)}
                    {pricing.balanceDueDate && (
                      <span className="font-normal text-fg-muted">
                        {' '}
                        · due {formatDate(pricing.balanceDueDate)}
                      </span>
                    )}
                  </span>
                ),
              },
              { label: 'Invoice', value: pricing.customerInvoiceNumber },
            ]}
          />
        ) : (
          <p className="py-3 text-sm text-fg-muted">No pricing yet.</p>
        )}
      </SectionCard>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent
          title="Pricing & payments"
          description="The balance is worked out from the contract value (or selling price) minus the deposit."
          className="max-w-lg"
        >
          <PricingForm
            project={project}
            onDone={() => {
              setEditing(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
