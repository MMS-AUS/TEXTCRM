import { abnLookupUrl, formatAbn, formatPhone } from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Building2,
  ExternalLink,
  History,
  Pencil,
  Plus,
  UsersRound,
} from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DetailList } from '../../components/DetailList.tsx';
import { HistoryList } from '../../components/HistoryList.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { formatDate, fullName } from '../../lib/format.ts';
import { useCan } from '../../lib/hooks.ts';
import { trpcErrorCode, useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '../../ui/index.ts';
import { ContactFormDialog } from '../contacts/ContactFormDialog.tsx';
import { CompanyFormDialog } from './CompanyFormDialog.tsx';

type Company = RouterOutputs['companies']['get'];

const COMPANY_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  type: 'Type',
  abn: 'ABN',
  abnVerified: 'ABN verified',
  phone: 'Phone',
  email: 'Email',
  website: 'Website',
  streetAddress: 'Street',
  suburb: 'Suburb',
  state: 'State',
  postcode: 'Postcode',
  notes: 'Notes',
};

function BackLink() {
  return (
    <Link
      to="/companies"
      className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
    >
      <ArrowLeft className="size-4" />
      Companies
    </Link>
  );
}

function CompanyView({ company }: { company: Company }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const can = useCan();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const archive = useMutation(trpc.companies.archive.mutationOptions());
  const restore = useMutation(trpc.companies.restore.mutationOptions());

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.companies.pathFilter()),
      queryClient.invalidateQueries(trpc.contacts.pathFilter()),
    ]);
  const archived = company.archivedAt !== null;
  const editable = can('companies', 'edit') && !archived;
  const address = [
    company.streetAddress,
    [company.suburb, company.state, company.postcode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent-text">
            <Building2 className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{company.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              {company.type && <Badge>{company.type}</Badge>}
              {archived && (
                <Badge tone="warning" dot>
                  Archived
                </Badge>
              )}
              {company.abn && <span className="tabular-nums">ABN {formatAbn(company.abn)}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editable && (
            <Button
              onClick={() => {
                setEditing(true);
              }}
            >
              <Pencil />
              Edit
            </Button>
          )}
          {can('companies', 'delete') &&
            (archived ? (
              <Button
                loading={restore.isPending}
                onClick={() => {
                  void restore
                    .mutateAsync({ id: company.id })
                    .then(invalidate)
                    .then(() => {
                      toast({ title: 'Company restored', tone: 'success' });
                    })
                    .catch((error: unknown) => {
                      toast({
                        title: "Couldn't restore",
                        description: errorMessage(error),
                        tone: 'danger',
                      });
                    });
                }}
              >
                <ArchiveRestore />
                Restore
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  setArchiving(true);
                }}
              >
                <Archive />
                Archive
              </Button>
            ))}
        </div>
      </div>

      {archived && (
        <Alert tone="warning" title="This company is archived">
          It's hidden from lists and pickers and can't be edited. Restore it to make changes.
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="py-1">
            <DetailList
              items={[
                {
                  label: 'ABN',
                  value: company.abn && (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">{formatAbn(company.abn)}</span>
                      <a
                        href={abnLookupUrl(company.abn)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
                      >
                        ABN Lookup
                        <ExternalLink className="size-3" />
                      </a>
                    </span>
                  ),
                },
                {
                  label: 'Phone',
                  value: company.phone && (
                    <a
                      href={`tel:${company.phone}`}
                      className="hover:text-accent-text hover:underline"
                    >
                      {formatPhone(company.phone)}
                    </a>
                  ),
                },
                {
                  label: 'Email',
                  value: company.email && (
                    <a
                      href={`mailto:${company.email}`}
                      className="hover:text-accent-text hover:underline"
                    >
                      {company.email}
                    </a>
                  ),
                },
                {
                  label: 'Website',
                  value: company.website && (
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-accent-text hover:underline"
                    >
                      {company.website.replace(/^https?:\/\//, '')}
                    </a>
                  ),
                },
                { label: 'Address', value: address },
                {
                  label: 'Created',
                  value: `${formatDate(company.createdAt)}${company.createdByName ? ` by ${company.createdByName}` : ''}`,
                },
                {
                  label: 'Updated',
                  value: `${formatDate(company.updatedAt)}${company.updatedByName ? ` by ${company.updatedByName}` : ''}`,
                },
              ]}
            />
            {company.notes && (
              <div className="border-t border-line py-3 text-sm">
                <p className="text-fg-muted">Notes</p>
                <p className="mt-1 whitespace-pre-wrap">{company.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent>
            <Tabs defaultValue="contacts">
              <TabsList>
                <TabsTrigger value="contacts">
                  People
                  <span className="text-xs text-fg-subtle tabular-nums">
                    {company.contacts.length}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="history">
                  <History />
                  History
                </TabsTrigger>
              </TabsList>
              <TabsContent value="contacts">
                {can('contacts', 'create') && !archived && (
                  <div className="mb-2 flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => {
                        setAddingContact(true);
                      }}
                    >
                      <Plus />
                      Add person
                    </Button>
                  </div>
                )}
                {company.contacts.length === 0 ? (
                  <EmptyState icon={<UsersRound />} title="No people linked to this company" />
                ) : (
                  <ul className="flex flex-col divide-y divide-line">
                    {company.contacts.map((person) => (
                      <li key={person.id} className="flex items-center gap-3 py-3 text-sm">
                        <Avatar name={fullName(person)} />
                        <div className="min-w-0 flex-1">
                          <Link
                            to="/contacts/$contactId"
                            params={{ contactId: person.id }}
                            className="font-medium hover:text-accent-text hover:underline"
                          >
                            {fullName(person)}
                          </Link>
                          <p className="truncate text-fg-muted">
                            {[formatPhone(person.mobile), person.email].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <Badge>{person.type}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="history">
                <HistoryList entries={company.history} labels={COMPANY_FIELD_LABELS} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <CompanyFormDialog open={editing} onOpenChange={setEditing} company={company} />
      <ContactFormDialog
        open={addingContact}
        onOpenChange={setAddingContact}
        defaultCompany={{ id: company.id, name: company.name }}
        onSaved={(id) => {
          void navigate({ to: '/contacts/$contactId', params: { contactId: id } });
        }}
      />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${company.name}?`}
        description="It will be hidden from lists and pickers. People stay linked to it, and you can restore it any time."
        confirmLabel="Archive"
        destructive
        onConfirm={async () => {
          await archive.mutateAsync({ id: company.id });
          await invalidate();
          toast({ title: 'Company archived' });
        }}
      />
    </div>
  );
}

export function CompanyDetailPage() {
  const trpc = useTRPC();
  const { companyId = '' } = useParams({ strict: false });
  const query = useQuery(trpc.companies.get.queryOptions({ id: companyId }));

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <BackLink />
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-72" />
          <Skeleton className="h-72 lg:col-span-2" />
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
              icon={<Building2 />}
              title="Company not found"
              description="It may have been mistyped in the address bar."
            />
          </Card>
        ) : (
          <Alert tone="danger">{errorMessage(query.error)}</Alert>
        )}
      </div>
    );
  }
  return <CompanyView company={query.data} />;
}
