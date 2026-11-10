import {
  IMPORT_ACTIONS,
  IMPORT_FIELDS,
  IMPORT_ROWS_PAGE_SIZE,
  isHardwareTarget,
  isTemplateMapping,
  mappingProblems,
  type ImportAction,
  type ImportTarget,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowRight, Download, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ColumnMappingTable } from '../../../components/ColumnMappingTable.tsx';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { PageHeader } from '../../../components/PageHeader.tsx';
import { errorMessage } from '../../../lib/errors.ts';
import { useTRPC, type RouterOutputs } from '../../../lib/trpc.ts';
import { downloadText } from '../../../lib/upload.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Select,
  Skeleton,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toast,
} from '../../../ui/index.ts';
import { SettingsBackLink } from '../SettingsPage.tsx';
import {
  ACTION_LABELS,
  ACTION_TONES,
  STATUS_LABELS,
  STATUS_TONES,
  TARGET_LABELS,
} from './import-labels.ts';
import { When } from '../../../components/When.tsx';

type Job = RouterOutputs['imports']['get'];
type Source = RouterOutputs['imports']['source'];

const ALL = '__all';

function useRefresh() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries(trpc.imports.pathFilter());
}

// ── Step 2: map columns ─────────────────────────────────────────────────

function MappingForm({ job, source }: { job: Job; source: Source }) {
  const trpc = useTRPC();
  const refresh = useRefresh();
  const queryClient = useQueryClient();
  const preview = useMutation(trpc.imports.preview.mutationOptions());
  const chooseTab = useMutation(trpc.imports.chooseTab.mutationOptions());
  const [mapping, setMapping] = useState<Record<string, string>>(source.mapping);
  const fields = IMPORT_FIELDS[job.target];
  const problems = mappingProblems(job.target, mapping);
  const changedSincePreview =
    job.status === 'previewed' && JSON.stringify(mapping) !== JSON.stringify(job.mapping ?? {});

  const runPreview = () => {
    preview
      .mutateAsync({ id: job.id, mapping })
      .then(refresh)
      .catch(() => undefined);
  };

  return (
    <Card>
      <CardHeader
        actions={
          source.tabs.length > 1 && (
            <Select
              aria-label="Tab"
              className="w-48"
              value={source.tab ?? undefined}
              disabled={chooseTab.isPending}
              onValueChange={(tab) => {
                chooseTab
                  .mutateAsync({ id: job.id, tab })
                  .then(() => queryClient.resetQueries(trpc.imports.source.pathFilter()))
                  .then(refresh)
                  .catch((error: unknown) => {
                    toast({
                      title: "Couldn't read that tab",
                      description: errorMessage(error),
                      tone: 'danger',
                    });
                  });
              }}
              options={source.tabs.map((tab) => ({ value: tab, label: `Tab: ${tab}` }))}
            />
          )
        }
      >
        <CardTitle>1 · Match the columns</CardTitle>
        <CardDescription>
          {source.rowCount} rows found. Columns with familiar headings are matched for you — check
          them, and leave anything you don't want as "Not imported".
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ColumnMappingTable
          fields={fields}
          headers={source.headers}
          sampleRows={source.sampleRows}
          mapping={mapping}
          onChange={setMapping}
        />
        {problems.length > 0 && (
          <Alert tone="warning" title="Before you preview">
            {problems.join(' ')}
          </Alert>
        )}
        {preview.isError && <Alert tone="danger">{errorMessage(preview.error)}</Alert>}
        {changedSincePreview && (
          <Alert tone="info">You changed the columns — preview again to see the effect.</Alert>
        )}
        <div>
          <Button
            variant={job.status === 'previewed' && !changedSincePreview ? 'secondary' : 'primary'}
            loading={preview.isPending}
            disabled={problems.length > 0}
            onClick={runPreview}
          >
            <ArrowRight />
            {job.status === 'previewed' ? 'Preview again' : 'Preview'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** A file made from the template was matched and previewed on upload; matching stays optional. */
function TemplateMatched({ job, onChange }: { job: Job; onChange: () => void }) {
  return (
    <Card>
      <CardHeader
        actions={
          <Button size="sm" onClick={onChange}>
            Change column matching
          </Button>
        }
      >
        <CardTitle>1 · Columns matched</CardTitle>
        <CardDescription>
          The headings match the {TARGET_LABELS[job.target].toLowerCase()} template, so every column
          was matched for you.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function MappingStep({ job }: { job: Job }) {
  const [matching, setMatching] = useState(false);
  if (!matching && job.status === 'previewed' && isTemplateMapping(job.target, job.mapping)) {
    return (
      <TemplateMatched
        job={job}
        onChange={() => {
          setMatching(true);
        }}
      />
    );
  }
  return <MappingLoader job={job} />;
}

function MappingLoader({ job }: { job: Job }) {
  const trpc = useTRPC();
  const source = useQuery({
    ...trpc.imports.source.queryOptions({ id: job.id }),
    staleTime: Infinity,
  });
  if (source.isPending) return <Skeleton className="h-96" />;
  if (source.isError) return <Alert tone="danger">{errorMessage(source.error)}</Alert>;
  // Re-mounts with fresh suggestions when another tab is chosen.
  return <MappingForm key={source.data.tab ?? 'file'} job={job} source={source.data} />;
}

// ── Rows: the preview, and afterwards the result ────────────────────────

function personOf(data: Record<string, string>) {
  if (data.manufacturer ?? data.model) {
    return {
      name: [data.manufacturer, data.model].filter(Boolean).join(' '),
      reach: data.sizeW ?? data.sizeKw ?? data.usableCapacityKwh ?? '',
    };
  }
  const name = data.firstName
    ? [data.firstName, data.lastName].filter(Boolean).join(' ')
    : (data.fullName ?? data.lastName ?? '');
  return { name: name || '—', reach: data.mobile ?? data.email ?? '' };
}

function RecordLink({ target, id }: { target: ImportTarget; id: string }) {
  if (target !== 'leads' && target !== 'contacts') return null; // catalogue items have no page
  return target === 'leads' ? (
    <Link to="/leads/$leadId" params={{ leadId: id }} className="text-sm hover:underline">
      Open
    </Link>
  ) : (
    <Link to="/contacts/$contactId" params={{ contactId: id }} className="text-sm hover:underline">
      Open
    </Link>
  );
}

function RowsTable({ job, done }: { job: Job; done: boolean }) {
  const trpc = useTRPC();
  const [action, setAction] = useState<ImportAction | undefined>();
  const [page, setPage] = useState(0);
  const query = useQuery(trpc.imports.rows.queryOptions({ id: job.id, action, page }));
  const labels = ACTION_LABELS[done ? 'done' : 'planned'];
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / IMPORT_ROWS_PAGE_SIZE));

  return (
    <Card>
      <CardHeader
        actions={
          <Select
            aria-label="Show rows"
            className="w-44"
            value={action ?? ALL}
            onValueChange={(value) => {
              setAction(IMPORT_ACTIONS.find((a) => a === value));
              setPage(0);
            }}
            options={[
              { value: ALL, label: 'All rows' },
              ...IMPORT_ACTIONS.map((a) => ({ value: a, label: labels[a] })),
            ]}
          />
        }
      >
        <CardTitle>Rows</CardTitle>
        <CardDescription>Row numbers are as in the spreadsheet (headings = row 1).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {query.isPending ? (
          <Skeleton className="h-48" />
        ) : query.isError ? (
          <Alert tone="danger">{errorMessage(query.error)}</Alert>
        ) : query.data.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">No rows to show.</p>
        ) : (
          <Table aria-label="Import rows">
            <TableHead>
              <tr>
                <TableHeaderCell end>Row</TableHeaderCell>
                <TableHeaderCell>Result</TableHeaderCell>
                <TableHeaderCell>
                  {isHardwareTarget(job.target) ? 'Item' : 'Customer'}
                </TableHeaderCell>
                <TableHeaderCell>Details</TableHeaderCell>
                <TableHeaderCell />
              </tr>
            </TableHead>
            <tbody>
              {query.data.rows.map((row) => {
                const person = personOf(row.data);
                return (
                  <TableRow key={row.rowNumber}>
                    <TableCell end>{row.rowNumber}</TableCell>
                    <TableCell>
                      <Badge tone={ACTION_TONES[row.action]} dot>
                        {labels[row.action]}
                      </Badge>
                    </TableCell>
                    <TableCell wrap>
                      <span className="block">{person.name}</span>
                      <span className="text-xs text-fg-muted">{person.reach}</span>
                    </TableCell>
                    <TableCell
                      wrap
                      className={
                        row.action === 'error'
                          ? 'max-w-md text-danger-text'
                          : 'max-w-md text-fg-muted'
                      }
                    >
                      {row.message ?? ''}
                    </TableCell>
                    <TableCell end>
                      {row.recordId && <RecordLink target={job.target} id={row.recordId} />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm text-fg-muted">
            Page {page + 1} of {pages}
            <Button
              size="sm"
              disabled={page === 0}
              onClick={() => {
                setPage(page - 1);
              }}
            >
              Previous
            </Button>
            <Button
              size="sm"
              disabled={page + 1 >= pages}
              onClick={() => {
                setPage(page + 1);
              }}
            >
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Counts({ job, done }: { job: Job; done: boolean }) {
  const labels = ACTION_LABELS[done ? 'done' : 'planned'];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {IMPORT_ACTIONS.map((action) => (
        <Card key={action}>
          <CardContent className="flex flex-col gap-1">
            <Badge tone={ACTION_TONES[action]} dot className="self-start">
              {labels[action]}
            </Badge>
            <span className="text-2xl font-semibold tabular-nums">{job.counts[action]}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ReportButton({ job }: { job: Job }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (job.counts.skip + job.counts.error === 0) return null;
  return (
    <Button
      loading={busy}
      onClick={() => {
        setBusy(true);
        queryClient
          .query({ ...trpc.imports.errorReport.queryOptions({ id: job.id }), staleTime: 0 })
          .then((report) => {
            downloadText(report.csv, report.fileName);
          })
          .catch((error: unknown) => {
            toast({
              title: "Couldn't make the report",
              description: errorMessage(error),
              tone: 'danger',
            });
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <Download />
      Rows not imported (CSV)
    </Button>
  );
}

// ── Step 3: confirm ─────────────────────────────────────────────────────

function ConfirmStep({ job }: { job: Job }) {
  const trpc = useTRPC();
  const refresh = useRefresh();
  const navigate = useNavigate();
  const start = useMutation(trpc.imports.start.mutationOptions());
  const discard = useMutation(trpc.imports.discard.mutationOptions());
  const [discarding, setDiscarding] = useState(false);
  const changes = job.counts.create + job.counts.update;

  return (
    <Card>
      <CardHeader>
        <CardTitle>2 · Check and import</CardTitle>
        <CardDescription>
          Nothing has changed in the CRM yet. Skipped rows are already in the CRM (or repeated in
          this sheet); rows with errors are left out — download them, fix them and import them
          again.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Counts job={job} done={false} />
        {start.isError && <Alert tone="danger">{errorMessage(start.error)}</Alert>}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={changes === 0}
            loading={start.isPending}
            onClick={() => {
              start
                .mutateAsync({ id: job.id })
                .then(refresh)
                .catch(() => undefined);
            }}
          >
            <Play />
            {changes === 0
              ? 'Nothing to import'
              : `Import ${String(changes)} ${changes === 1 ? 'row' : 'rows'}`}
          </Button>
          <ReportButton job={job} />
          <Button
            variant="ghost"
            onClick={() => {
              setDiscarding(true);
            }}
          >
            <Trash2 />
            Discard
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard this import?"
        description="The uploaded file and the preview are removed. Nothing was imported."
        confirmLabel="Discard"
        destructive
        onConfirm={async () => {
          await discard.mutateAsync({ id: job.id });
          await navigate({ to: '/settings/imports' });
        }}
      />
    </Card>
  );
}

// ── Steps 4–5: running, done ────────────────────────────────────────────

function RunningStep({ job }: { job: Job }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Importing…</CardTitle>
        <CardDescription>
          You can leave this page — the import keeps running in the background.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {job.status === 'queued' ? (
          <p className="text-sm text-fg-muted">Waiting for the worker to pick it up…</p>
        ) : (
          <>
            <p className="text-sm">
              {job.processedRows} of {job.totalRows} rows
            </p>
            <Progress
              value={job.totalRows ? job.processedRows / job.totalRows : 0}
              label="Import progress"
            />
          </>
        )}
        {job.status === 'failed' && job.error && <Alert tone="danger">{job.error}</Alert>}
      </CardContent>
    </Card>
  );
}

function DoneStep({ job }: { job: Job }) {
  return (
    <Card>
      <CardHeader actions={<ReportButton job={job} />}>
        <CardTitle>Import finished</CardTitle>
        <CardDescription>
          Finished <When iso={job.finishedAt} />. Each new{' '}
          {job.target === 'leads' ? 'lead' : 'contact'} shows "Imported from {job.sourceName}" in
          its history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Counts job={job} done />
      </CardContent>
    </Card>
  );
}

/** Settings → Import → one import: map columns, preview, confirm, follow progress, results. */
export function ImportPage() {
  const trpc = useTRPC();
  const { importId = '' } = useParams({ strict: false });
  const query = useQuery({
    ...trpc.imports.get.queryOptions({ id: importId }),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'queued' || status === 'running' || status === 'failed' ? 2000 : false;
    },
  });

  if (query.isPending) return <Skeleton className="h-96" />;
  if (query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <BackToImports />
        <Alert tone="danger">{errorMessage(query.error)}</Alert>
      </div>
    );
  }
  const job = query.data;
  const editable = job.status === 'ready' || job.status === 'previewed';
  const running = job.status === 'queued' || job.status === 'running' || job.status === 'failed';

  return (
    <div className="flex flex-col gap-6">
      <BackToImports />
      <PageHeader
        title={`Import ${TARGET_LABELS[job.target].toLowerCase()} · ${job.sourceName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONES[job.status] ?? 'neutral'} dot>
              {STATUS_LABELS[job.status] ?? job.status}
            </Badge>
            {job.sheetTab && <span>Tab: {job.sheetTab}</span>}
            <span>
              Started by {job.createdByName ?? '—'} <When iso={job.createdAt} />
            </span>
          </span>
        }
      />
      {editable && <MappingStep job={job} />}
      {job.status === 'previewed' && <ConfirmStep job={job} />}
      {running && <RunningStep job={job} />}
      {job.status === 'completed' && <DoneStep job={job} />}
      {(job.status === 'previewed' || job.status === 'completed') && (
        <RowsTable job={job} done={job.status === 'completed'} />
      )}
    </div>
  );
}

function BackToImports() {
  return (
    <div className="flex items-center gap-3 text-sm text-fg-muted">
      <SettingsBackLink />
      <span aria-hidden>/</span>
      <Link to="/settings/imports" className="hover:text-fg">
        Import
      </Link>
    </div>
  );
}
