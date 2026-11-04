import { HARDWARE_CATALOG_KINDS, hardwareItemSchemas, type HardwareCatalogKind } from '@mms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Archive, ArchiveRestore, Pencil, Plus, Upload } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../../components/PageHeader.tsx';
import { SearchBox } from '../../../components/SearchBox.tsx';
import { errorMessage } from '../../../lib/errors.ts';
import { useCan, useDebouncedValue } from '../../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../../lib/trpc.ts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  Skeleton,
  Switch,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from '../../../ui/index.ts';
import { SettingsBackLink } from '../SettingsPage.tsx';

type Item = RouterOutputs['admin']['hardware']['list']['rows'][number];

const KIND_LABELS: Record<
  HardwareCatalogKind,
  { plural: string; one: string; size: string; unit: string }
> = {
  panel: { plural: 'Panels', one: 'panel', size: 'Size', unit: 'W' },
  inverter: { plural: 'Inverters', one: 'inverter', size: 'Size', unit: 'kW' },
  battery: { plural: 'Batteries', one: 'battery', size: 'Usable capacity', unit: 'kWh' },
};
const SIZE_KEY = { panel: 'sizeW', inverter: 'sizeKw', battery: 'usableCapacityKwh' } as const;

const trimNumber = (value: string) => String(Number(value));

