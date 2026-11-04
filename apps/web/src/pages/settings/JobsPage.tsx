import { JOB_QUEUE_LABELS, JOB_QUEUES, type JobQueueName } from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/PageHeader.tsx';
import { When } from '../../components/When.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { useCan } from '../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  Skeleton,
  Switch,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toast,
  type BadgeTone,
} from '../../ui/index.ts';
import { SettingsBackLink } from './SettingsPage.tsx';

type Overview = Extract<RouterOutputs['jobs']['overview'], { installed: true }>;

const STATE_TONES: Record<string, BadgeTone> = {
  created: 'neutral',
  retry: 'warning',
  active: 'info',
  completed: 'success',
  cancelled: 'neutral',
  failed: 'danger',
};
const STATE_LABELS: Record<string, string> = {
  created: 'Waiting',
  retry: 'Retrying',
  active: 'Running',
  completed: 'Done',
  cancelled: 'Cancelled',
  failed: 'Failed',
};
const ALL = '__all';

const queueLabel = (name: string) =>
  Object.entries(JOB_QUEUE_LABELS).find(([queue]) => queue === name)?.[1].label ?? name;

function WorkerStatus({ lastSeen, running }: { lastSeen: string | null; running: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Worker</p>
          <p className="text-sm text-fg-muted">
            {lastSeen ? (
              <>
                Last heartbeat <When iso={lastSeen} />
              </>
            ) : (
              'No heartbeat yet'
            )}
          </p>
        </div>
        <Badge tone={running ? 'success' : 'danger'} dot>
          {running ? 'Running' : 'Not running'}
        </Badge>
        {!running && (
          <Alert tone="warning" className="w-full">
            Imports and syncs wait until the worker runs. Locally it starts with{' '}
            <code>npm run dev</code>; on the server it is the worker container.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function Jobs({ overview }: { overview: Overview }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const retry = useMutation(trpc.jobs.retry.mutationOptions());

  const onRetry = (queue: JobQueueName, id: string) => {
    retry
      .mutateAsync({ queue, id })
      .then(() => queryClient.invalidateQueries(trpc.jobs.pathFilter()))
      .then(() => {
        toast({ title: 'Job queued again', tone: 'success' });
      })
      .catch((error: unknown) => {
        toast({ title: "Couldn't retry", description: errorMessage(error), tone: 'danger' });
      });
  };

  if (overview.jobs.length === 0) {
    return <p className="py-6 text-center text-sm text-fg-muted">No jobs to show.</p>;
  }
  return (
    <Table aria-label="Recent jobs">
      <TableHead>
        <tr>
          <TableHeaderCell>Job</TableHeaderCell>
          <TableHeaderCell>State</TableHeaderCell>
          <TableHeaderCell end>Attempts</TableHeaderCell>
          <TableHeaderCell>Queued</TableHeaderCell>
          <TableHeaderCell>Finished</TableHeaderCell>
          <TableHeaderCell>Result</TableHeaderCell>
          <TableHeaderCell />
        </tr>
      </TableHead>
      <tbody>
        {overview.jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell>{queueLabel(job.queue)}</TableCell>
            <TableCell>
              <Badge tone={STATE_TONES[job.state] ?? 'neutral'} dot>
                {STATE_LABELS[job.state] ?? job.state}
              </Badge>
            </TableCell>
            <TableCell end>
              {job.attempts} of {job.maxAttempts}
            </TableCell>
            <TableCell>
              <When iso={job.createdAt} />
            </TableCell>
            <TableCell>
              <When iso={job.completedAt} />
            </TableCell>
            <TableCell wrap className="max-w-md text-fg-muted">
              <span className={job.state === 'failed' ? 'text-danger-text' : undefined}>
                {job.outcome ?? '—'}
              </span>
            </TableCell>
            <TableCell end>
              {job.state === 'failed' &&
                job.queue !== JOB_QUEUES.deadLetter &&
                can('integrations', 'edit') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={retry.isPending && retry.variables.id === job.id}
                    onClick={() => {
                      onRetry(job.queue as JobQueueName, job.id);
                    }}
                  >
                    <RotateCcw />
                    Retry
                  </Button>
                )}
            </TableCell>
          </TableRow>
        ))}
      </tbody>
    </Table>
  );
}

/** Settings → Background jobs (Step 3.1): worker health, queue counts, recent jobs and failures. */
export function JobsPage() {
  const trpc = useTRPC();
  const [failedOnly, setFailedOnly] = useState(false);
  const [queue, setQueue] = useState<JobQueueName | undefined>();
  const query = useQuery({
    ...trpc.jobs.overview.queryOptions({ failedOnly, queue }),
    refetchInterval: 5000,
  });

  return (
    <div className="flex flex-col gap-6">
      <SettingsBackLink />
      <PageHeader
        title="Background jobs"
        description="Imports, sheet syncs and scheduled tasks run here. Updates every few seconds."
      />
      {query.isPending ? (
        <Skeleton className="h-64" />
      ) : query.isError ? (
        <Alert tone="danger">{errorMessage(query.error)}</Alert>
      ) : !query.data.installed ? (
        <Alert tone="warning" title="The worker has never run">
          Start it with <code>npm run dev</code> (locally) — it sets up the job queue on first
          start.
        </Alert>
      ) : (
        <>
          <WorkerStatus lastSeen={query.data.workerLastSeenAt} running={query.data.workerRunning} />
          <Card>
            <CardHeader>
              <CardTitle>Queues · last 24 hours</CardTitle>
            </CardHeader>
            <CardContent>
              <Table aria-label="Queues">
                <TableHead>
                  <tr>
                    <TableHeaderCell>Queue</TableHeaderCell>
                    <TableHeaderCell end>Waiting</TableHeaderCell>
                    <TableHeaderCell end>Running</TableHeaderCell>
                    <TableHeaderCell end>Done</TableHeaderCell>
                    <TableHeaderCell end>Failed</TableHeaderCell>
                  </tr>
                </TableHead>
                <tbody>
                  {query.data.queues.map((q) => (
                    <TableRow key={q.name}>
                      <TableCell wrap>
                        <span className="block font-medium">{queueLabel(q.name)}</span>
                        <span className="text-xs text-fg-muted">
                          {JOB_QUEUE_LABELS[q.name].description}
                        </span>
                      </TableCell>
                      <TableCell end>{q.waiting}</TableCell>
                      <TableCell end>{q.active}</TableCell>
                      <TableCell end>{q.completed}</TableCell>
                      <TableCell
                        end
                        className={q.failed > 0 ? 'font-semibold text-danger-text' : undefined}
                      >
                        {q.failed}
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader
              actions={
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={failedOnly} onCheckedChange={setFailedOnly} />
                    Failed only
                  </label>
                  <Select
                    aria-label="Queue"
                    className="w-48"
                    value={queue ?? ALL}
                    onValueChange={(value) => {
                      setQueue(Object.values(JOB_QUEUES).find((name) => name === value));
                    }}
                    options={[
                      { value: ALL, label: 'All queues' },
                      ...Object.values(JOB_QUEUES).map((name) => ({
                        value: name,
                        label: queueLabel(name),
                      })),
                    ]}
                  />
                </div>
              }
            >
              <CardTitle>Recent jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <Jobs overview={query.data} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
