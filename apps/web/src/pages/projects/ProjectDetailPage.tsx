import { formatPhone, PROJECT_STAGES, PROJECT_STATUSES } from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, FolderKanban, History, Mail, Paperclip, Phone, StickyNote } from 'lucide-react';
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
import { PaymentsCard, SiteCard, SystemDesignCard } from './ProjectSections.tsx';
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
  inverterId: 'Inverter',
  inverterCount: 'Inverters',
  batteryId: 'Battery',
  batteryCount: 'Batteries',
  systemPriceAud: 'System price',
  sellingPriceAud: 'Selling price',
  contractValueAud: 'Contract value',
  depositAud: 'Deposit',
  depositReceivedDate: 'Deposit received',
  balanceDueDate: 'Balance due',
  customerInvoiceNumber: 'Invoice number',
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
          <Alert tone="info" title="More sections coming">
            EB verification, grid application, finance, warehouse, installation, STC claim and
            OpenSolar are added to this page in Step 2.7.
          </Alert>
        </div>
        <Card className="lg:col-span-2">
          <CardContent>
            <Tabs defaultValue="activity">
              <TabsList>
                <TabsTrigger value="activity">
                  <StickyNote />
                  Activity
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
              <TabsContent value="activity">
                <ActivityTimeline entityType="project" entityId={project.id} />
              </TabsContent>
              <TabsContent value="files" className="flex flex-col gap-6">
                <FilesPanel entityType="project" entityId={project.id} />
                {project.leadId && project.canViewLead && (
                  <section aria-label="Files from the lead" className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold">From the lead</h3>
                    <FilesPanel entityType="lead" entityId={project.leadId} readOnly />
                  </section>
                )}
              </TabsContent>
              <TabsContent value="history">
                <HistoryList entries={project.history} labels={PROJECT_FIELD_LABELS} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
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
