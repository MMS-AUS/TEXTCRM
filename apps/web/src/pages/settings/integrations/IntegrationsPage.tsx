import {
  messageMediaCredentialsSchema,
  type IntegrationProvider,
  type MessageMediaCredentials,
} from '@mms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Link2, Mail, MessageSquare, PlugZap, Receipt, Unplug } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { DetailList } from '../../../components/DetailList.tsx';
import { PageHeader } from '../../../components/PageHeader.tsx';
import { When } from '../../../components/When.tsx';
import { errorMessage } from '../../../lib/errors.ts';
import { useCan } from '../../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../../lib/trpc.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Select,
  Skeleton,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  textInput,
  toast,
  type BadgeTone,
} from '../../../ui/index.ts';
import { integrationsSearchSchema } from '../../list-search.ts';
import { SettingsBackLink } from '../SettingsPage.tsx';

type Status = RouterOutputs['integrations']['status'];
type Provider = Status['providers'][number];
type TestResult = RouterOutputs['integrations']['test'];

const MESSAGE_TYPE = 'mms-oauth-result';
/** The popup's window name and the same-origin channel it reports back on. */
const POPUP_NAME = 'mms-oauth';
const CHANNEL = 'mms-oauth';
type OAuthMessage = {
  type: typeof MESSAGE_TYPE;
  provider: 'gmail' | 'xero';
  result: 'connected' | 'error';
  message?: string;
};

const ICONS: Record<IntegrationProvider, ReactNode> = {
  gmail: <Mail />,
  xero: <Receipt />,
  messagemedia: <MessageSquare />,
};
const LABELS: Record<IntegrationProvider, string> = {
  gmail: 'Gmail',
  xero: 'Xero',
  messagemedia: 'MessageMedia',
};

const STATUS_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  connected: { tone: 'success', label: 'Connected' },
  needs_tenant: { tone: 'warning', label: 'Choose an organisation' },
  expired: { tone: 'danger', label: 'Reconnect needed' },
  error: { tone: 'danger', label: 'Problem' },
};

function announce(provider: 'gmail' | 'xero', result: 'connected' | 'error', message?: string) {
  if (result === 'connected') {
    toast({ title: `${LABELS[provider]} connected`, tone: 'success' });
  } else {
    toast({
      title: `${LABELS[provider]} wasn't connected`,
      description: message ?? 'Please try again.',
      tone: 'danger',
    });
  }
}

/**
 * Starts OAuth in a popup (opened inside the click, so browsers allow it), then points it at
 * the provider. If popups are blocked, the whole tab goes and comes back to this page.
 */
function useConnect() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const connect = useMutation(trpc.integrations.connect.mutationOptions());
  return {
    pending: connect.isPending ? connect.variables.provider : null,
    start: (provider: 'gmail' | 'xero') => {
      const popup = window.open('', POPUP_NAME, 'popup,width=520,height=720');
      connect
        .mutateAsync({ provider })
        .then(({ url }) => {
          if (popup && !popup.closed) {
            popup.location.href = url;
            // If the person just closes the popup, show whatever state the server has.
            const timer = window.setInterval(() => {
              if (!popup.closed) return;
              window.clearInterval(timer);
              void queryClient.invalidateQueries(trpc.integrations.pathFilter());
            }, 1000);
          } else {
            window.location.assign(url);
          }
        })
        .catch((error: unknown) => {
          popup?.close();
          toast({
            title: `Couldn't start connecting ${LABELS[provider]}`,
            description: errorMessage(error),
            tone: 'danger',
          });
        });
    },
  };
}

function TestOutcome({ result }: { result: TestResult | null }) {
  if (!result) return null;
  return (
    <Alert
      tone={result.ok ? 'success' : 'danger'}
      title={result.ok ? 'Test passed' : 'Test failed'}
    >
      {result.message}
    </Alert>
  );
}

function ConnectionDetails({ provider }: { provider: Provider }) {
  const c = provider.connection;
  if (!c) return <p className="text-sm text-fg-muted">Not connected.</p>;
  return (
    <DetailList
      items={[
        {
          label:
            provider.provider === 'gmail'
              ? 'Mailbox'
              : provider.provider === 'xero'
                ? 'Organisation'
                : 'Sender',
          value: c.account,
        },
        { label: 'Connected since', value: <When iso={c.connectedAt} /> },
        {
          label: 'Last checked',
          value: c.lastCheckedAt ? <When iso={c.lastCheckedAt} /> : 'Never',
        },
        ...(provider.inbox
          ? [
              {
                label: 'Customer replies',
                value: (
                  <span className="flex flex-col gap-0.5">
                    <span>
                      {provider.inbox.mode === 'live'
                        ? 'Live — Gmail tells the CRM about new mail'
                        : 'Checked every 2 minutes'}
                      {provider.inbox.lastSyncAt && (
                        <span className="text-fg-muted">
                          {' '}
                          · last checked <When iso={provider.inbox.lastSyncAt} />
                        </span>
                      )}
                    </span>
                    {provider.inbox.lastSyncError ? (
                      <span className="text-xs text-danger-text">
                        {provider.inbox.lastSyncError}
                      </span>
                    ) : (
                      provider.inbox.mode !== 'live' &&
                      provider.inbox.pushProblem && (
                        <span className="text-xs text-fg-muted">{provider.inbox.pushProblem}</span>
                      )
                    )}
                  </span>
                ),
              },
            ]
          : []),
        ...(c.lastError
          ? [
              {
                label: 'Last error',
                value: <span className="text-danger-text">{c.lastError}</span>,
              },
            ]
          : []),
      ]}
    />
  );
}

