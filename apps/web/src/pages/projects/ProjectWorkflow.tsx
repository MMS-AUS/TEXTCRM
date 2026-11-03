import { zodResolver } from '@hookform/resolvers/zod';
import {
  ebVerificationSchema,
  EB_CHECKS,
  financeSchema,
  formatAud,
  gridApplicationSchema,
  installationSchema,
  openSolarSchema,
  stcClaimSchema,
  warehouseSchema,
  type EbVerificationInput,
  type EbVerificationValues,
  type FinanceInput,
  type FinanceValues,
  type GridApplicationInput,
  type GridApplicationValues,
  type InstallationInput,
  type InstallationValues,
  type OpenSolarInput,
  type OpenSolarValues,
  type StcClaimInput,
  type StcClaimValues,
  type WarehouseInput,
  type WarehouseValues,
} from '@mms/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleAlert, CircleCheck, CircleDashed, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { DetailList } from '../../components/DetailList.tsx';
import { formatDate } from '../../lib/format.ts';
import { useUsers } from '../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import { Badge, cn } from '../../ui/index.ts';
import { sectionStatusTone } from './project-stage.ts';
import { EditableSection, SectionForm, type FieldSpec } from './SectionForm.tsx';

// Step 2.7: the job's sections after the sale, in the order the work happens (§1.1).

type Project = RouterOutputs['projects']['get'];
type CardProps = { project: Project; editable: boolean };

const NOT_STARTED = <p className="py-3 text-sm text-fg-muted">Not started.</p>;

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <Badge tone={sectionStatusTone(status)} dot>
      {status}
    </Badge>
  );
}

/** "$1,200.00 · 3 Oct 2026" from the parts that exist. */
const joined = (...parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(' · ') || null;

const money = (value: string | null | undefined) => (value ? formatAud(value) : null);
const day = (value: string | null | undefined) => (value ? formatDate(value) : null);

/** Shown where a value will come from an integration that isn't connected yet. */
function NotConnected({ children }: { children: ReactNode }) {
  return <span className="text-fg-subtle">{children}</span>;
}

// ── EB verification ──────────────────────────────────────────────────────

const CHECK_ICONS = {
  passed: <CircleCheck className="size-4 text-success-text" aria-label="Passed" />,
  attention: <CircleAlert className="size-4 text-warning-text" aria-label="Needs attention" />,
  unanswered: <CircleDashed className="size-4 text-fg-subtle" aria-label="Not checked" />,
} as const;

const EB_FIELDS: FieldSpec<EbVerificationInput>[] = [
  ...EB_CHECKS.map((check): FieldSpec<EbVerificationInput> => ({
    name: check.key,
    label: check.label,
    kind: 'option',
    list: check.list,
    hint: check.key === 'meterPhase' ? "Compared with the site's phase" : undefined,
  })),
  { heading: 'Documents' },
  {
    name: 'docsReceived',
    label: 'Documents received',
    kind: 'option',
    list: 'docsReceivedOptions',
  },
  { name: 'docsReceivedDate', label: 'Received on', kind: 'date' },
];

export function EbVerificationCard({ project, editable }: CardProps) {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.updateEbVerification.mutationOptions());
  const eb = project.eb;
  const passed = project.ebChecks.filter((check) => check.state === 'passed').length;
  const verified = passed === project.ebChecks.length;
  return (
    <EditableSection
      title="EB verification"
      badge={
        <Badge tone={verified ? 'success' : passed > 0 ? 'warning' : 'neutral'} dot>
          {verified ? 'Verified' : `${String(passed)} of ${String(project.ebChecks.length)} passed`}
        </Badge>
      }
      editable={editable}
      description="Check the electricity bill against the job. The meter phase is compared with the site's phase."
      form={(close) => (
        <SectionForm<EbVerificationInput, EbVerificationValues>
          resolver={zodResolver(ebVerificationSchema)}
          defaultValues={{
            customerNameMatch: eb?.customerNameMatch ?? '',
            addressMatch: eb?.addressMatch ?? '',
            meterMatch: eb?.meterMatch ?? '',
            meterPhase: eb?.meterPhase ?? '',
            openSolarSystemMatch: eb?.openSolarSystemMatch ?? '',
            openSolarPricingMatch: eb?.openSolarPricingMatch ?? '',
            docsReceived: eb?.docsReceived ?? '',
            docsReceivedDate: eb?.docsReceivedDate ?? '',
          }}
          fields={EB_FIELDS}
          submit={(values) => update.mutateAsync({ id: project.id, values })}
          success="EB verification saved"
          onDone={close}
        />
      )}
    >
      <ul aria-label="Bill checks" className="flex flex-col divide-y divide-line">
        {project.ebChecks.map((check) => (
          <li key={check.key} className="flex items-start gap-2.5 py-2.5 text-sm">
            <span className="mt-0.5 shrink-0">{CHECK_ICONS[check.state]}</span>
            <span className="min-w-0 flex-1">
              {check.label}
              {check.note && <span className="block text-xs text-fg-muted">{check.note}</span>}
            </span>
            <span className={cn('shrink-0', check.answer ? 'text-fg' : 'text-fg-subtle')}>
              {check.answer ?? '—'}
            </span>
          </li>
        ))}
      </ul>
      <DetailList
        items={[
          {
            label: 'Documents',
            value: joined(
              eb?.docsReceived,
              eb?.docsReceivedDate && `received ${formatDate(eb.docsReceivedDate)}`,
            ),
          },
          {
            label: 'Verified',
            value:
              verified && eb?.verifiedAt
                ? joined(eb.verifiedByName, formatDate(eb.verifiedAt))
                : null,
          },
        ]}
      />
    </EditableSection>
  );
}

