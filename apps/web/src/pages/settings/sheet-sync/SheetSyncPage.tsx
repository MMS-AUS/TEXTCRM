import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ExternalLink, Plus, RefreshCw, Sheet } from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader.tsx';
import { When } from '../../../components/When.tsx';
import { errorMessage } from '../../../lib/errors.ts';
import { useCan } from '../../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../../lib/trpc.ts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Switch,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toast,
} from '../../../ui/index.ts';
import { SettingsBackLink } from '../SettingsPage.tsx';
import { runCounts } from './run-counts.ts';
import { useSyncNow } from './use-sync-now.ts';
import { RunStatus } from './run-status.tsx';

type Source = RouterOutputs['sheetSync']['list'][number];

function SourcesTable({ sources }: { sources: Source[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const canEdit = can('integrations', 'edit');
  const setEnabled = useMutation(trpc.sheetSync.setEnabled.mutationOptions());
  const syncNow = useSyncNow();

  return (
    <Table aria-label="Synced sheets">
      <TableHead>
        <tr>
          <TableHeaderCell>Sheet</TableHeaderCell>
          <TableHeaderCell>Sync</TableHeaderCell>
          <TableHeaderCell end>Leads</TableHeaderCell>
          <TableHeaderCell>Last run</TableHeaderCell>
          <TableHeaderCell />
        </tr>
      </TableHead>
      <tbody>
        {sources.map((source) => (
          <TableRow key={source.id}>
            <TableCell wrap>
              <Link
                to="/settings/sheet-sync/$sourceId"
                params={{ sourceId: source.id }}
                className="font-medium hover:underline"
              >
                {source.name}
              </Link>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
              >
                {source.spreadsheetTitle ?? 'Google Sheet'} · {source.sheetTab}
                <ExternalLink className="size-3" />
              </a>
            </TableCell>
            <TableCell>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={source.enabled}
                  disabled={!canEdit || setEnabled.isPending}
                  onCheckedChange={(enabled) => {
                    setEnabled
                      .mutateAsync({ id: source.id, enabled })
                      .then(() => queryClient.invalidateQueries(trpc.sheetSync.pathFilter()))
                      .catch((error: unknown) => {
                        toast({
                          title: "Couldn't change it",
                          description: errorMessage(error),
                          tone: 'danger',
                        });
                      });
                  }}
                />
                {source.enabled ? 'On' : 'Off'}
              </label>
            </TableCell>
            <TableCell end>{source.leads}</TableCell>
            <TableCell wrap>
              {source.lastRun ? (
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <RunStatus status={source.lastRun.status} />
                    <When iso={source.lastRun.finishedAt ?? source.lastRun.startedAt} />
                  </span>
                  <span className="text-xs text-fg-muted">
                    {source.lastRun.error ?? runCounts(source.lastRun)}
                  </span>
                </span>
              ) : (
                <span className="text-fg-subtle">Never run</span>
              )}
            </TableCell>
            <TableCell end>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={syncNow.pendingId === source.id}
                  onClick={() => {
                    syncNow.run(source.id);
                  }}
                >
                  <RefreshCw />
                  Sync now
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </tbody>
    </Table>
  );
}

/** Settings → Live sheet sync (Step 3.3): the synced lead sheets, on/off, last run. */
export function SheetSyncPage() {
  const trpc = useTRPC();
  const can = useCan();
  const setup = useQuery(trpc.sheetSync.setup.queryOptions());
  const list = useQuery({
    ...trpc.sheetSync.list.queryOptions(),
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.lastRun?.status === 'running') ? 3000 : 30_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <SettingsBackLink />
      <PageHeader
        title="Live sheet sync"
        description={
          setup.data
            ? `New rows in your lead sheets become leads automatically, every ${String(setup.data.intervalMinutes)} minutes.`
            : 'New rows in your lead sheets become leads automatically.'
        }
        actions={
          can('integrations', 'edit') && (
            <Button variant="primary" asChild>
              <Link to="/settings/sheet-sync/new">
                <Plus />
                Add a sheet
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>How it works — the sheet creates, the CRM owns after</CardTitle>
          <CardDescription>The CRM only reads the sheet; it never writes to it.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg-muted">
            <li>
              A row with a new Lead ID becomes a new lead, with its status, sales rep and notes.
            </li>
            <li>
              Corrections in the sheet (phone, address, system size…) keep flowing in — until
              someone changes the lead in the CRM. From then on the sheet never changes it.
            </li>
            <li>
              Status, notes, sales rep and everything added in the CRM are never changed by the
              sheet.
            </li>
            <li>Deleting a row in the sheet never deletes the lead.</li>
            <li>Rows without a Lead ID are skipped and listed in the history.</li>
            <li>
              A row for a customer already in the CRM is linked to that lead instead of creating a
              second one.
            </li>
          </ul>
        </CardContent>
      </Card>
      {setup.data && !setup.data.serviceAccountEmail && (
        <Alert tone="warning" title="Google Sheets isn't connected">
          Set GOOGLE_SERVICE_ACCOUNT_PATH in .env (Task T-07) and restart the API and worker.
        </Alert>
      )}
      {setup.data?.serviceAccountEmail && (
        <Alert tone="info">
          Share each sheet with <strong>{setup.data.serviceAccountEmail}</strong> as Viewer.
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Synced sheets</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isPending ? (
            <Skeleton className="h-32" />
          ) : list.isError ? (
            <Alert tone="danger">{errorMessage(list.error)}</Alert>
          ) : list.data.length === 0 ? (
            <EmptyState
              icon={<Sheet />}
              title="No sheets yet"
              description="Add your lead-intake sheet to start syncing."
            />
          ) : (
            <SourcesTable sources={list.data} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
