import { AU_STATES, formatPhone } from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  FolderKanban,
  History,
  LifeBuoy,
  MapPin,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Star,
  StickyNote,
  Trash2,
  UserRoundX,
  Zap,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ActivityTimeline } from '../../components/ActivityTimeline.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DetailList } from '../../components/DetailList.tsx';
import { FilesPanel } from '../../components/FilesPanel.tsx';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '../../ui/index.ts';
import { AddressFormDialog, type EditableAddress } from './AddressFormDialog.tsx';
import { ContactFormDialog } from './ContactFormDialog.tsx';

type Contact = RouterOutputs['contacts']['get'];
type Address = Contact['addresses'][number];

const CONTACT_FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  mobile: 'Mobile',
  secondaryMobile: 'Other phone',
  type: 'Type',
  companyId: 'Company',
  notes: 'Notes',
  streetAddress: 'Street',
  suburb: 'Suburb',
  state: 'State',
  postcode: 'Postcode',
  propertyType: 'Property',
  isPrimary: 'Primary',
  area: 'Area',
  nearestBigCity: 'Nearest city',
};

function BackLink() {
  return (
    <Link
      to="/contacts"
      className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
    >
      <ArrowLeft className="size-4" />
      Contacts
    </Link>
  );
}

function LinkedList({
  items,
  icon,
  empty,
}: {
  items: { id: string; title: ReactNode; meta: ReactNode; badge: string }[];
  icon: ReactNode;
  empty: string;
}) {
  if (items.length === 0) {
    return <EmptyState icon={icon} title={empty} />;
  }
  return (
    <ul className="flex flex-col divide-y divide-line">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{item.title}</p>
            <p className="truncate text-fg-muted">{item.meta}</p>
          </div>
          <Badge dot>{item.badge}</Badge>
        </li>
      ))}
    </ul>
  );
}