// ── Grid application ─────────────────────────────────────────────────────

const GRID_FIELDS: FieldSpec<GridApplicationInput>[] = [
  {
    name: 'electricityDistributor',
    label: 'DNSP',
    kind: 'option',
    list: 'electricityDistributors',
  },
  { name: 'applicationRef', label: 'Application ref.', kind: 'text' },
  { name: 'status', label: 'Status', kind: 'option', list: 'gridApplicationStatuses' },
  { name: 'appliedDate', label: 'Applied', kind: 'date' },
  { name: 'approvalDate', label: 'Approved', kind: 'date' },
  { name: 'rejectedDate', label: 'Rejected', kind: 'date' },
  { heading: 'Energy retailer' },
  { name: 'energyRetailer', label: 'Retailer', kind: 'option', list: 'energyRetailers' },
  { name: 'retailerRef', label: 'Retailer ref.', kind: 'text' },
];

export function GridApplicationCard({ project, editable }: CardProps) {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.updateGridApplication.mutationOptions());
  const grid = project.grid;
  const timing = grid?.timing;
  return (
    <EditableSection
      title="Grid application"
      badge={<StatusBadge status={grid?.status} />}
      editable={editable}
      form={(close) => (
        <SectionForm<GridApplicationInput, GridApplicationValues>
          resolver={zodResolver(gridApplicationSchema)}
          defaultValues={{
            electricityDistributor: grid?.electricityDistributor ?? '',
            applicationRef: grid?.applicationRef ?? '',
            status: grid?.status ?? '',
            appliedDate: grid?.appliedDate ?? '',
            approvalDate: grid?.approvalDate ?? '',
            rejectedDate: grid?.rejectedDate ?? '',
            energyRetailer: grid?.energyRetailer ?? '',
            retailerRef: grid?.retailerRef ?? '',
          }}
          fields={GRID_FIELDS}
          submit={(values) => update.mutateAsync({ id: project.id, values })}
          success="Grid application saved"
          onDone={close}
        />
      )}
    >
      {grid ? (
        <DetailList
          items={[
            { label: 'DNSP', value: grid.electricityDistributor },
            { label: 'Reference', value: grid.applicationRef },
            { label: 'Applied', value: day(grid.appliedDate) },
            {
              label: 'Decision',
              value: timing
                ? grid.approvalDate
                  ? `Approved ${formatDate(grid.approvalDate)} · took ${String(timing.days)} days`
                  : grid.rejectedDate
                    ? `Rejected ${formatDate(grid.rejectedDate)} · after ${String(timing.days)} days`
                    : `Waiting ${String(timing.days)} days`
                : null,
            },
            { label: 'Retailer', value: joined(grid.energyRetailer, grid.retailerRef) },
          ]}
        />
      ) : (
        NOT_STARTED
      )}
    </EditableSection>
  );
}

// ── Finance ──────────────────────────────────────────────────────────────