function XeroChooser({ provider }: { provider: Provider }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const select = useMutation(trpc.integrations.selectXeroTenant.mutationOptions());
  const [tenantId, setTenantId] = useState(provider.xeroChoices[0]?.tenantId ?? '');
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-subtle/40 p-3">
      <p className="text-sm">
        You authorised more than one Xero organisation. Which one should the CRM use?
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Xero organisation"
          className="w-64"
          value={tenantId}
          onValueChange={setTenantId}
          options={provider.xeroChoices.map((c) => ({ value: c.tenantId, label: c.name }))}
        />
        <Button
          variant="primary"
          loading={select.isPending}
          disabled={!tenantId}
          onClick={() => {
            select
              .mutateAsync({ tenantId })
              .then(async ({ organisation }) => {
                await queryClient.invalidateQueries(trpc.integrations.pathFilter());
                toast({ title: `Xero now uses ${organisation}`, tone: 'success' });
              })
              .catch((error: unknown) => {
                toast({
                  title: "Couldn't choose the organisation",
                  description: errorMessage(error),
                  tone: 'danger',
                });
              });
          }}
        >
          Use this organisation
        </Button>
      </div>
    </div>
  );
}

function MessageMediaForm({ onSaved }: { onSaved: () => void }) {
  const trpc = useTRPC();
  const save = useMutation(trpc.integrations.saveMessageMediaCredentials.mutationOptions());
  const [error, setError] = useState<string | null>(null);
  const form = useForm<MessageMediaCredentials>({
    resolver: zodResolver(messageMediaCredentialsSchema),
    defaultValues: { apiKey: '', apiSecret: '', defaultSender: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await save.mutateAsync(values);
      form.reset();
      toast({
        title: 'MessageMedia connected',
        description: 'The credentials were checked with MessageMedia and saved encrypted.',
        tone: 'success',
      });
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });
  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="flex flex-col gap-3 border-t border-line pt-4"
    >
      <p className="text-sm text-fg-muted">
        From MessageMedia Hub → Settings → API settings. They are checked with MessageMedia before
        they are saved.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField control={form.control} name="apiKey" label="API key" required>
          {(field, props) => (
            <Input {...props} {...textInput(field)} autoComplete="off" spellCheck={false} />
          )}
        </FormField>
        <FormField control={form.control} name="apiSecret" label="API secret" required>
          {(field, props) => (
            <Input {...props} {...textInput(field)} type="password" autoComplete="new-password" />
          )}
        </FormField>
        <FormField
          control={form.control}
          name="defaultSender"
          label="Default sender"
          hint="Dedicated number or approved sender ID (optional)."
          className="sm:col-span-2"
        >
          {(field, props) => (
            <Input
              {...props}
              {...textInput(field)}
              placeholder="e.g. +61400000000 or MakeMySolar"
            />
          )}
        </FormField>
      </div>
      <div>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          Check and save
        </Button>
      </div>
    </form>
  );
}

