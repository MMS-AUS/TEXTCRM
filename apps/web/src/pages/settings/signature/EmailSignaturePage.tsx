import { formatBytes, MAX_SIGNATURE_LOGO_BYTES, SIGNATURE_LOGO_TYPES } from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Save, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { PageHeader } from '../../../components/PageHeader.tsx';
import { errorMessage } from '../../../lib/errors.ts';
import { useTRPC, type RouterOutputs } from '../../../lib/trpc.ts';
import { putWithProgress } from '../../../lib/upload.ts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Skeleton,
  Switch,
  toast,
} from '../../../ui/index.ts';
import { SettingsBackLink } from '../SettingsPage.tsx';

// Settings → Email signature (Step 5.2): each person's own signature, added under their emails.

type View = RouterOutputs['messaging']['signature'];
type Fields = View['fields'];
type TextField = Exclude<keyof Fields, 'enabled'>;

const FIELDS: { name: TextField; label: string; placeholder?: string }[] = [
  { name: 'fullName', label: 'Name' },
  { name: 'title', label: 'Job title', placeholder: 'e.g. Solar Consultant' },
  { name: 'companyName', label: 'Company' },
  { name: 'phone', label: 'Phone' },
  { name: 'mobile', label: 'Mobile' },
  { name: 'email', label: 'Email' },
  { name: 'website', label: 'Website', placeholder: 'makemysolar.com.au' },
  { name: 'address', label: 'Address' },
];

function Logo({ view }: { view: View }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation(trpc.messaging.signatureLogoUpload.mutationOptions());
  const complete = useMutation(trpc.messaging.signatureLogoComplete.mutationOptions());
  const remove = useMutation(trpc.messaging.signatureLogoRemove.mutationOptions());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = () => queryClient.invalidateQueries(trpc.messaging.signature.queryFilter());

  const choose = (file: File) => {
    setError(null);
    const type = SIGNATURE_LOGO_TYPES.find((t) => t === file.type);
    if (!type) {
      setError('Use a PNG, JPEG or GIF logo.');
      return;
    }
    if (file.size > MAX_SIGNATURE_LOGO_BYTES) {
      setError(`Keep the logo under ${formatBytes(MAX_SIGNATURE_LOGO_BYTES)}.`);
      return;
    }
    setBusy(true);
    upload
      .mutateAsync({ fileName: file.name, contentType: type, sizeBytes: file.size })
      .then(async ({ uploadUrl }) => {
        await putWithProgress(uploadUrl, file, type, () => undefined);
        await complete.mutateAsync();
        await reload();
      })
      .catch((e: unknown) => {
        setError(errorMessage(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Logo</span>
      <div className="flex flex-wrap items-center gap-3">
        {view.logoUrl ? (
          <span className="email-paper rounded-md border border-line p-2">
            <img src={view.logoUrl} alt="Your signature logo" className="h-14 w-auto" />
          </span>
        ) : (
          <span className="text-sm text-fg-muted">No logo</span>
        )}
        <input
          ref={input}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/gif"
          aria-label="Choose a logo"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) choose(file);
            event.target.value = '';
          }}
        />
        <Button
          size="sm"
          loading={busy}
          disabled={!view.storageReady}
          onClick={() => {
            input.current?.click();
          }}
        >
          <ImagePlus />
          {view.hasLogo ? 'Replace logo' : 'Upload logo'}
        </Button>
        {view.hasLogo && (
          <Button
            size="sm"
            variant="ghost"
            loading={remove.isPending}
            onClick={() => {
              remove
                .mutateAsync()
                .then(reload)
                .catch((e: unknown) => {
                  setError(errorMessage(e));
                });
            }}
          >
            <Trash2 />
            Remove
          </Button>
        )}
      </div>
      <p className="text-xs text-fg-muted">
        PNG, JPEG or GIF under 512 KB; shown 56 px tall. It travels inside the email, so it shows
        without the customer downloading pictures.
      </p>
      {!view.storageReady && (
        <p className="text-xs text-warning-text">
          File storage isn’t set up, so logos can’t be added.
        </p>
      )}
      {error && <p className="text-xs text-danger-text">{error}</p>}
    </div>
  );
}

function SignatureForm({ view }: { view: View }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const save = useMutation(trpc.messaging.signatureSave.mutationOptions());
  const [fields, setFields] = useState<Fields>(view.fields);
  const set = (name: TextField, value: string) => {
    setFields((current) => ({ ...current, [name]: value }));
  };
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        save
          .mutateAsync(fields)
          .then(async () => {
            await queryClient.invalidateQueries(trpc.messaging.signature.queryFilter());
            toast({ title: 'Signature saved', tone: 'success' });
          })
          .catch(() => undefined);
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            {view.saved
              ? 'Leave a line empty to leave it out.'
              : 'Filled in from your account and the company profile — check it and save.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <Field
                key={f.name}
                label={f.label}
                className={f.name === 'address' ? 'sm:col-span-2' : ''}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={fields[f.name] ?? ''}
                    placeholder={f.placeholder}
                    maxLength={200}
                    onChange={(event) => {
                      set(f.name, event.target.value);
                    }}
                  />
                )}
              </Field>
            ))}
          </div>
          <Logo view={view} />
          <label className="flex items-center gap-3 text-sm">
            <Switch
              checked={fields.enabled}
              onCheckedChange={(enabled) => {
                setFields((current) => ({ ...current, enabled }));
              }}
            />
            Add my signature to new emails automatically
            <span className="text-xs text-fg-muted">(you can still leave it off per email)</span>
          </label>
        </CardContent>
        <CardFooter>
          <Button type="submit" variant="primary" loading={save.isPending}>
            <Save />
            Save signature
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function EmailSignaturePage() {
  const trpc = useTRPC();
  const query = useQuery(trpc.messaging.signature.queryOptions());
  return (
    <div className="flex flex-col gap-6">
      <SettingsBackLink />
      <PageHeader
        title="Email signature"
        description="Your own signature, added under the emails you send from the CRM."
      />
      {query.isPending ? (
        <Skeleton className="h-96" />
      ) : query.isError ? (
        <Alert tone="danger">{errorMessage(query.error)}</Alert>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <SignatureForm view={query.data} />
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>As saved — how customers will see it.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="email-paper rounded-md border border-line p-3">
                {query.data.previewHtml ? (
                  <div
                    className="email-text"
                    // Built on the server from the saved fields, every value escaped.
                    dangerouslySetInnerHTML={{ __html: query.data.previewHtml }}
                  />
                ) : (
                  <p className="text-sm">Nothing to show yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