const FINANCE_FIELDS: FieldSpec<FinanceInput>[] = [
  {
    name: 'financeOption',
    label: 'On finance?',
    kind: 'option',
    list: 'isFinanceOptions',
    wide: true,
  },
  { name: 'financeCompany', label: 'Finance company', kind: 'option', list: 'financeCompanies' },
  { name: 'status', label: 'Status', kind: 'option', list: 'financeStatuses' },
  { name: 'appliedDate', label: 'Applied', kind: 'date' },
  { name: 'approvedDate', label: 'Approved', kind: 'date' },
  {
    name: 'approvedAmountAud',
    label: 'Approved amount',
    kind: 'money',
    hint: "Up to the job's price",
  },
];

export function FinanceCard({ project, editable }: CardProps) {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.updateFinance.mutationOptions());
  const finance = project.finance;
  return (
    <EditableSection
      title="Finance"
      badge={
        finance && !finance.onFinance ? (
          <Badge>Cash</Badge>
        ) : (
          <StatusBadge status={finance?.status} />
        )
      }
      editable={editable}
      form={(close) => (
        <SectionForm<FinanceInput, FinanceValues>
          resolver={zodResolver(financeSchema)}
          defaultValues={{
            financeOption: finance?.financeOption ?? '',
            financeCompany: finance?.financeCompany ?? '',
            status: finance?.status ?? '',
            appliedDate: finance?.appliedDate ?? '',
            approvedDate: finance?.approvedDate ?? '',
            approvedAmountAud: finance?.approvedAmountAud ?? '',
          }}
          fields={FINANCE_FIELDS}
          submit={(values) => update.mutateAsync({ id: project.id, values })}
          success="Finance saved"
          onDone={close}
        />
      )}
    >
      {finance ? (
        <DetailList
          items={[
            { label: 'Finance', value: finance.financeOption },
            ...(finance.onFinance
              ? [
                  { label: 'Company', value: finance.financeCompany },
                  { label: 'Applied', value: day(finance.appliedDate) },
                  {
                    label: 'Approved',
                    value: joined(money(finance.approvedAmountAud), day(finance.approvedDate)),
                  },
                ]
              : []),
          ]}
        />
      ) : (
        NOT_STARTED
      )}
    </EditableSection>
  );
}

// ── Warehouse & stock ────────────────────────────────────────────────────

const WAREHOUSE_FIELDS: FieldSpec<WarehouseInput>[] = [
  { name: 'warehouse', label: 'Warehouse', kind: 'option', list: 'warehouses' },
  { name: 'salesOrderNumber', label: 'Sales order no.', kind: 'text' },
  { name: 'stockStatus', label: 'Stock status', kind: 'option', list: 'stockStatuses' },
  {
    name: 'stockUsedProject',
    label: 'Stock note',
    kind: 'text',
    hint: 'e.g. stock taken from another job',
  },
  { heading: 'Warehouse invoice' },
  { name: 'invoiceNumber', label: 'Invoice no.', kind: 'text' },
  { name: 'invoiceDate', label: 'Invoice date', kind: 'date' },
  { name: 'invoiceAmountAud', label: 'Amount', kind: 'money' },
  { name: 'invoiceStatus', label: 'Status', kind: 'option', list: 'warehouseInvoiceStatuses' },
  { name: 'invoicePaidDate', label: 'Paid on', kind: 'date' },
];

export function WarehouseCard({ project, editable }: CardProps) {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.updateWarehouse.mutationOptions());
  const warehouse = project.warehouse;
  return (
    <EditableSection
      title="Warehouse & stock"
      badge={<StatusBadge status={warehouse?.stockStatus} />}
      editable={editable}
      form={(close) => (
        <SectionForm<WarehouseInput, WarehouseValues>
          resolver={zodResolver(warehouseSchema)}
          defaultValues={{
            warehouse: warehouse?.warehouse ?? '',
            salesOrderNumber: warehouse?.salesOrderNumber ?? '',
            stockStatus: warehouse?.stockStatus ?? '',
            stockUsedProject: warehouse?.stockUsedProject ?? '',
            invoiceNumber: warehouse?.invoiceNumber ?? '',
            invoiceDate: warehouse?.invoiceDate ?? '',
            invoiceAmountAud: warehouse?.invoiceAmountAud ?? '',
            invoiceStatus: warehouse?.invoiceStatus ?? '',
            invoicePaidDate: warehouse?.invoicePaidDate ?? '',
          }}
          fields={WAREHOUSE_FIELDS}
          submit={(values) => update.mutateAsync({ id: project.id, values })}
          success="Warehouse saved"
          onDone={close}
        />
      )}
    >
      {warehouse ? (
        <DetailList
          items={[
            { label: 'Warehouse', value: warehouse.warehouse },
            { label: 'Sales order', value: warehouse.salesOrderNumber },
            { label: 'Stock note', value: warehouse.stockUsedProject },
            {
              label: 'Invoice',
              value: joined(
                warehouse.invoiceNumber,
                money(warehouse.invoiceAmountAud),
                day(warehouse.invoiceDate),
              ),
            },
            {
              label: 'Invoice status',
              value: joined(
                warehouse.invoiceStatus,
                warehouse.invoicePaidDate && `paid ${formatDate(warehouse.invoicePaidDate)}`,
              ),
            },
          ]}
        />
      ) : (
        NOT_STARTED
      )}
    </EditableSection>
  );
}

