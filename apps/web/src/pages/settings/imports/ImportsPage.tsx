import { IMPORT_FILE_TYPES, MAX_IMPORT_BYTES, formatBytes, type ImportTarget } from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Download, FileSpreadsheet, Sheet, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { PageHeader } from '../../../components/PageHeader.tsx';
import { errorMessage } from '../../../lib/errors.ts';
import { useTRPC, type RouterOutputs } from '../../../lib/trpc.ts';
import { downloadBase64, putWithProgress } from '../../../lib/upload.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Field,
  Input,
  Progress,
  Select,
  Skeleton,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '../../../ui/index.ts';
import { SettingsBackLink } from '../SettingsPage.tsx';
import { STATUS_LABELS, STATUS_TONES, TARGET_LABELS } from './import-labels.ts';
import { When } from '../../../components/When.tsx';

type Setup = RouterOutputs['imports']['setup'];

/** An empty Excel file with this target's columns; filled in, it skips column matching. */
function TemplateButton({ target }: { target: ImportTarget }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      loading={busy}
      onClick={() => {
        setBusy(true);
        queryClient
          .query({ ...trpc.imports.template.queryOptions({ target }), staleTime: 0 })
          .then((file) => {
            downloadBase64(file.base64, file.fileName, IMPORT_FILE_TYPES.xlsx);
          })
          .catch((error: unknown) => {
            toast({
              title: "Couldn't make the template",
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
      Download template
    </Button>
  );
}

function UploadSource({ target, enabled }: { target: ImportTarget; enabled: boolean }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const createUpload = useMutation(trpc.imports.createUpload.mutationOptions());
  const completeUpload = useMutation(trpc.imports.completeUpload.mutationOptions());
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ name: string; fraction: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const start = async (file: File) => {
    setError(null);
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError('Upload a .csv or .xlsx file. For .xls or Numbers, save it as .xlsx first.');
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError(`Files can be up to ${formatBytes(MAX_IMPORT_BYTES)}. Split it into smaller files.`);
      return;
    }
    setProgress({ name: file.name, fraction: 0 });
    try {
      const ticket = await createUpload.mutateAsync({
        target,
        fileName: file.name,
        sizeBytes: file.size,
      });
      await putWithProgress(ticket.uploadUrl, file, ticket.contentType, (fraction) => {
        setProgress({ name: file.name, fraction });
      });
      const { id } = await completeUpload.mutateAsync({ id: ticket.id });
      await navigate({ to: '/settings/imports/$importId', params: { importId: id } });
    } catch (caught) {
      setProgress(null);
      setError(
        caught instanceof Error && !('data' in caught) ? caught.message : errorMessage(caught),
      );
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (enabled && file && !progress) void start(file);
  };

  if (!enabled) {
    return (
      <Alert tone="warning" title="File storage isn't set up">
        Uploads need the S3_ settings in .env. A Google Sheet can still be read directly.
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface-2/40 px-4 py-6 text-center transition-colors sm:flex-row sm:text-left',
          dragging && 'border-accent bg-accent-subtle',
        )}
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface text-fg-muted shadow-xs">
          <Upload className="size-5" />
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Drop a spreadsheet here, or choose it</p>
          <p className="text-fg-muted">
            CSV or Excel (.xlsx) · up to {formatBytes(MAX_IMPORT_BYTES)} · the first row must be the
            column headings
          </p>
          <p className="text-fg-muted">
            Filled in the template? Its columns are matched for you and you go straight to the
            preview.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <TemplateButton target={target} />
          <Button
            variant="primary"
            disabled={progress !== null}
            onClick={() => {
              inputRef.current?.click();
            }}
          >
            <FileSpreadsheet />
            Choose file
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="Choose a spreadsheet to upload"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void start(file);
          }}
        />
      </div>
      {progress && (
        <div className="flex flex-col gap-1.5 text-sm">
          <span>
            {progress.fraction < 1 ? 'Uploading' : 'Reading'} {progress.name}…
          </span>
          <Progress value={progress.fraction} label={`Uploading ${progress.name}`} />
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

function GoogleSource({ target, setup }: { target: ImportTarget; setup: Setup }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const read = useMutation(trpc.imports.fromGoogleSheet.mutationOptions());
  const [url, setUrl] = useState('');

  if (!setup.googleSheets) {
    return (
      <Alert tone="warning" title="Google Sheets isn't connected yet">
        The CRM reads sheets through a Google service account (Task T-07). Until it's set up,
        download the sheet (File → Download → Microsoft Excel) and upload the file instead.
      </Alert>
    );
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        read
          .mutateAsync({ target, url })
          .then(({ id }) =>
            navigate({ to: '/settings/imports/$importId', params: { importId: id } }),
          )
          .catch(() => undefined);
      }}
    >
      <Field
        label="Google Sheet link"
        hint={`First share the sheet with ${setup.googleSheets.serviceAccountEmail} as Viewer.`}
        error={read.isError ? errorMessage(read.error) : undefined}
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
      <div>
        <Button type="submit" variant="primary" loading={read.isPending} disabled={!url.trim()}>
          <Sheet />
          Read sheet
        </Button>
      </div>
    </form>
  );
}

function NewImport({ setup }: { setup: Setup }) {
  const [target, setTarget] = useState<ImportTarget>(setup.targets[0] ?? 'leads');
  return (
    <Card>
      <CardHeader
        actions={
          setup.targets.length > 1 && (
            <Select
              aria-label="Import into"
              className="w-40"
              value={target}
              onValueChange={(value) => {
                const next = setup.targets.find((t) => t === value);
                if (next) setTarget(next);
              }}
              options={setup.targets.map((t) => ({ value: t, label: TARGET_LABELS[t] }))}
            />
          )
        }
      >
        <CardTitle>New import · {TARGET_LABELS[target]}</CardTitle>
        <CardDescription>
          Nothing changes until you have checked the preview and confirmed it. Re-importing the same
          sheet never creates duplicates.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="upload">
          <TabsList>
            <TabsTrigger value="upload">Upload a file</TabsTrigger>
            <TabsTrigger value="google">Google Sheet</TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="pt-4">
            <UploadSource target={target} enabled={setup.uploadsEnabled} />
          </TabsContent>
          <TabsContent value="google" className="pt-4">
            <GoogleSource target={target} setup={setup} />
          </TabsContent>
        </Tabs>
        {!setup.jobsEnabled && (
          <Alert tone="warning" className="mt-4">
            The job queue isn't running, so confirmed imports can't start. Restart the API and check
            its log.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function RecentImports() {
  const trpc = useTRPC();
  const query = useQuery({
    ...trpc.imports.list.queryOptions(),
    refetchInterval: (q) =>
      q.state.data?.some((i) => i.status === 'queued' || i.status === 'running') ? 3000 : false,
  });
  if (query.isPending) return <Skeleton className="h-32" />;
  if (query.isError) return <Alert tone="danger">{errorMessage(query.error)}</Alert>;
  if (query.data.length === 0) {
    return <EmptyState icon={<FileSpreadsheet />} title="No imports yet" />;
  }
  return (
    <Table aria-label="Recent imports">
      <TableHead>
        <tr>
          <TableHeaderCell>Spreadsheet</TableHeaderCell>
          <TableHeaderCell>Into</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell end>Rows</TableHeaderCell>
          <TableHeaderCell end>Created</TableHeaderCell>
          <TableHeaderCell end>Updated</TableHeaderCell>
          <TableHeaderCell end>Not imported</TableHeaderCell>
          <TableHeaderCell>Started by</TableHeaderCell>
        </tr>
      </TableHead>
      <tbody>
        {query.data.map((item) => {
          const done = item.status === 'completed';
          return (
            <TableRow key={item.id}>
              <TableCell wrap>
                <Link
                  to="/settings/imports/$importId"
                  params={{ importId: item.id }}
                  className="font-medium hover:underline"
                >
                  {item.sourceName}
                </Link>
                {item.sheetTab && (
                  <span className="block text-xs text-fg-muted">Tab: {item.sheetTab}</span>
                )}
              </TableCell>
              <TableCell>{TARGET_LABELS[item.target]}</TableCell>
              <TableCell>
                <Badge tone={STATUS_TONES[item.status] ?? 'neutral'} dot>
                  {STATUS_LABELS[item.status] ?? item.status}
                </Badge>
              </TableCell>
              <TableCell end>{item.totalRows}</TableCell>
              <TableCell end>{done ? item.counts.create : '—'}</TableCell>
              <TableCell end>{done ? item.counts.update : '—'}</TableCell>
              <TableCell end>{done ? item.counts.skip + item.counts.error : '—'}</TableCell>
              <TableCell>
                {item.createdByName ?? '—'} · <When iso={item.createdAt} />
              </TableCell>
            </TableRow>
          );
        })}
      </tbody>
    </Table>
  );
}

/** Settings → Import (Step 3.2): start an import and see recent ones. */
export function ImportsPage() {
  const trpc = useTRPC();
  const setup = useQuery(trpc.imports.setup.queryOptions());
  return (
    <div className="flex flex-col gap-6">
      <SettingsBackLink />
      <PageHeader
        title="Import"
        description="Bring leads, contacts or hardware catalogue items in from a spreadsheet: map the columns, preview every row, then import."
      />
      {setup.isPending ? (
        <Skeleton className="h-48" />
      ) : setup.isError ? (
        <Alert tone="danger">{errorMessage(setup.error)}</Alert>
      ) : setup.data.targets.length === 0 ? (
        <Alert tone="info">
          Importing needs permission to create and edit leads, contacts or the hardware catalogue.
          Ask an admin.
        </Alert>
      ) : (
        <NewImport setup={setup.data} />
      )}
      <Card>
        <CardHeader>
          <CardTitle>Recent imports</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentImports />
        </CardContent>
      </Card>
    </div>
  );
}
