import { LEAD_IMPORT_FIELDS, mappingProblems } from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, ExternalLink, RefreshCw, Save, Search } from 'lucide-react';
import { Fragment, useState } from 'react';
import { ColumnMappingTable } from '../../../components/ColumnMappingTable.tsx';
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
  Field,
  IconButton,
  Input,
  Select,
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
import { RunStatus } from './run-status.tsx';
import { useSyncNow } from './use-sync-now.ts';

type Sheet = { spreadsheetId: string; title: string; tabs: string[] };
type Saved = RouterOutputs['sheetSync']['get'];
type Run = RouterOutputs['sheetSync']['runs']['runs'][number];

function BackToSync() {
  return (
    <div className="flex items-center gap-3 text-sm text-fg-muted">
      <SettingsBackLink />
      <span aria-hidden>/</span>
      <Link to="/settings/sheet-sync" className="hover:text-fg">
        Live sheet sync
      </Link>
    </div>
  );
}

// ── The form: tab, column mapping, name, on/off ─────────────────────────

function SourceForm({ sheet, saved }: { sheet: Sheet; saved: Saved | null }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = useCan()('integrations', 'edit');
  const save = useMutation(trpc.sheetSync.save.mutationOptions());
  const [tab, setTab] = useState(saved?.sheetTab ?? sheet.tabs[0] ?? '');
  const [name, setName] = useState(saved?.name ?? sheet.title);
  const [enabled, setEnabled] = useState(saved?.enabled ?? true);
  const [mapping, setMapping] = useState<Record<string, string> | null>(saved?.mapping ?? null);
  const columns = useQuery({
    ...trpc.sheetSync.columns.queryOptions({ spreadsheetId: sheet.spreadsheetId, tab }),
    enabled: Boolean(tab) && canEdit,
  });
  // Until the user changes something, a new sheet uses the suggested mapping.
  const current = mapping ?? columns.data?.mapping ?? {};
  const problems = mappingProblems('leads', current, { requireLeadId: true });
  const hasLeadIdColumn = columns.data?.headers.some((h) => /lead\s*id/i.test(h)) ?? true;

  const onSave = () => {
    save
      .mutateAsync({
        id: saved?.id,
        name,
        spreadsheetId: sheet.spreadsheetId,
        tab,
        mapping: current,
        enabled,
      })
      .then(async ({ id }) => {
        await queryClient.invalidateQueries(trpc.sheetSync.pathFilter());
        toast({ title: saved ? 'Saved' : 'Sheet added', tone: 'success' });
        if (!saved) {
          await navigate({ to: '/settings/sheet-sync/$sourceId', params: { sourceId: id } });
        }
      })
      .catch(() => undefined);
  };

  return (
    <Card>
      <CardHeader
        actions={
          sheet.tabs.length > 1 && (
            <Select
              aria-label="Tab"
              className="w-48"
              value={tab}
              disabled={!canEdit}
              onValueChange={(value) => {
                setTab(value);
                setMapping(null);
              }}
              options={sheet.tabs.map((t) => ({ value: t, label: `Tab: ${t}` }))}
            />
          )
        }
      >
        <CardTitle>Columns</CardTitle>
        <CardDescription>
          The Lead ID column is required — it's how each row is recognised from run to run.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {columns.isPending && canEdit ? (
          <Skeleton className="h-64" />
        ) : columns.isError ? (
          <Alert tone="danger">{errorMessage(columns.error)}</Alert>
        ) : (
          <>
            {!hasLeadIdColumn && (
              <Alert tone="warning" title="This tab has no Lead ID column">
                Add a "Lead ID" column with a unique value on every row (a running number is fine),
                then reload this page (Task T-08).
              </Alert>
            )}
            <ColumnMappingTable
              fields={LEAD_IMPORT_FIELDS}
              headers={columns.data?.headers ?? Object.values(current)}
              sampleRows={columns.data?.sampleRows ?? []}
              mapping={current}
              onChange={setMapping}
              disabled={!canEdit}
            />
          </>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" hint="Shown on each lead's timeline, e.g. “Website leads”.">
            {(props) => (
              <Input
                {...props}
                value={name}
                disabled={!canEdit}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
          <label className="flex items-center gap-3 self-end pb-1.5 text-sm">
            <Switch checked={enabled} disabled={!canEdit} onCheckedChange={setEnabled} />
            Sync automatically
          </label>
        </div>
        {problems.length > 0 && columns.data && (
          <Alert tone="warning" title="Before you save">
            {problems.join(' ')}
          </Alert>
        )}
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        {canEdit && (
          <div>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={problems.length > 0 || !name.trim() || !columns.data}
              onClick={onSave}
            >
              <Save />
              {saved ? 'Save changes' : 'Add sheet'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── History ─────────────────────────────────────────────────────────────

function RunRows({ run }: { run: Run }) {
  const trpc = useTRPC();
  const query = useQuery(trpc.sheetSync.runErrors.queryOptions({ runId: run.id }));
  if (query.isPending) return <Skeleton className="h-16" />;
  if (query.isError) return <Alert tone="danger">{errorMessage(query.error)}</Alert>;
  if (query.data.length === 0) return <p className="text-sm text-fg-muted">No row messages.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-label="Row messages">
      {query.data.map((row) => (
        <li key={`${String(row.rowNumber)}-${row.message}`} className="flex gap-3">
          <span className="w-16 shrink-0 text-fg-muted tabular-nums">Row {row.rowNumber}</span>
          <span className="w-20 shrink-0 text-fg-muted">{row.sheetLeadId ?? '—'}</span>
          <span>{row.message}</span>
        </li>
      ))}
    </ul>
  );
}

function History({ sourceId }: { sourceId: string }) {
  const trpc = useTRPC();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    ...trpc.sheetSync.runs.queryOptions({ sourceId, page }),
    refetchInterval: (q) =>
      q.state.data?.runs.some((r) => r.status === 'running') ? 3000 : 15_000,
  });
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 20));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync history</CardTitle>
        <CardDescription>
          Every run, newest first. Open a run to see its row messages.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {query.isPending ? (
          <Skeleton className="h-32" />
        ) : query.isError ? (
          <Alert tone="danger">{errorMessage(query.error)}</Alert>
        ) : query.data.runs.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">No runs yet.</p>
        ) : (
          <Table aria-label="Sync runs">
            <TableHead>
              <tr>
                <TableHeaderCell />
                <TableHeaderCell>Started</TableHeaderCell>
                <TableHeaderCell>By</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell end>Rows</TableHeaderCell>
                <TableHeaderCell>Result</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {query.data.runs.map((run) => {
                const expanded = open === run.id;
                return (
                  <Fragment key={run.id}>
                    <TableRow>
                      <TableCell>
                        <IconButton
                          size="sm"
                          label={expanded ? 'Hide row messages' : 'Show row messages'}
                          aria-expanded={expanded}
                          onClick={() => {
                            setOpen(expanded ? null : run.id);
                          }}
                        >
                          {expanded ? <ChevronDown /> : <ChevronRight />}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <When iso={run.startedAt} />
                      </TableCell>
                      <TableCell>{run.trigger === 'manual' ? 'Sync now' : 'Schedule'}</TableCell>
                      <TableCell>
                        <RunStatus status={run.status} />
                      </TableCell>
                      <TableCell end>{run.rowsRead}</TableCell>
                      <TableCell wrap className="max-w-md">
                        {run.error ? (
                          <span className="text-danger-text">{run.error}</span>
                        ) : (
                          <span className="text-fg-muted">{runCounts(run)}</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={5} wrap>
                          <RunRows run={run} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
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

// ── Pages ───────────────────────────────────────────────────────────────

/** Settings → Live sheet sync → Add a sheet: link → tab and columns → save. */
export function NewSheetSourcePage() {
  const trpc = useTRPC();
  const setup = useQuery(trpc.sheetSync.setup.queryOptions());
  const inspect = useMutation(trpc.sheetSync.inspect.mutationOptions());
  const [url, setUrl] = useState('');

  return (
    <div className="flex flex-col gap-6">
      <BackToSync />
      <PageHeader title="Add a live sheet" />
      <Card>
        <CardHeader>
          <CardTitle>Sheet</CardTitle>
          {setup.data?.serviceAccountEmail && (
            <CardDescription>
              Share the sheet with {setup.data.serviceAccountEmail} as Viewer first.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 md:flex-row md:items-start"
            onSubmit={(event) => {
              event.preventDefault();
              inspect.mutate({ url });
            }}
          >
            <Field
              label="Google Sheet link"
              className="flex-1"
              error={inspect.isError ? errorMessage(inspect.error) : undefined}
            >
              {(props) => (
                <Input
                  {...props}
                  value={url}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  onChange={(event) => {
                    setUrl(event.target.value);
                  }}
                />
              )}
            </Field>
            <Button
              type="submit"
              className="md:mt-6"
              loading={inspect.isPending}
              disabled={!url.trim()}
            >
              <Search />
              Read sheet
            </Button>
          </form>
        </CardContent>
      </Card>
      {inspect.data && (
        <SourceForm key={inspect.data.spreadsheetId} sheet={inspect.data} saved={null} />
      )}
    </div>
  );
}

/** Settings → Live sheet sync → one sheet: settings, Sync now, history. */
export function SheetSourcePage() {
  const trpc = useTRPC();
  const can = useCan();
  const { sourceId = '' } = useParams({ strict: false });
  const source = useQuery(trpc.sheetSync.get.queryOptions({ id: sourceId }));
  const syncNow = useSyncNow();

  if (source.isPending) return <Skeleton className="h-96" />;
  if (source.isError) {
    return (
      <div className="flex flex-col gap-6">
        <BackToSync />
        <Alert tone="danger">{errorMessage(source.error)}</Alert>
      </div>
    );
  }
  const saved = source.data;
  return (
    <div className="flex flex-col gap-6">
      <BackToSync />
      <PageHeader
        title={saved.name}
        description={
          <a
            href={saved.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-fg"
          >
            {saved.spreadsheetTitle ?? 'Google Sheet'} · {saved.sheetTab}
            <ExternalLink className="size-3.5" />
          </a>
        }
        actions={
          can('integrations', 'edit') && (
            <Button
              loading={syncNow.pendingId === saved.id}
              onClick={() => {
                syncNow.run(saved.id);
              }}
            >
              <RefreshCw />
              Sync now
            </Button>
          )
        }
      />
      <History sourceId={saved.id} />
      <SourceForm
        key={saved.updatedAt}
        sheet={{
          spreadsheetId: saved.spreadsheetId,
          title: saved.spreadsheetTitle ?? saved.name,
          tabs: [saved.sheetTab],
        }}
        saved={saved}
      />
    </div>
  );
}