// ── Installation ─────────────────────────────────────────────────────────

export function InstallationCard({ project, editable }: CardProps) {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.updateInstallation.mutationOptions());
  const installers = useQuery(trpc.projects.installers.queryOptions());
  const users = useUsers();
  const install = project.installation;

  const installerChoices = (installers.data ?? []).map((c) => ({ value: c.id, label: c.name }));
  if (
    install?.installerCompanyId &&
    !installerChoices.some((c) => c.value === install.installerCompanyId)
  ) {
    installerChoices.push({
      value: install.installerCompanyId,
      label: `${install.installerName ?? 'Installer'} (archived)`,
    });
  }
  const userChoices = (users.data ?? []).map((u) => ({ value: u.id, label: u.name }));
  if (install?.bookedByUserId && !userChoices.some((u) => u.value === install.bookedByUserId)) {
    userChoices.push({
      value: install.bookedByUserId,
      label: `${install.bookedByName ?? 'Former user'} (inactive)`,
    });
  }

  const fields: FieldSpec<InstallationInput>[] = [
    { name: 'status', label: 'Status', kind: 'option', list: 'installationStatuses' },
    {
      name: 'installerCompanyId',
      label: 'Installer',
      kind: 'choice',
      choices: installerChoices,
      hint: 'Companies of type Subcontractor Installer',
    },
    { name: 'installerQuotedAud', label: 'Installer quote', kind: 'money' },
    { name: 'bookingDate', label: 'Install date', kind: 'date' },
    { name: 'bookedByUserId', label: 'Booked by', kind: 'choice', choices: userChoices },
    { name: 'completedDate', label: 'Completed on', kind: 'date' },
    { heading: 'Install documents' },
    { name: 'docsStatus', label: 'Documents', kind: 'option', list: 'installationDocsStatuses' },
    { name: 'docsReceivedDate', label: 'Received on', kind: 'date' },
    { heading: 'Installer invoice' },
    { name: 'installerInvoiceNumber', label: 'Invoice no.', kind: 'text' },
    { name: 'installerInvoiceDate', label: 'Invoice date', kind: 'date' },
    { name: 'installerInvoiceAmountAud', label: 'Amount', kind: 'money' },
    {
      name: 'installerInvoiceStatus',
      label: 'Status',
      kind: 'option',
      list: 'installerInvoiceStatuses',
    },
  ];

  return (
    <EditableSection
      title="Installation"
      badge={<StatusBadge status={install?.status} />}
      editable={editable}
      form={(close) => (
        <SectionForm<InstallationInput, InstallationValues>
          resolver={zodResolver(installationSchema)}
          defaultValues={{
            status: install?.status ?? '',
            installerCompanyId: install?.installerCompanyId ?? '',
            installerQuotedAud: install?.installerQuotedAud ?? '',
            bookingDate: install?.bookingDate ?? '',
            bookedByUserId: install?.bookedByUserId ?? '',
            completedDate: install?.completedDate ?? '',
            docsStatus: install?.docsStatus ?? '',
            docsReceivedDate: install?.docsReceivedDate ?? '',
            installerInvoiceNumber: install?.installerInvoiceNumber ?? '',
            installerInvoiceDate: install?.installerInvoiceDate ?? '',
            installerInvoiceAmountAud: install?.installerInvoiceAmountAud ?? '',
            installerInvoiceStatus: install?.installerInvoiceStatus ?? '',
          }}
          fields={fields}
          submit={(values) => update.mutateAsync({ id: project.id, values })}
          success="Installation saved"
          onDone={close}
        />
      )}
    >
      {install ? (
        <DetailList
          items={[
            {
              label: 'Installer',
              value: install.installerCompanyId && (
                <>
                  <Link
                    to="/companies/$companyId"
                    params={{ companyId: install.installerCompanyId }}
                    className="hover:text-accent-text hover:underline"
                  >
                    {install.installerName}
                  </Link>
                  {install.installerQuotedAud && (
                    <span className="text-fg-muted">
                      {' '}
                      · quoted {formatAud(install.installerQuotedAud)}
                    </span>
                  )}
                </>
              ),
            },
            {
              label: 'Install date',
              value: joined(
                day(install.bookingDate),
                install.bookedByName && `booked by ${install.bookedByName}`,
              ),
            },
            {
              label: 'Completed',
              value: joined(day(install.completedDate), install.completedMonth),
            },
            {
              label: 'Documents',
              value: joined(
                install.docsStatus,
                install.docsReceivedDate && `received ${formatDate(install.docsReceivedDate)}`,
              ),
            },
            {
              label: 'Invoice',
              value: joined(
                install.installerInvoiceNumber,
                money(install.installerInvoiceAmountAud),
                day(install.installerInvoiceDate),
                install.installerInvoiceStatus,
              ),
            },
          ]}
        />
      ) : (
        NOT_STARTED
      )}
    </EditableSection>
  );
}