function AddressItem({
  address,
  editable,
  onEdit,
  onMakePrimary,
  onRemove,
}: {
  address: Address;
  editable: boolean;
  onEdit: () => void;
  onMakePrimary: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <MapPin className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{address.streetAddress}</p>
        <p className="text-fg-muted">
          {address.suburb} {address.state} {address.postcode}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {address.isPrimary && <Badge tone="accent">Primary</Badge>}
          {address.propertyType && <Badge>{address.propertyType}</Badge>}
          {address.area && <Badge>{address.area}</Badge>}
          {address.nearestBigCity && <Badge>Near {address.nearestBigCity}</Badge>}
        </div>
        {address.notes && <p className="mt-1.5 text-fg-muted">{address.notes}</p>}
      </div>
      {editable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`Actions for ${address.streetAddress}`} size="sm">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            {!address.isPrimary && (
              <DropdownMenuItem onSelect={onMakePrimary}>
                <Star />
                Make primary
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onRemove}>
              <Trash2 />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function toEditable(address: Address): EditableAddress {
  return { ...address };
}

function ContactView({ contact }: { contact: Contact }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [addressDialog, setAddressDialog] = useState<{ address?: EditableAddress } | null>(null);
  const [removing, setRemoving] = useState<Address | null>(null);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.contacts.pathFilter()),
      queryClient.invalidateQueries(trpc.companies.pathFilter()),
    ]);
  const archive = useMutation(trpc.contacts.archive.mutationOptions());
  const restore = useMutation(trpc.contacts.restore.mutationOptions());
  const updateAddress = useMutation(trpc.contacts.updateAddress.mutationOptions());
  const removeAddress = useMutation(trpc.contacts.removeAddress.mutationOptions());

  const archived = contact.archivedAt !== null;
  const editable = can('contacts', 'edit') && !archived;
  const name = fullName(contact);

  const makePrimary = async (address: Address) => {
    const state = AU_STATES.find((option) => option === address.state);
    if (!state) return;
    try {
      await updateAddress.mutateAsync({
        id: address.id,
        address: { ...address, state, postcode: address.postcode ?? '', isPrimary: true },
      });
      await invalidate();
      toast({ title: 'Primary address changed', tone: 'success' });
    } catch (error) {
      toast({
        title: "Couldn't change the primary address",
        description: errorMessage(error),
        tone: 'danger',
      });
    }
  };

  const tabs = [
    contact.leads && {
      value: 'leads',
      label: 'Leads',
      count: contact.leads.length,
      content: (
        <LinkedList
          icon={<Zap />}
          empty="No leads for this contact"
          items={contact.leads.map((lead) => ({
            id: lead.id,
            title: (
              <Link
                to="/leads/$leadId"
                params={{ leadId: lead.id }}
                className="hover:text-accent-text hover:underline"
              >
                {[lead.suburb, lead.state].filter(Boolean).join(' ') || 'Lead'}
              </Link>
            ),
            meta: `Created ${formatDate(lead.createdAt)}`,
            badge: lead.status,
          }))}
        />
      ),
    },
    contact.projects && {
      value: 'projects',
      label: 'Projects',
      count: contact.projects.length,
      content: (
        <LinkedList
          icon={<FolderKanban />}
          empty="No projects for this contact"
          items={contact.projects.map((project) => ({
            id: project.id,
            title: (
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="hover:text-accent-text hover:underline"
              >
                {project.projectNumber}
                {project.title ? ` · ${project.title}` : ''}
              </Link>
            ),
            meta: project.stage,
            badge: project.status,
          }))}
        />
      ),
    },
    contact.tickets && {
      value: 'tickets',
      label: 'Tickets',
      count: contact.tickets.length,
      content: (
        <LinkedList
          icon={<LifeBuoy />}
          empty="No service tickets for this contact"
          items={contact.tickets.map((ticket) => ({
            id: ticket.id,
            title: `${ticket.ticketNumber} · ${ticket.title}`,
            meta: `Opened ${formatDate(ticket.createdAt)}`,
            badge: ticket.status,
          }))}
        />
      ),
    },
  ].filter((tab) => tab !== null);

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={name} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <Badge>{contact.type}</Badge>
              {archived && (
                <Badge tone="warning" dot>
                  Archived
                </Badge>
              )}
              {contact.companyId && contact.companyName && (
                <Link
                  to="/companies/$companyId"
                  params={{ companyId: contact.companyId }}
                  className="hover:text-accent-text hover:underline"
                >
                  {contact.companyName}
                </Link>
              )}
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
          {can('contacts', 'delete') &&
            (archived ? (
              <Button
                loading={restore.isPending}
                onClick={() => {
                  void restore
                    .mutateAsync({ id: contact.id })
                    .then(invalidate)
                    .then(() => {
                      toast({ title: 'Contact restored', tone: 'success' });
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
        <Alert tone="warning" title="This contact is archived">
          It's hidden from lists and can't be edited. Restore it to make changes.
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="py-1">
              <DetailList
                items={[
                  {
                    label: 'Mobile',
                    value: contact.mobile && (
                      <a
                        href={`tel:${contact.mobile}`}
                        className="hover:text-accent-text hover:underline"
                      >
                        {formatPhone(contact.mobile)}
                      </a>
                    ),
                  },
                  { label: 'Other phone', value: formatPhone(contact.secondaryMobile) },
                  {
                    label: 'Email',
                    value: contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="hover:text-accent-text hover:underline"
                      >
                        {contact.email}
                      </a>
                    ),
                  },
                  { label: 'Type', value: contact.type },
                  { label: 'Source', value: contact.source },
                  {
                    label: 'Created',
                    value: `${formatDate(contact.createdAt)}${contact.createdByName ? ` by ${contact.createdByName}` : ''}`,
                  },
                  {
                    label: 'Updated',
                    value: `${formatDate(contact.updatedAt)}${contact.updatedByName ? ` by ${contact.updatedByName}` : ''}`,
                  },
                ]}
              />
              {contact.notes && (
                <div className="border-t border-line py-3 text-sm">
                  <p className="text-fg-muted">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap">{contact.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              actions={
                editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAddressDialog({});
                    }}
                  >
                    <Plus />
                    Add
                  </Button>
                )
              }
            >
              <CardTitle>Addresses</CardTitle>
            </CardHeader>
            <CardContent className="py-1">
              {contact.addresses.length === 0 ? (
                <p className="py-3 text-sm text-fg-muted">
                  No addresses yet. Add the property where the system will go.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {contact.addresses.map((address) => (
                    <AddressItem
                      key={address.id}
                      address={address}
                      editable={editable}
                      onEdit={() => {
                        setAddressDialog({ address: toEditable(address) });
                      }}
                      onMakePrimary={() => void makePrimary(address)}
                      onRemove={() => {
                        setRemoving(address);
                      }}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardContent>
            {/* Open on the first tab with something in it; a brand-new contact opens on History. */}
            <Tabs defaultValue="activity">
              <TabsList>
                <TabsTrigger value="activity">
                  <StickyNote />
                  Activity
                </TabsTrigger>
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                    <span className="text-xs text-fg-subtle tabular-nums">{tab.count}</span>
                  </TabsTrigger>
                ))}
                <TabsTrigger value="files">
                  <Paperclip />
                  Files
                </TabsTrigger>
                <TabsTrigger value="history">
                  <History />
                  History
                </TabsTrigger>
              </TabsList>
              {tabs.map((tab) => (
                <TabsContent key={tab.value} value={tab.value}>
                  {tab.content}
                </TabsContent>
              ))}
              <TabsContent value="activity">
                <ActivityTimeline entityType="contact" entityId={contact.id} readOnly={archived} />
              </TabsContent>
              <TabsContent value="files">
                <FilesPanel entityType="contact" entityId={contact.id} readOnly={archived} />
              </TabsContent>
              <TabsContent value="history">
                <HistoryList entries={contact.history} labels={CONTACT_FIELD_LABELS} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <ContactFormDialog open={editing} onOpenChange={setEditing} contact={contact} />
      {addressDialog && (
        <AddressFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setAddressDialog(null);
          }}
          contactId={contact.id}
          address={addressDialog.address}
          isFirst={contact.addresses.length === 0}
        />
      )}
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${name}?`}
        description="They'll be hidden from lists and search. Linked leads, projects and history are kept, and you can restore them any time."
        confirmLabel="Archive"
        destructive
        onConfirm={async () => {
          await archive.mutateAsync({ id: contact.id });
          await invalidate();
          toast({ title: 'Contact archived' });
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove this address?"
        description={
          removing
            ? `${removing.streetAddress}, ${removing.suburb} will be removed from ${name}.`
            : ''
        }
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await removeAddress.mutateAsync({ id: removing.id });
          await invalidate();
          toast({ title: 'Address removed' });
        }}
      />
    </div>
  );
}

export function ContactDetailPage() {
  const trpc = useTRPC();
  const { contactId = '' } = useParams({ strict: false });
  const query = useQuery(trpc.contacts.get.queryOptions({ id: contactId }));

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <BackLink />
        <div className="flex items-center gap-4">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-6 w-56" />
        </div>
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
              icon={<UserRoundX />}
              title="Contact not found"
              description="It may have been mistyped in the address bar."
            />
          </Card>
        ) : (
          <Alert tone="danger">{errorMessage(query.error)}</Alert>
        )}
      </div>
    );
  }
  return <ContactView contact={query.data} />;
}
