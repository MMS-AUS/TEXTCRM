import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatAud,
  HARDWARE_KIND_LABELS,
  installerVisitSchema,
  isTicketClosed,
  TICKET_HARDWARE_KINDS,
  TICKET_TRIAGE_STEPS,
  ticketHardwareSchema,
  ticketTriageSchema,
  warrantyClaimSchema,
  type InstallerVisitInput,
  type InstallerVisitValues,
  type TicketHardwareInput,
  type TicketHardwareValues,
  type TicketTriageInput,
  type TicketTriageValues,
  type WarrantyClaimInput,
  type WarrantyClaimValues,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DetailList } from '../../components/DetailList.tsx';
import { formatDate } from '../../lib/format.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  DialogContent,
  IconButton,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toast,
} from '../../ui/index.ts';
import { EditableSection, SectionForm, type FieldSpec } from '../projects/SectionForm.tsx';
import { ticketStatusTone } from './ticket-labels.ts';

type Ticket = RouterOutputs['tickets']['get'];
type Props = { ticket: Ticket; editable: boolean };

const money = (value: string | null | undefined) => (value ? formatAud(value) : null);
const day = (value: string | null | undefined) => (value ? formatDate(value) : null);
const joined = (...parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(' · ') || null;

// ── Triage: issue recorded → initial check → work required → resolution ──

const TRIAGE_FIELDS: FieldSpec<TicketTriageInput>[] = [
  ...TICKET_TRIAGE_STEPS.map(
    (step) =>
      ({
        name: step.key,
        label: step.label,
        kind: 'option',
        list: step.list,
        wide: true,
      }) as const,
  ),
  { name: 'serviceIssueNotes', label: 'Service notes', kind: 'text', wide: true },
  { heading: 'Resolution' },
  {
    name: 'resolvedDate',
    label: 'Resolved on',
    kind: 'date',
    hint: 'Set automatically to today when you choose a closing status.',
  },
  { name: 'serviceChargeAud', label: 'Service charge', kind: 'money' },
];

export function TriageCard({ ticket, editable }: Props) {
  const trpc = useTRPC();
  const update = useMutation(trpc.tickets.updateTriage.mutationOptions());
  const done = (index: number) => {
    const step = TICKET_TRIAGE_STEPS[index];
    return step ? Boolean(ticket[step.key]) : false;
  };
  return (
    <EditableSection
      title="Triage"
      badge={
        <Badge tone={ticketStatusTone(ticket.resolutionStatus)} dot>
          {ticket.resolutionStatus}
        </Badge>
      }
      editable={editable}
      description="Work through the steps; a closing resolution status closes the ticket."
      form={(close) => (
        <SectionForm<TicketTriageInput, TicketTriageValues>
          resolver={zodResolver(ticketTriageSchema)}
          defaultValues={{
            issueRecorded: ticket.issueRecorded ?? '',
            initialCheck: ticket.initialCheck ?? '',
            workRequired: ticket.workRequired ?? '',
            resolutionStatus: ticket.resolutionStatus,
            serviceIssueNotes: ticket.serviceIssueNotes ?? '',
            resolvedDate: ticket.resolvedDate ?? '',
            serviceChargeAud: ticket.serviceChargeAud ?? '',
          }}
          fields={TRIAGE_FIELDS}
          submit={(values) => update.mutateAsync({ id: ticket.id, values })}
          success="Triage saved"
          onDone={close}
        />
      )}
    >
      <ol aria-label="Triage steps" className="flex flex-col gap-0 py-2">
        {TICKET_TRIAGE_STEPS.map((step, index) => {
          const value = ticket[step.key];
          const complete = step.key === 'resolutionStatus' ? isTicketClosed(value) : Boolean(value);
          return (
            <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
              {index < TICKET_TRIAGE_STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-6 left-[11px] h-[calc(100%-1rem)] w-px',
                    done(index) ? 'bg-accent' : 'bg-line',
                  )}
                />
              )}
              <span
                className={cn(
                  'relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                  complete
                    ? 'bg-accent text-accent-fg'
                    : value
                      ? 'bg-accent-subtle text-accent-text inset-ring inset-ring-accent/30'
                      : 'bg-surface-2 text-fg-subtle inset-ring inset-ring-line',
                )}
              >
                {complete ? <Check className="size-3.5" /> : index + 1}
              </span>
              <div className="min-w-0 text-sm">
                <p className="text-fg-muted">{step.label}</p>
                <p className={cn(value ? 'text-fg' : 'text-fg-subtle')}>{value ?? 'Not yet'}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="border-t border-line">
        <DetailList
          items={[
            { label: 'Service notes', value: ticket.serviceIssueNotes },
            {
              label: 'Resolved',
              value: joined(
                day(ticket.resolvedDate),
                money(ticket.serviceChargeAud) && `charge ${money(ticket.serviceChargeAud) ?? ''}`,
              ),
            },
          ]}
        />
      </div>
    </EditableSection>
  );
}

// ── Repeating rows (hardware, claims, visits) ──────────────────────────────

/** A card with an Add button; rows open the same form to edit, with a remove button. */
function RowsCard<TRow extends { id: string }>({
  title,
  description,
  editable,
  rows,
  empty,
  renderRows,
  form,
  onRemove,
  removeLabel,
}: {
  title: string;
  description: string;
  editable: boolean;
  rows: TRow[];
  empty: string;
  renderRows: (rows: TRow[], actions: (row: TRow) => ReactNode) => ReactNode;
  form: (row: TRow | null, close: () => void) => ReactNode;
  onRemove: (row: TRow) => Promise<unknown>;
  removeLabel: (row: TRow) => string;
}) {
  const [editing, setEditing] = useState<TRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<TRow | null>(null);
  const actions = (row: TRow) =>
    editable && (
      <span className="flex justify-end gap-1">
        <IconButton
          size="sm"
          label="Edit"
          onClick={() => {
            setEditing(row);
          }}
        >
          <Pencil />
        </IconButton>
        <IconButton
          size="sm"
          label="Remove"
          onClick={() => {
            setRemoving(row);
          }}
        >
          <Trash2 />
        </IconButton>
      </span>
    );
  return (
    <Card>
      <CardHeader
        actions={
          editable && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus />
              Add
            </Button>
          )
        }
      >
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="py-1">
        {rows.length === 0 ? (
          <p className="py-3 text-sm text-fg-muted">{empty}</p>
        ) : (
          renderRows(rows, actions)
        )}
      </CardContent>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent title={title} description={description} className="max-w-2xl">
          {editing !== null &&
            form(editing === 'new' ? null : editing, () => {
              setEditing(null);
            })}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing ? removeLabel(removing) : ''}?`}
        description="This can't be undone. It stays in the ticket's history."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (removing) await onRemove(removing);
        }}
      />
    </Card>
  );
}

function useRemove() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return async (action: () => Promise<unknown>, message: string) => {
    await action();
    await queryClient.invalidateQueries(trpc.tickets.pathFilter());
    toast({ title: message, tone: 'success' });
  };
}

// ── Hardware ─────────────────────────────────────────────────────────────

const HARDWARE_FIELDS: FieldSpec<TicketHardwareInput>[] = [
  {
    name: 'role',
    label: 'On the roof',
    kind: 'choice',
    choices: [
      { value: 'existing', label: 'Existing (faulty or checked)' },
      { value: 'replaced', label: 'Replacement fitted' },
    ],
  },
  {
    name: 'kind',
    label: 'Equipment',
    kind: 'choice',
    choices: TICKET_HARDWARE_KINDS.map((kind) => ({
      value: kind,
      label: HARDWARE_KIND_LABELS[kind],
    })),
  },
  { name: 'brand', label: 'Brand', kind: 'text' },
  { name: 'model', label: 'Model', kind: 'text' },
  { name: 'size', label: 'Size', kind: 'text', placeholder: 'e.g. 5 kW, 440 W' },
  { name: 'quantity', label: 'How many', kind: 'count' },
  {
    name: 'serialNumbers',
    label: 'Serial numbers',
    kind: 'text',
    wide: true,
    hint: 'Separate several with commas.',
  },
  { name: 'notes', label: 'Notes', kind: 'text', wide: true },
];

type HardwareRow = Ticket['hardware'][number];

export function HardwareCard({ ticket, editable }: Props) {
  const trpc = useTRPC();
  const save = useMutation(trpc.tickets.saveHardware.mutationOptions());
  const remove = useMutation(trpc.tickets.removeHardware.mutationOptions());
  const run = useRemove();
  return (
    <RowsCard<HardwareRow>
      title="Hardware"
      description="What is on the roof, and what was fitted in its place — with serial numbers for warranty claims."
      editable={editable}
      rows={ticket.hardware}
      empty="No equipment recorded yet."
      removeLabel={(row) =>
        `${HARDWARE_KIND_LABELS[row.kind].toLowerCase()} ${row.model ?? ''}`.trim()
      }
      onRemove={(row) =>
        run(() => remove.mutateAsync({ ticketId: ticket.id, id: row.id }), 'Hardware removed')
      }
      renderRows={(rows, actions) => (
        <Table aria-label="Hardware">
          <TableHead>
            <tr>
              <TableHeaderCell>Row</TableHeaderCell>
              <TableHeaderCell>Equipment</TableHeaderCell>
              <TableHeaderCell end>Qty</TableHeaderCell>
              <TableHeaderCell>Serial numbers</TableHeaderCell>
              <TableHeaderCell />
            </tr>
          </TableHead>
          <tbody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Badge tone={row.role === 'replaced' ? 'success' : 'neutral'}>
                    {row.role === 'replaced' ? 'Replacement' : 'Existing'}
                  </Badge>
                </TableCell>
                <TableCell wrap>
                  <span className="block font-medium">
                    {[row.brand, row.model].filter(Boolean).join(' ') ||
                      HARDWARE_KIND_LABELS[row.kind]}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {joined(HARDWARE_KIND_LABELS[row.kind], row.size, row.notes)}
                  </span>
                </TableCell>
                <TableCell end>{row.quantity}</TableCell>
                <TableCell wrap className="font-mono text-xs">
                  {row.serialNumbers.join(', ') || <span className="text-fg-subtle">—</span>}
                </TableCell>
                <TableCell end>{actions(row)}</TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      )}
      form={(row, close) => (
        <SectionForm<TicketHardwareInput, TicketHardwareValues>
          resolver={zodResolver(ticketHardwareSchema)}
          defaultValues={{
            role: row?.role ?? 'existing',
            kind: row?.kind ?? 'inverter',
            quantity: row?.quantity ?? 1,
            brand: row?.brand ?? '',
            model: row?.model ?? '',
            size: row?.size ?? '',
            serialNumbers: row?.serialNumbers.join(', ') ?? '',
            notes: row?.notes ?? '',
          }}
          fields={HARDWARE_FIELDS}
          submit={(values) => save.mutateAsync({ ticketId: ticket.id, id: row?.id, values })}
          success="Hardware saved"
          onDone={close}
        />
      )}
    />
  );
}

// ── Warranty claims ──────────────────────────────────────────────────────

const CLAIM_FIELDS: FieldSpec<WarrantyClaimInput>[] = [
  { name: 'claimReference', label: 'Claim / RMA number', kind: 'text' },
  { name: 'claimDate', label: 'Claimed on', kind: 'date' },
  {
    name: 'status',
    label: 'Claim status',
    kind: 'option',
    list: 'ticketWarrantyClaimStatuses',
    wide: true,
  },
  { heading: 'Invoice' },
  { name: 'invoiceNumber', label: 'Invoice number', kind: 'text' },
  { name: 'invoiceAmountAud', label: 'Amount', kind: 'money' },
  {
    name: 'invoiceStatus',
    label: 'Invoice status',
    kind: 'option',
    list: 'ticketWarrantyClaimInvoiceStatuses',
    wide: true,
  },
  { name: 'brandNotes', label: 'Notes from the brand', kind: 'text', wide: true },
];

type ClaimRow = Ticket['claims'][number];

export function WarrantyClaimsCard({ ticket, editable }: Props) {
  const trpc = useTRPC();
  const save = useMutation(trpc.tickets.saveClaim.mutationOptions());
  const remove = useMutation(trpc.tickets.removeClaim.mutationOptions());
  const run = useRemove();
  return (
    <RowsCard<ClaimRow>
      title="Warranty claims"
      description="A claim with the manufacturer: reference, status and any invoice or credit."
      editable={editable}
      rows={ticket.claims}
      empty="No warranty claim."
      removeLabel={(row) => `claim ${row.claimReference ?? ''}`.trim()}
      onRemove={(row) =>
        run(() => remove.mutateAsync({ ticketId: ticket.id, id: row.id }), 'Claim removed')
      }
      renderRows={(rows, actions) => (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 py-3 text-sm">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.claimReference ?? 'Claim'}</span>
                  {row.status && (
                    <Badge
                      tone={
                        /approved|credited|received/i.test(row.status)
                          ? 'success'
                          : /rejected/i.test(row.status)
                            ? 'danger'
                            : 'warning'
                      }
                      dot
                    >
                      {row.status}
                    </Badge>
                  )}
                </span>
                <span className="text-fg-muted">
                  {joined(
                    day(row.claimDate) && `claimed ${day(row.claimDate) ?? ''}`,
                    row.invoiceNumber && `invoice ${row.invoiceNumber}`,
                    money(row.invoiceAmountAud),
                    row.invoiceStatus,
                  )}
                </span>
                {row.brandNotes && <span className="whitespace-pre-wrap">{row.brandNotes}</span>}
              </div>
              {actions(row)}
            </li>
          ))}
        </ul>
      )}
      form={(row, close) => (
        <SectionForm<WarrantyClaimInput, WarrantyClaimValues>
          resolver={zodResolver(warrantyClaimSchema)}
          defaultValues={{
            claimReference: row?.claimReference ?? '',
            claimDate: row?.claimDate ?? '',
            status: row?.status ?? '',
            invoiceNumber: row?.invoiceNumber ?? '',
            invoiceAmountAud: row?.invoiceAmountAud ?? '',
            invoiceStatus: row?.invoiceStatus ?? '',
            brandNotes: row?.brandNotes ?? '',
          }}
          fields={CLAIM_FIELDS}
          submit={(values) => save.mutateAsync({ ticketId: ticket.id, id: row?.id, values })}
          success="Warranty claim saved"
          onDone={close}
        />
      )}
    />
  );
}

// ── Installer visits ─────────────────────────────────────────────────────

type VisitRow = Ticket['visits'][number];

export function InstallerVisitsCard({ ticket, editable }: Props) {
  const trpc = useTRPC();
  const save = useMutation(trpc.tickets.saveVisit.mutationOptions());
  const remove = useMutation(trpc.tickets.removeVisit.mutationOptions());
  const installers = useQuery(trpc.projects.installers.queryOptions());
  const run = useRemove();
  const fields: FieldSpec<InstallerVisitInput>[] = [
    {
      name: 'isSubcontractor',
      label: 'Who attended',
      kind: 'checkbox',
      text: 'A subcontractor (not our staff)',
      wide: true,
    },
    {
      name: 'installerCompanyId',
      label: 'Installer company',
      kind: 'choice',
      choices: (installers.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    { name: 'installerName', label: 'Electrician', kind: 'text' },
    { name: 'phone', label: 'Phone', kind: 'text' },
    { name: 'email', label: 'Email', kind: 'text' },
    { name: 'visitDate', label: 'Visit date', kind: 'date' },
    { name: 'notes', label: 'What they did', kind: 'text', wide: true },
    { heading: 'Invoice' },
    { name: 'invoiceNumber', label: 'Invoice number', kind: 'text' },
    { name: 'invoiceDate', label: 'Invoice date', kind: 'date' },
    { name: 'invoiceAmountAud', label: 'Amount', kind: 'money' },
    {
      name: 'invoiceStatus',
      label: 'Invoice status',
      kind: 'option',
      list: 'installerInvoiceStatuses',
    },
  ];
  return (
    <RowsCard<VisitRow>
      title="Installer visits"
      description="An electrician's attendance and their invoice."
      editable={editable}
      rows={ticket.visits}
      empty="No visit recorded."
      removeLabel={(row) => `the visit${row.visitDate ? ` on ${formatDate(row.visitDate)}` : ''}`}
      onRemove={(row) =>
        run(() => remove.mutateAsync({ ticketId: ticket.id, id: row.id }), 'Visit removed')
      }
      renderRows={(rows, actions) => (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 py-3 text-sm">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">
                  {joined(row.companyName, row.installerName) ?? 'Visit'}
                  {row.visitDate && (
                    <span className="font-normal text-fg-muted">
                      {' '}
                      · {formatDate(row.visitDate)}
                    </span>
                  )}
                </span>
                <span className="text-fg-muted">
                  {joined(row.isSubcontractor ? 'Subcontractor' : 'Staff', row.phone, row.email)}
                </span>
                {row.notes && <span className="whitespace-pre-wrap">{row.notes}</span>}
                {(row.invoiceNumber ?? row.invoiceAmountAud) && (
                  <span className="text-fg-muted">
                    Invoice{' '}
                    {joined(
                      row.invoiceNumber,
                      money(row.invoiceAmountAud),
                      day(row.invoiceDate),
                      row.invoiceStatus,
                    )}
                  </span>
                )}
              </div>
              {actions(row)}
            </li>
          ))}
        </ul>
      )}
      form={(row, close) => (
        <SectionForm<InstallerVisitInput, InstallerVisitValues>
          resolver={zodResolver(installerVisitSchema)}
          defaultValues={{
            isSubcontractor: row?.isSubcontractor ?? true,
            installerCompanyId: row?.installerCompanyId ?? '',
            installerName: row?.installerName ?? '',
            phone: row?.phone ?? '',
            email: row?.email ?? '',
            visitDate: row?.visitDate ?? '',
            notes: row?.notes ?? '',
            invoiceDate: row?.invoiceDate ?? '',
            invoiceNumber: row?.invoiceNumber ?? '',
            invoiceAmountAud: row?.invoiceAmountAud ?? '',
            invoiceStatus: row?.invoiceStatus ?? '',
          }}
          fields={fields}
          submit={(values) => save.mutateAsync({ ticketId: ticket.id, id: row?.id, values })}
          success="Visit saved"
          onDone={close}
        />
      )}
    />
  );
}
