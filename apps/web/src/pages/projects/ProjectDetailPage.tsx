import { formatPhone, PROJECT_STAGES, PROJECT_STATUSES } from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  ClipboardList,
  FolderKanban,
  History,
  LifeBuoy,
  Mail,
  Paperclip,
  Phone,
  StickyNote,
  MessageSquare,
} from 'lucide-react';
import { ComposeButtons } from '../../components/messaging/ComposeDialogs.tsx';
import { MessagesPanel } from '../../components/messaging/MessagesPanel.tsx';
import { ActivityTimeline } from '../../components/ActivityTimeline.tsx';
import { FilesPanel } from '../../components/FilesPanel.tsx';
import { HistoryList } from '../../components/HistoryList.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { fullName } from '../../lib/format.ts';
import { useCan, useUsers } from '../../lib/hooks.ts';
import { trpcErrorCode, useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  EmptyState,
  Field,
  Skeleton,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '../../ui/index.ts';
import { RecordTickets } from '../tickets/RecordTickets.tsx';
import { PaymentsCard, SiteCard, SystemDesignCard } from './ProjectSections.tsx';
import {
  EbVerificationCard,
  FinanceCard,
  GridApplicationCard,
  InstallationCard,
  OpenSolarCard,
  StcClaimCard,
  WarehouseCard,
} from './ProjectWorkflow.tsx';
import { projectStatusTone, stageNumber } from './project-stage.ts';

type Project = RouterOutputs['projects']['get'];

const PROJECT_FIELD_LABELS: Record<string, string> = {
  stage: 'Stage',
  status: 'Status',
  salesUserId: 'Sales person',
  title: 'Job title',
  streetAddress: 'Street',
  suburb: 'Suburb',
  state: 'State',
  postcode: 'Postcode',
  area: 'Area',
  nearestBigCity: 'Nearest city',
  houseStorey: 'Storeys',
  roofType: 'Roof',
  phase: 'Phase',
  nmi: 'NMI',
  saleDate: 'Sale date',
  notes: 'Notes',
  existingSystemDetails: 'Existing system',
  systemSizeKw: 'System size',
  panelId: 'Panel',
  panelCount: 'Panels',
  inverters: 'Inverters',
  batteryId: 'Battery',
  batteryCount: 'Batteries',
  systemPriceAud: 'System price',
  sellingPriceAud: 'Selling price',
  contractValueAud: 'Contract value',
  depositAud: 'Deposit',
  depositReceivedDate: 'Deposit received',
  balanceDueDate: 'Balance due',
  customerInvoiceNumber: 'Invoice number',
  // EB verification
  customerNameMatch: 'Bill name matches',
  addressMatch: 'Bill address matches',
  meterMatch: 'Meter matches',
  meterPhase: 'Meter phase',
  openSolarSystemMatch: 'OpenSolar system matches',
  openSolarPricingMatch: 'OpenSolar pricing matches',
  docsReceived: 'Bill documents',
  'update_eb.docsReceivedDate': 'Bill documents received',
  // Grid application
  electricityDistributor: 'DNSP',
  applicationRef: 'Grid application ref.',
  'update_grid.status': 'Grid status',
  'update_grid.appliedDate': 'Grid applied',
  approvalDate: 'Grid approved',
  rejectedDate: 'Grid rejected',
  energyRetailer: 'Retailer',
  retailerRef: 'Retailer ref.',
  // Finance
  financeOption: 'Finance',
  financeCompany: 'Finance company',
  'update_finance.status': 'Finance status',
  'update_finance.appliedDate': 'Finance applied',
  approvedDate: 'Finance approved',
  approvedAmountAud: 'Finance approved amount',
  // Warehouse
  warehouse: 'Warehouse',
  salesOrderNumber: 'Sales order',
  stockStatus: 'Stock status',
  stockUsedProject: 'Stock note',
  invoiceNumber: 'Warehouse invoice no.',
  invoiceDate: 'Warehouse invoice date',
  invoiceAmountAud: 'Warehouse invoice amount',
  invoiceStatus: 'Warehouse invoice status',
  invoicePaidDate: 'Warehouse invoice paid',
  // Installation
  'update_installation.status': 'Installation status',
  installerCompanyId: 'Installer',
  installerQuotedAud: 'Installer quote',
  bookingDate: 'Install date',
  bookedByUserId: 'Booked by',
  completedDate: 'Install completed',
  docsStatus: 'Install documents',
  'update_installation.docsReceivedDate': 'Install documents received',
  installerInvoiceNumber: 'Installer invoice no.',
  installerInvoiceDate: 'Installer invoice date',
  installerInvoiceAmountAud: 'Installer invoice amount',
  installerInvoiceStatus: 'Installer invoice status',
  // STC claim
  portal: 'STC portal',
  jobNumber: 'STC job no.',
  'update_stc.status': 'STC status',
  submittedDate: 'STC submitted',
  solarStcs: 'Solar STCs',
  solarStcsAmountAud: 'Solar STC amount',
  solarStcsReceivedDate: 'Solar STCs received',
  batteryStcs: 'Battery STCs',
  batteryStcsAmountAud: 'Battery STC amount',
  batteryStcsReceivedDate: 'Battery STCs received',
  adminChargesAud: 'STC admin charges',
  customerStcRateAud: 'Customer STC rate',
  internalStcRateAud: 'Internal STC rate',
  // OpenSolar
  openSolarProjectId: 'OpenSolar project',
  proposalId: 'OpenSolar proposal',
  signedUrl: 'Signed proposal link',
  contractSigned: 'Contract signed',
  contractSignedAt: 'Contract signed on',
};

const PROJECT_ACTIONS: Record<string, string> = {
  update_system: 'updated the system design',
  update_eb: 'updated the EB verification',
  update_grid: 'updated the grid application',
  update_finance: 'updated finance',
  update_warehouse: 'updated warehouse & stock',
  update_installation: 'updated the installation',
  update_stc: 'updated the STC claim',
  update_opensolar: 'updated OpenSolar',
};

const UNASSIGNED = '__none';

function BackLink() {
  return (
    <Link
      to="/projects"
      className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
    >
      <ArrowLeft className="size-4" />
      Projects
    </Link>
  );
}

function ProjectView({ project }: { project: Project }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const canViewTickets = can('tickets', 'view');
  const users = useUsers();
  const setStage = useMutation(trpc.projects.setStage.mutationOptions());
  const setStatus = useMutation(trpc.projects.setStatus.mutationOptions());
  const assign = useMutation(trpc.projects.assignSales.mutationOptions());
  const editable = can('projects', 'edit');
  const closed = project.status === 'Closed' || project.status === 'Lost';
  const step = stageNumber(project.stage);

  const run = (action: Promise<unknown>, success: string) =>
    action
      .then(() =>
        Promise.all([
          queryClient.invalidateQueries(trpc.projects.pathFilter()),
          queryClient.invalidateQueries(trpc.activities.pathFilter()),
        ]),
      )
      .then(() => {
        toast({ title: success, tone: 'success' });
      })
      .catch((error: unknown) => {
        toast({ title: 'Nothing was changed', description: errorMessage(error), tone: 'danger' });
      });

  const customer = fullName(project.contact);

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-sm text-fg-muted">{project.projectNumber}</p>
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {project.title ? `${customer} · ${project.title}` : customer}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
              <Badge tone={projectStatusTone(project.status)} dot>
                {project.status}
              </Badge>
              <Link
                to="/contacts/$contactId"
                params={{ contactId: project.contactId }}
                className="hover:text-accent-text hover:underline"
              >
                {customer}
              </Link>
              {project.contact.mobile && (
                <a
                  href={`tel:${project.contact.mobile}`}
                  className="inline-flex items-center gap-1 hover:text-accent-text"
                >
                  <Phone className="size-3.5" />
                  {formatPhone(project.contact.mobile)}
                </a>
              )}
              {project.contact.email && (
                <a
                  href={`mailto:${project.contact.email}`}
                  className="inline-flex items-center gap-1 hover:text-accent-text"
                >
                  <Mail className="size-3.5" />
                  {project.contact.email}
                </a>
              )}
              {project.leadId && project.canViewLead && (
                <Link
                  to="/leads/$leadId"
                  params={{ leadId: project.leadId }}
                  className="hover:text-accent-text hover:underline"
                >
                  Original lead
                </Link>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ComposeButtons
              target={{
                entityType: 'project',
                entityId: project.id,
                phone: project.contact.mobile,
                email: project.contact.email,
                name: customer,
              }}
            />
          </div>
        </div>

        <Card>
          <CardContent className="grid gap-4 md:grid-cols-[2fr_1fr_1fr]">
            <div className="flex flex-col gap-2">
              <Field label="Stage">
                {(props) => (
                  <Select
                    {...props}
                    value={project.stage}
                    disabled={!editable || closed || setStage.isPending}
                    onValueChange={(stage) => {
                      const next = PROJECT_STAGES.find((s) => s === stage);
                      if (next)
                        void run(
                          setStage.mutateAsync({ id: project.id, stage: next }),
                          `Moved to ${next}`,
                        );
                    }}
                    options={PROJECT_STAGES.map((s, index) => ({
                      value: s,
                      label: `${String(index + 1)}. ${s}`,
                    }))}
                  />
                )}
              </Field>
              <div
                role="progressbar"
                aria-label="Job progress"
                aria-valuemin={1}
                aria-valuemax={PROJECT_STAGES.length}
                aria-valuenow={step}
                className="flex gap-1"
              >
                {PROJECT_STAGES.map((stage, index) => (
                  <span
                    key={stage}
                    title={stage}
                    className={`h-1.5 flex-1 rounded-full ${index < step ? 'bg-highlight' : 'bg-surface-3'}`}
                  />
                ))}
              </div>
              <p className="text-xs text-fg-muted">
                Stage {step} of {PROJECT_STAGES.length}
                {closed && ' · reopen the job (status Active) to move it'}
              </p>
            </div>
            <Field label="Status">
              {(props) => (
                <Select
                  {...props}
                  value={project.status}
                  disabled={!editable || setStatus.isPending}
                  onValueChange={(status) => {
                    const next = PROJECT_STATUSES.find((s) => s === status);
                    if (next)
                      void run(
                        setStatus.mutateAsync({ id: project.id, status: next }),
                        `Status set to ${next}`,
                      );
                  }}
                  options={PROJECT_STATUSES.map((s) => ({ value: s, label: s }))}
                />
              )}
            </Field>
            <Field label="Sales person">
              {(props) => (
                <Select
                  {...props}
                  value={project.salesUserId ?? UNASSIGNED}
                  disabled={!editable || assign.isPending}
                  onValueChange={(value) => {
                    void run(
                      assign.mutateAsync({
                        id: project.id,
                        salesUserId: value === UNASSIGNED ? null : value,
                      }),
                      'Sales person updated',
                    );
                  }}
                  options={[
                    { value: UNASSIGNED, label: 'Unassigned' },
                    ...(users.data ?? []).map((user) => ({ value: user.id, label: user.name })),
                  ]}
                />
              )}
            </Field>
          </CardContent>
        </Card>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6">
          <SiteCard project={project} editable={editable} />
          <SystemDesignCard project={project} editable={editable} />
          <PaymentsCard project={project} editable={editable} />
        </div>
        <Tabs defaultValue="job" className="lg:col-span-2">
          <TabsList>
            <TabsTrigger value="job">
              <ClipboardList />
              Job
            </TabsTrigger>
            <TabsTrigger value="activity">
              <StickyNote />
              Activity
            </TabsTrigger>
            {canViewTickets && (
              <TabsTrigger value="tickets">
                <LifeBuoy />
                Tickets
              </TabsTrigger>
            )}
            <TabsTrigger value="messages">
              <MessageSquare />
              Messages
            </TabsTrigger>
            <TabsTrigger value="files">
              <Paperclip />
              Files
            </TabsTrigger>
            <TabsTrigger value="history">
              <History />
              History
            </TabsTrigger>
          </TabsList>
          <TabsContent value="job">
            {/* Workflow order, flowing down the first column then the second. */}
            <div className="gap-6 xl:columns-2 [&>*]:mb-6 [&>*]:break-inside-avoid">
              <EbVerificationCard project={project} editable={editable} />
              <GridApplicationCard project={project} editable={editable} />
              <FinanceCard project={project} editable={editable} />
              <WarehouseCard project={project} editable={editable} />
              <InstallationCard project={project} editable={editable} />
              <StcClaimCard project={project} editable={editable} />
              <OpenSolarCard project={project} editable={editable} />
            </div>
          </TabsContent>
          <TabsContent value="activity">
            <Card>
              <CardContent>
                <ActivityTimeline entityType="project" entityId={project.id} />
              </CardContent>
            </Card>
          </TabsContent>
          {canViewTickets && (
            <TabsContent value="tickets">
              <Card>
                <CardContent>
                  <RecordTickets
                    contactId={project.contactId}
                    contactName={fullName(project.contact)}
                    projectId={project.id}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          )}
          <TabsContent value="messages">
            <Card>
              <CardContent>
                <MessagesPanel entityType="project" entityId={project.id} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="files">
            <Card>
              <CardContent className="flex flex-col gap-6">
                <FilesPanel entityType="project" entityId={project.id} />
                {project.leadId && project.canViewLead && (
                  <section aria-label="Files from the lead" className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold">From the lead</h3>
                    <FilesPanel entityType="lead" entityId={project.leadId} readOnly />
                  </section>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="history">
            <Card>
              <CardContent>
                <HistoryList
                  entries={project.history}
                  labels={PROJECT_FIELD_LABELS}
                  actions={PROJECT_ACTIONS}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export function ProjectDetailPage() {
  const trpc = useTRPC();
  const { projectId = '' } = useParams({ strict: false });
  const query = useQuery(trpc.projects.get.queryOptions({ id: projectId }));

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <BackLink />
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-24" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-80" />
          <Skeleton className="h-80 lg:col-span-2" />
        </div>
      </div>
    );
  }
  if (query.isError) {
    const code = trpcErrorCode(query.error);
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        {code === 'NOT_FOUND' || code === 'BAD_REQUEST' ? (
          <Card>
            <EmptyState
              icon={<FolderKanban />}
              title="Project not found"
              description="It may have been mistyped in the address bar."
            />
          </Card>
        ) : (
          <Alert tone="danger">{errorMessage(query.error)}</Alert>
        )}
      </div>
    );
  }
  return <ProjectView project={query.data} />;
}