// ── STC claim ────────────────────────────────────────────────────────────

const STC_FIELDS: FieldSpec<StcClaimInput>[] = [
  { name: 'portal', label: 'Portal', kind: 'option', list: 'stcPortals' },
  { name: 'jobNumber', label: 'Portal job no.', kind: 'text' },
  { name: 'status', label: 'Status', kind: 'option', list: 'stcStatuses' },
  { name: 'submittedDate', label: 'Submitted', kind: 'date' },
  { heading: 'Solar STCs' },
  { name: 'solarStcs', label: 'Certificates', kind: 'count' },
  { name: 'solarStcsAmountAud', label: 'Amount', kind: 'money' },
  {
    name: 'solarStcsReceivedDate',
    label: 'Received on',
    kind: 'date',
    hint: 'Counts towards the total received',
  },
  { heading: 'Battery STCs' },
  { name: 'batteryStcs', label: 'Certificates', kind: 'count' },
  { name: 'batteryStcsAmountAud', label: 'Amount', kind: 'money' },
  { name: 'batteryStcsReceivedDate', label: 'Received on', kind: 'date' },
  { heading: 'Rates & charges' },
  { name: 'customerStcRateAud', label: 'Customer rate per STC', kind: 'money' },
  { name: 'internalStcRateAud', label: 'Internal rate per STC', kind: 'money' },
  {
    name: 'adminChargesAud',
    label: 'Admin charges',
    kind: 'money',
    hint: 'Taken off the total received',
  },
];

const stcLine = (count: number | null, amount: string | null, received: string | null) =>
  joined(
    count !== null && `${String(count)} STCs`,
    money(amount),
    amount && (received ? `received ${formatDate(received)}` : 'not received'),
  );

export function StcClaimCard({ project, editable }: CardProps) {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.updateStcClaim.mutationOptions());
  const stc = project.stc;
  const totals = stc?.totals;
  return (
    <EditableSection
      title="STC claim"
      badge={<StatusBadge status={stc?.status} />}
      editable={editable}
      description="Totals are worked out from the amounts that have a received date."
      form={(close) => (
        <SectionForm<StcClaimInput, StcClaimValues>
          resolver={zodResolver(stcClaimSchema)}
          defaultValues={{
            portal: stc?.portal ?? '',
            jobNumber: stc?.jobNumber ?? '',
            status: stc?.status ?? '',
            submittedDate: stc?.submittedDate ?? '',
            solarStcs: stc?.solarStcs ?? '',
            solarStcsAmountAud: stc?.solarStcsAmountAud ?? '',
            solarStcsReceivedDate: stc?.solarStcsReceivedDate ?? '',
            batteryStcs: stc?.batteryStcs ?? '',
            batteryStcsAmountAud: stc?.batteryStcsAmountAud ?? '',
            batteryStcsReceivedDate: stc?.batteryStcsReceivedDate ?? '',
            adminChargesAud: stc?.adminChargesAud ?? '',
            customerStcRateAud: stc?.customerStcRateAud ?? '',
            internalStcRateAud: stc?.internalStcRateAud ?? '',
          }}
          fields={STC_FIELDS}
          submit={(values) => update.mutateAsync({ id: project.id, values })}
          success="STC claim saved"
          onDone={close}
        />
      )}
    >
      {stc && totals ? (
        <DetailList
          items={[
            { label: 'Portal', value: joined(stc.portal, stc.jobNumber) },
            { label: 'Submitted', value: day(stc.submittedDate) },
            {
              label: 'Solar',
              value: stcLine(stc.solarStcs, stc.solarStcsAmountAud, stc.solarStcsReceivedDate),
            },
            {
              label: 'Battery',
              value: stcLine(
                stc.batteryStcs,
                stc.batteryStcsAmountAud,
                stc.batteryStcsReceivedDate,
              ),
            },
            {
              label: 'Total received',
              value: totals.totalReceivedAud && (
                <span className="font-semibold">
                  {formatAud(totals.totalReceivedAud)}
                  {stc.adminChargesAud && totals.netReceivedAud && (
                    <span className="font-normal text-fg-muted">
                      {' '}
                      · {formatAud(totals.netReceivedAud)} after {formatAud(stc.adminChargesAud)}{' '}
                      admin
                    </span>
                  )}
                </span>
              ),
            },
            {
              label: 'Still to come',
              value:
                totals.outstandingAud && Number(totals.outstandingAud) > 0
                  ? formatAud(totals.outstandingAud)
                  : null,
            },
            {
              label: 'STC value',
              value: joined(
                totals.customerValueAud && `customer ${formatAud(totals.customerValueAud)}`,
                totals.internalValueAud && `internal ${formatAud(totals.internalValueAud)}`,
              ),
            },
            {
              label: 'BridgeSelect',
              value: stc.bridgeselectSyncStatus ? (
                joined(stc.bridgeselectSyncStatus, stc.bridgeselectError)
              ) : (
                <NotConnected>Not connected yet (integration in Phase 5)</NotConnected>
              ),
            },
          ]}
        />
      ) : (
        NOT_STARTED
      )}
    </EditableSection>
  );
}