function IntegrationCard({
  provider,
  connecting,
  onConnect,
}: {
  provider: Provider;
  connecting: boolean;
  onConnect: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const test = useMutation(trpc.integrations.test.mutationOptions());
  const disconnect = useMutation(trpc.integrations.disconnect.mutationOptions());
  const [result, setResult] = useState<TestResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const refresh = () => queryClient.invalidateQueries(trpc.integrations.pathFilter());
  const mayManage = provider.owner === 'user' || can('integrations', 'edit');
  const c = provider.connection;
  const badge = c ? STATUS_BADGE[c.status] : null;
  const oauth = provider.provider !== 'messagemedia';
  const fromEnv = provider.provider === 'messagemedia' && provider.credentialsFrom === 'env';
  const usable = Boolean(c) || fromEnv;

  return (
    <Card className="flex flex-col">
      <CardHeader
        actions={
          badge ? (
            <Badge tone={badge.tone} dot>
              {badge.label}
            </Badge>
          ) : fromEnv ? (
            <Badge tone="info" dot>
              Using .env credentials
            </Badge>
          ) : (
            <Badge dot>Not connected</Badge>
          )
        }
      >
        <CardTitle className="flex items-center gap-2 [&_svg]:size-4.5 [&_svg]:text-fg-muted">
          {ICONS[provider.provider]}
          {provider.label}
        </CardTitle>
        <CardDescription>{provider.purpose}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {provider.problem && (
          <Alert tone="warning" title="Not set up yet">
            {provider.problem}
          </Alert>
        )}
        <ConnectionDetails provider={provider} />
        {provider.provider === 'xero' && c?.status === 'needs_tenant' && mayManage && (
          <XeroChooser provider={provider} />
        )}
        <TestOutcome result={result} />
        {provider.provider === 'messagemedia' && mayManage && !provider.problem && (
          <MessageMediaForm
            onSaved={() => {
              setResult(null);
              void refresh();
            }}
          />
        )}
      </CardContent>
      {mayManage && (
        <CardFooter className="flex flex-wrap gap-2">
          {oauth && (
            <Button
              variant={
                c && c.status !== 'expired' && c.status !== 'error' ? 'secondary' : 'primary'
              }
              loading={connecting}
              disabled={Boolean(provider.problem)}
              onClick={onConnect}
            >
              <PlugZap />
              {c ? 'Reconnect' : 'Connect'}
            </Button>
          )}
          <Button
            loading={test.isPending}
            disabled={!usable}
            onClick={() => {
              setResult(null);
              test
                .mutateAsync({ provider: provider.provider })
                .then((outcome) => {
                  setResult(outcome);
                  return refresh();
                })
                .catch((error: unknown) => {
                  setResult({
                    ok: false,
                    status: 'error',
                    message: errorMessage(error),
                    account: null,
                  });
                });
            }}
          >
            <Link2 />
            Test connection
          </Button>
          {c && (
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(true);
              }}
            >
              <Unplug />
              Disconnect
            </Button>
          )}
        </CardFooter>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Disconnect ${provider.label}?`}
        description={
          provider.provider === 'gmail'
            ? "The CRM's access to your mailbox is revoked and its tokens deleted. Emails already logged stay."
            : provider.provider === 'xero'
              ? "The CRM's access to the Xero organisation is revoked and its tokens deleted. Nothing in Xero changes."
              : fromEnv
                ? 'The saved credentials are deleted; the ones in .env will be used again.'
                : 'The saved API key and secret are deleted. SMS stops until new ones are saved.'
        }
        confirmLabel="Disconnect"
        destructive
        onConfirm={async () => {
          const outcome = await disconnect.mutateAsync({ provider: provider.provider });
          setResult(null);
          await refresh();
          toast({
            title: `${provider.label} disconnected`,
            description: outcome.warning ?? undefined,
            tone: outcome.warning ? 'neutral' : 'success',
          });
        }}
      />
    </Card>
  );
}

/** Settings → Integrations: connect, test and disconnect Gmail, Xero and MessageMedia. */
export function IntegrationsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = integrationsSearchSchema.parse(useSearch({ strict: false }));
  const query = useQuery(trpc.integrations.status.queryOptions());
  const connect = useConnect();

  // Arriving back from the provider: inside the popup, hand the result to the opener and
  // close; in a full-page redirect, show it here and tidy the address bar.
  useEffect(() => {
    if (!search.provider || !search.result) return;
    const message: OAuthMessage = {
      type: MESSAGE_TYPE,
      provider: search.provider,
      result: search.result,
      message: search.message,
    };
    // A BroadcastChannel works even when the provider's pages cut window.opener (COOP).
    if (window.name === POPUP_NAME) {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage(message);
      channel.close();
      window.close();
      // Still open (the browser refused to close it): fall through and show the result here.
    }
    announce(message.provider, message.result, message.message);
    void queryClient.invalidateQueries(trpc.integrations.pathFilter());
    void navigate({ to: '/settings/integrations', search: {}, replace: true });
  }, [search.provider, search.result, search.message, navigate, queryClient, trpc]);

  // The main window hears from the popup.
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as Partial<OAuthMessage> | null;
      if (data?.type !== MESSAGE_TYPE || !data.provider || !data.result) return;
      announce(data.provider, data.result, data.message);
      void queryClient.invalidateQueries(trpc.integrations.pathFilter());
    };
    return () => {
      channel.close();
    };
  }, [queryClient, trpc]);

  return (
    <div className="flex flex-col gap-6">
      <SettingsBackLink />
      <PageHeader
        title="Integrations"
        description="Connections to outside services. Tokens and secrets are stored encrypted and never shown again."
      />
      {query.isPending ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : query.isError ? (
        <Alert tone="danger">{errorMessage(query.error)}</Alert>
      ) : (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-3">
            {query.data.providers.map((provider) => (
              <IntegrationCard
                key={provider.provider}
                provider={provider}
                connecting={connect.pending === provider.provider}
                onConnect={() => {
                  if (provider.provider !== 'messagemedia') connect.start(provider.provider);
                }}
              />
            ))}
          </div>
          {query.data.mailboxes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Connected mailboxes</CardTitle>
                <CardDescription>
                  Everyone connects their own Gmail; this is who has.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table aria-label="Connected mailboxes">
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Person</TableHeaderCell>
                      <TableHeaderCell>Mailbox</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <tbody>
                    {query.data.mailboxes.map((m) => (
                      <TableRow key={`${m.user}-${m.account ?? ''}`}>
                        <TableCell>{m.user}</TableCell>
                        <TableCell>{m.account}</TableCell>
                        <TableCell>
                          <Badge tone={STATUS_BADGE[m.status]?.tone ?? 'neutral'} dot>
                            {STATUS_BADGE[m.status]?.label ?? m.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