function ItemForm({
  kind,
  item,
  onDone,
}: {
  kind: HardwareCatalogKind;
  item: Item | null;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const save = useMutation(trpc.admin.hardware.save.mutationOptions());
  const [values, setValues] = useState({
    manufacturer: item?.manufacturer ?? '',
    model: item?.model ?? '',
    series: item?.series ?? '',
    size: item ? trimNumber(item.size) : '',
    sizeLabel: item?.sizeLabel ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const labels = KIND_LABELS[kind];
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
  };

  const submit = () => {
    const raw = {
      manufacturer: values.manufacturer,
      model: values.model,
      series: values.series,
      [SIZE_KEY[kind]]: values.size,
      ...(kind === 'battery' ? { sizeLabel: values.sizeLabel } : {}),
    };
    const parsed = hardwareItemSchemas[kind].safeParse(raw);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setErrors({});
    save
      // The kind and its own schema's values go together (checked again on the server).
      .mutateAsync({ kind, id: item?.id, values: raw })
      .then(async () => {
        await queryClient.invalidateQueries(trpc.admin.hardware.pathFilter());
        await queryClient.invalidateQueries(trpc.hardware.pathFilter());
        toast({
          title: item ? 'Saved' : `${values.manufacturer} ${values.model} added`,
          tone: 'success',
        });
        onDone();
      })
      .catch(() => undefined);
  };

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        {save.isError && (
          <Alert tone="danger" className="sm:col-span-2">
            {errorMessage(save.error)}
          </Alert>
        )}
        <Field label="Manufacturer" required error={errors.manufacturer}>
          {(props) => (
            <Input
              {...props}
              value={values.manufacturer}
              onChange={set('manufacturer')}
              autoFocus
            />
          )}
        </Field>
        <Field label="Model" required error={errors.model}>
          {(props) => <Input {...props} value={values.model} onChange={set('model')} />}
        </Field>
        <Field label="Series" error={errors.series}>
          {(props) => <Input {...props} value={values.series} onChange={set('series')} />}
        </Field>
        <Field label={`${labels.size} (${labels.unit})`} required error={errors[SIZE_KEY[kind]]}>
          {(props) => (
            <Input {...props} value={values.size} onChange={set('size')} inputMode="decimal" />
          )}
        </Field>
        {kind === 'battery' && (
          <Field
            label="Size label"
            hint="As the brand describes it, e.g. 9.6kWh System"
            className="sm:col-span-2"
          >
            {(props) => <Input {...props} value={values.sizeLabel} onChange={set('sizeLabel')} />}
          </Field>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {item ? 'Save' : `Add ${labels.one}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Settings → Hardware catalogue (Step 2.10): panels, inverters and batteries (§1.7). */
export function HardwarePage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const [kind, setKind] = useState<HardwareCatalogKind>('panel');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const debounced = useDebouncedValue(search, 250);
  const query = useQuery({
    ...trpc.admin.hardware.list.queryOptions({ kind, search: debounced, archived, page }),
    placeholderData: keepPreviousData,
  });
  const setItemArchived = useMutation(trpc.admin.hardware.setArchived.mutationOptions());
  const labels = KIND_LABELS[kind];
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 50));

  const toggle = (item: Item) => {
    setItemArchived
      .mutateAsync({ kind, id: item.id, archived: !item.archived })
      .then(() => queryClient.invalidateQueries(trpc.admin.hardware.pathFilter()))
      .then(() => {
        toast({
          title: item.archived ? 'Restored' : 'Archived — no longer offered in new designs',
          tone: 'success',
        });
      })
      .catch((error: unknown) => {
        toast({ title: "Couldn't change it", description: errorMessage(error), tone: 'danger' });
      });
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsBackLink />
      <PageHeader
        title="Hardware catalogue"
        description="What can be chosen in system designs. Items are archived, never deleted — old jobs keep them."
        actions={
          <>
            {can('hardware', 'create') && can('hardware', 'edit') && (
              <Button asChild>
                <Link to="/settings/imports">
                  <Upload />
                  Import from Excel/CSV
                </Link>
              </Button>
            )}
            {can('hardware', 'create') && (
              <Button
                variant="primary"
                onClick={() => {
                  setEditing('new');
                }}
              >
                <Plus />
                Add {labels.one}
              </Button>
            )}
          </>
        }
      />
      <Tabs
        value={kind}
        onValueChange={(value) => {
          const next = HARDWARE_CATALOG_KINDS.find((k) => k === value);
          if (next) {
            setKind(next);
            setPage(0);
          }
        }}
      >
        <TabsList>
          {HARDWARE_CATALOG_KINDS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {KIND_LABELS[k].plural}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              placeholder="Search manufacturer, model, series"
              label={`Search ${labels.plural.toLowerCase()}`}
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={archived}
                onCheckedChange={(value) => {
                  setArchived(value);
                  setPage(0);
                }}
              />
              Archived only
            </label>
            <span className="ml-auto text-sm text-fg-muted">{query.data?.total ?? 0} items</span>
          </div>
          {query.isPending ? (
            <Skeleton className="h-64" />
          ) : query.isError ? (
            <Alert tone="danger">{errorMessage(query.error)}</Alert>
          ) : query.data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">
              No {labels.plural.toLowerCase()} match.
            </p>
          ) : (
            <Table aria-label={labels.plural}>
              <TableHead>
                <tr>
                  <TableHeaderCell>Manufacturer</TableHeaderCell>
                  <TableHeaderCell>Model</TableHeaderCell>
                  <TableHeaderCell>Series</TableHeaderCell>
                  <TableHeaderCell end>{labels.size}</TableHeaderCell>
                  <TableHeaderCell />
                </tr>
              </TableHead>
              <tbody>
                {query.data.rows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell wrap>{item.manufacturer}</TableCell>
                    <TableCell wrap className="font-medium">
                      {item.model}
                    </TableCell>
                    <TableCell>
                      {item.series ?? <span className="text-fg-subtle">—</span>}
                    </TableCell>
                    <TableCell end className="tabular-nums">
                      {trimNumber(item.size)} {item.unit}
                      {item.sizeLabel && (
                        <span className="block text-xs text-fg-muted">{item.sizeLabel}</span>
                      )}
                    </TableCell>
                    <TableCell end>
                      {can('hardware', 'edit') && (
                        <span className="flex justify-end gap-1">
                          <IconButton
                            size="sm"
                            label={`Edit ${item.model}`}
                            onClick={() => {
                              setEditing(item);
                            }}
                          >
                            <Pencil />
                          </IconButton>
                          <IconButton
                            size="sm"
                            label={
                              item.archived ? `Restore ${item.model}` : `Archive ${item.model}`
                            }
                            onClick={() => {
                              toggle(item);
                            }}
                          >
                            {item.archived ? <ArchiveRestore /> : <Archive />}
                          </IconButton>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
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
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent
          title={editing === 'new' ? `Add a ${labels.one}` : `Edit ${labels.one}`}
          className="max-w-xl"
        >
          {editing !== null && (
            <ItemForm
              kind={kind}
              item={editing === 'new' ? null : editing}
              onDone={() => {
                setEditing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