// ── OpenSolar ────────────────────────────────────────────────────────────

const OPENSOLAR_FIELDS: FieldSpec<OpenSolarInput>[] = [
  { name: 'openSolarProjectId', label: 'OpenSolar project ID', kind: 'text' },
  { name: 'proposalId', label: 'Proposal ID', kind: 'text' },
  {
    name: 'signedUrl',
    label: 'Signed proposal link',
    kind: 'text',
    placeholder: 'https://',
    wide: true,
  },
  { name: 'contractSigned', label: 'Contract', kind: 'checkbox', text: 'Signed by the customer' },
  { name: 'contractSignedDate', label: 'Signed on', kind: 'date' },
];

export function OpenSolarCard({ project, editable }: CardProps) {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.updateOpenSolar.mutationOptions());
  const openSolar = project.openSolar;
  return (
    <EditableSection
      title="OpenSolar"
      badge={
        openSolar?.contractSigned ? (
          <Badge tone="success" dot>
            Contract signed
          </Badge>
        ) : null
      }
      editable={editable}
      description="Linked by hand until the OpenSolar integration (Phase 5) syncs it."
      form={(close) => (
        <SectionForm<OpenSolarInput, OpenSolarValues>
          resolver={zodResolver(openSolarSchema)}
          defaultValues={{
            openSolarProjectId: openSolar?.openSolarProjectId ?? '',
            proposalId: openSolar?.proposalId ?? '',
            signedUrl: openSolar?.signedUrl ?? '',
            contractSigned: openSolar?.contractSigned ?? false,
            contractSignedDate: openSolar?.contractSignedDate ?? '',
          }}
          fields={OPENSOLAR_FIELDS}
          submit={(values) => update.mutateAsync({ id: project.id, values })}
          success="OpenSolar saved"
          onDone={close}
        />
      )}
    >
      {openSolar ? (
        <DetailList
          items={[
            { label: 'Project ID', value: openSolar.openSolarProjectId },
            { label: 'Proposal ID', value: openSolar.proposalId },
            {
              label: 'Signed proposal',
              value: openSolar.signedUrl && (
                <a
                  href={openSolar.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent-text hover:underline"
                >
                  Open
                  <ExternalLink className="size-3" />
                </a>
              ),
            },
            {
              label: 'Contract',
              value: openSolar.contractSigned
                ? joined('Signed', day(openSolar.contractSignedDate))
                : 'Not signed',
            },
            {
              label: 'Sync',
              value: openSolar.lastSyncedAt ? (
                `Last synced ${formatDate(openSolar.lastSyncedAt)}`
              ) : (
                <NotConnected>Not connected yet (integration in Phase 5)</NotConnected>
              ),
            },
          ]}
        />
      ) : (
        NOT_STARTED
      )}
    </EditableSection>
  );
}
