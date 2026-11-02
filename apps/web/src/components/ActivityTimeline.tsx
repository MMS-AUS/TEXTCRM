import {
  ACTIVITY_ENTITY_FEATURE,
  activityInputSchema,
  CALL_OUTCOMES,
  type ActivityEntityType,
  type ActivityInput,
} from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  ListTodo,
  MoreHorizontal,
  Phone,
  PhoneIncoming,
  Sparkles,
  StickyNote,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useProfile } from '../auth/auth-context.ts';
import { errorMessage } from '../lib/errors.ts';
import { formatDateTime, formatRelative } from '../lib/format.ts';
import { useCan, useUsers } from '../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../lib/trpc.ts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  Tooltip,
} from '../ui/index.ts';

type Activity = RouterOutputs['activities']['list'][number];
const KINDS = ['note', 'call', 'task', 'meeting'] as const;
type Kind = (typeof KINDS)[number];

/** 'YYYY-MM-DDTHH:mm' in the browser's time zone, for <input type="datetime-local">. */
function localInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIso(local: string): string {
  return local ? new Date(local).toISOString() : '';
}

function tomorrowAtNine(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return localInputValue(date);
}

const OUTCOMES = CALL_OUTCOMES.map((outcome) => ({ value: outcome, label: outcome }));

function Composer({ entityType, entityId }: { entityType: ActivityEntityType; entityId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const users = useUsers();
  const create = useMutation(trpc.activities.create.mutationOptions());
  const [kind, setKind] = useState<Kind>('note');
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [outcome, setOutcome] = useState<string>('Answered');
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [duration, setDuration] = useState('');
  const [due, setDue] = useState(tomorrowAtNine);
  const [when, setWhen] = useState(() => localInputValue(new Date()));
  const [assignee, setAssignee] = useState(profile.id);

  const reset = () => {
    setBody('');
    setSubject('');
    setDuration('');
    setDue(tomorrowAtNine());
    setWhen(localInputValue(new Date()));
    setError(null);
  };

  const input = (): ActivityInput => {
    const base = { entityType, entityId };
    switch (kind) {
      case 'note':
        return { ...base, type: 'note', body };
      case 'call':
        return {
          ...base,
          type: 'call',
          direction,
          outcome: CALL_OUTCOMES.find((o) => o === outcome) ?? 'Answered',
          durationMinutes: duration === '' ? null : Number(duration),
          body,
        };
      case 'task':
        return {
          ...base,
          type: 'task',
          subject,
          dueAt: toIso(due),
          assignedUserId: assignee,
          body,
        };
      case 'meeting':
        return { ...base, type: 'meeting', subject, occurredAt: toIso(when), body };
    }
  };

  const submit = async () => {
    const parsed = activityInputSchema.safeParse(input());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the details.');
      return;
    }
    setError(null);
    try {
      await create.mutateAsync(parsed.data);
      await Promise.all([
        queryClient.invalidateQueries(trpc.activities.pathFilter()),
        queryClient.invalidateQueries(trpc.leads.get.pathFilter()),
      ]);
      toast({ title: `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)} added`, tone: 'success' });
      reset();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const notes = (placeholder: string) => (
    <Textarea
      aria-label="Notes"
      value={body}
      onChange={(event) => {
        setBody(event.target.value);
      }}
      placeholder={placeholder}
      rows={3}
    />
  );

  return (
    <div className="rounded-lg border border-line bg-surface-2/40 p-3">
      <Tabs
        value={kind}
        onValueChange={(value) => {
          const next = KINDS.find((option) => option === value);
          if (next) setKind(next);
          setError(null);
        }}
      >
        <TabsList>
          <TabsTrigger value="note">
            <StickyNote />
            Note
          </TabsTrigger>
          <TabsTrigger value="call">
            <Phone />
            Call
          </TabsTrigger>
          <TabsTrigger value="task">
            <ListTodo />
            Task
          </TabsTrigger>
          <TabsTrigger value="meeting">
            <UsersRound />
            Meeting
          </TabsTrigger>
        </TabsList>
        <TabsContent value="note" className="pt-3">
          {notes('What happened? e.g. Sent the proposal, customer wants a battery quote.')}
        </TabsContent>
        <TabsContent value="call" className="flex flex-col gap-3 pt-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Outcome">
              {(props) => (
                <Select {...props} value={outcome} onValueChange={setOutcome} options={OUTCOMES} />
              )}
            </Field>
            <Field label="Direction">
              {(props) => (
                <Select
                  {...props}
                  value={direction}
                  onValueChange={(value) => {
                    setDirection(value === 'inbound' ? 'inbound' : 'outbound');
                  }}
                  options={[
                    { value: 'outbound', label: 'We called' },
                    { value: 'inbound', label: 'They called' },
                  ]}
                />
              )}
            </Field>
            <Field label="Minutes">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={duration}
                  onChange={(event) => {
                    setDuration(event.target.value);
                  }}
                />
              )}
            </Field>
          </div>
          {notes('What was discussed?')}
        </TabsContent>
        <TabsContent value="task" className="flex flex-col gap-3 pt-3">
          <Field label="Task">
            {(props) => (
              <Input
                {...props}
                value={subject}
                onChange={(event) => {
                  setSubject(event.target.value);
                }}
                placeholder="e.g. Call back about the battery quote"
              />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Due">
              {(props) => (
                <Input
                  {...props}
                  type="datetime-local"
                  value={due}
                  onChange={(event) => {
                    setDue(event.target.value);
                  }}
                />
              )}
            </Field>
            <Field label="For">
              {(props) => (
                <Select
                  {...props}
                  value={assignee}
                  onValueChange={setAssignee}
                  options={(users.data ?? []).map((user) => ({
                    value: user.id,
                    label: user.id === profile.id ? `${user.name} (me)` : user.name,
                  }))}
                />
              )}
            </Field>
          </div>
        </TabsContent>
        <TabsContent value="meeting" className="flex flex-col gap-3 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="About">
              {(props) => (
                <Input
                  {...props}
                  value={subject}
                  onChange={(event) => {
                    setSubject(event.target.value);
                  }}
                  placeholder="e.g. Site survey"
                />
              )}
            </Field>
            <Field label="When">
              {(props) => (
                <Input
                  {...props}
                  type="datetime-local"
                  value={when}
                  onChange={(event) => {
                    setWhen(event.target.value);
                  }}
                />
              )}
            </Field>
          </div>
          {notes('Notes from the meeting')}
        </TabsContent>
      </Tabs>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          size="sm"
          loading={create.isPending}
          onClick={() => void submit()}
        >
          Add {kind}
        </Button>
      </div>
    </div>
  );
}

const ICONS: Record<Activity['type'], ReactNode> = {
  note: <StickyNote />,
  call: <Phone />,
  meeting: <UsersRound />,
  task: <ListTodo />,
  system: <Sparkles />,
};

function dueTone(dueAt: string): 'danger' | 'warning' | 'neutral' {
  const due = new Date(dueAt);
  const now = new Date();
  if (due < now) return 'danger';
  return due.toDateString() === now.toDateString() ? 'warning' : 'neutral';
}

function Entry({
  activity,
  canEdit,
  canRemove,
  onToggle,
  onRemove,
}: {
  activity: Activity;
  canEdit: boolean;
  canRemove: boolean;
  onToggle: (completed: boolean) => void;
  onRemove: () => void;
}) {
  const author = activity.authorName ?? 'The CRM';
  const isTask = activity.type === 'task';
  const done = activity.completedAt !== null;

  let title: ReactNode;
  switch (activity.type) {
    case 'note':
      title = `${author} added a note`;
      break;
    case 'call':
      title = (
        <>
          {author} logged {activity.direction === 'inbound' ? 'an incoming' : 'a'} call
          {activity.outcome && (
            <Badge className="ml-2" tone={activity.outcome === 'Answered' ? 'success' : 'neutral'}>
              {activity.outcome}
            </Badge>
          )}
          {activity.durationMinutes ? (
            <span className="text-fg-muted"> · {activity.durationMinutes} min</span>
          ) : null}
        </>
      );
      break;
    case 'meeting':
      title = `${author} logged a meeting: ${activity.subject ?? ''}`;
      break;
    case 'task':
      title = <span className={cn(done && 'text-fg-muted line-through')}>{activity.subject}</span>;
      break;
    case 'system':
      title = activity.subject;
      break;
  }

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      <span
        aria-hidden
        className="absolute top-8 bottom-0 left-4 w-px bg-line [li:last-child>&]:hidden"
      />
      <span
        className={cn(
          'relative grid size-8 shrink-0 place-items-center rounded-full border border-line bg-surface text-fg-muted [&_svg]:size-4',
          activity.type === 'system' && 'bg-surface-2 text-fg-subtle',
          isTask && !done && 'border-accent/40 text-accent-text',
        )}
      >
        {activity.type === 'call' && activity.direction === 'inbound' ? (
          <PhoneIncoming />
        ) : (
          ICONS[activity.type]
        )}
      </span>
      <div className="min-w-0 flex-1 pt-1 text-sm">
        <div className="flex items-start gap-2">
          {isTask && (
            <Checkbox
              className="mt-0.5"
              aria-label={done ? 'Mark as not done' : 'Mark as done'}
              checked={done}
              disabled={!canEdit}
              onCheckedChange={(checked) => {
                onToggle(checked === true);
              }}
            />
          )}
          <p className={cn('min-w-0 flex-1', activity.type === 'system' && 'text-fg-muted')}>
            {title}
          </p>
          {canRemove && activity.type !== 'system' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Entry actions" size="sm" className="-mt-1">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem destructive onSelect={onRemove}>
                  <Trash2 />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {isTask && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            {activity.dueAt && (
              <Badge tone={done ? 'neutral' : dueTone(activity.dueAt)}>
                <CalendarClock className="size-3" />
                Due {formatDateTime(activity.dueAt)}
              </Badge>
            )}
            {activity.assigneeName && <span>for {activity.assigneeName}</span>}
            <span>· added by {author}</span>
          </div>
        )}
        {activity.body && <p className="mt-1.5 whitespace-pre-wrap text-fg">{activity.body}</p>}
        <Tooltip content={formatDateTime(activity.occurredAt)}>
          <time
            dateTime={activity.occurredAt}
            tabIndex={0}
            className="mt-1 inline-block text-xs text-fg-subtle"
          >
            {activity.type === 'meeting'
              ? formatDateTime(activity.occurredAt)
              : formatRelative(activity.occurredAt)}
          </time>
        </Tooltip>
      </div>
    </li>
  );
}

/** A record's timeline: log notes, calls, tasks and meetings; see everything that happened. */
export function ActivityTimeline({
  entityType,
  entityId,
  readOnly = false,
}: {
  entityType: ActivityEntityType;
  entityId: string;
  readOnly?: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const can = useCan();
  const query = useQuery(trpc.activities.list.queryOptions({ entityType, entityId }));
  const setCompleted = useMutation(trpc.activities.setCompleted.mutationOptions());
  const remove = useMutation(trpc.activities.remove.mutationOptions());
  const feature = ACTIVITY_ENTITY_FEATURE[entityType];
  const canEdit = !readOnly && can(feature, 'edit');

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.activities.pathFilter()),
      queryClient.invalidateQueries(trpc.leads.get.pathFilter()),
    ]);
  const run = (action: Promise<unknown>, failure: string) =>
    action.then(refresh).catch((error: unknown) => {
      toast({ title: failure, description: errorMessage(error), tone: 'danger' });
    });

  const openTasks = query.data?.filter((a) => a.type === 'task' && !a.completedAt) ?? [];
  const rest = query.data?.filter((a) => !(a.type === 'task' && !a.completedAt)) ?? [];
  const entry = (activity: Activity) => (
    <Entry
      key={activity.id}
      activity={activity}
      canEdit={canEdit}
      canRemove={
        !readOnly &&
        (activity.authorUserId === profile.id ? can(feature, 'edit') : can(feature, 'delete'))
      }
      onToggle={(completed) =>
        void run(
          setCompleted.mutateAsync({ id: activity.id, completed }),
          "Couldn't update the task",
        )
      }
      onRemove={() => void run(remove.mutateAsync({ id: activity.id }), "Couldn't remove it")}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      {canEdit && <Composer entityType={entityType} entityId={entityId} />}
      {query.isPending ? (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex flex-1 flex-col gap-2 pt-1">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <Alert tone="danger">{errorMessage(query.error)}</Alert>
      ) : query.data.length === 0 ? (
        <EmptyState icon={<StickyNote />} title="Nothing logged yet" />
      ) : (
        <>
          {openTasks.length > 0 && (
            <section aria-label="Open tasks">
              <p className="mb-3 text-xs font-medium tracking-wide text-fg-subtle uppercase">
                Open tasks
              </p>
              <ol>{openTasks.map(entry)}</ol>
            </section>
          )}
          <section aria-label="Timeline">
            {openTasks.length > 0 && (
              <p className="mb-3 text-xs font-medium tracking-wide text-fg-subtle uppercase">
                Timeline
              </p>
            )}
            <ol>{rest.map(entry)}</ol>
          </section>
        </>
      )}
    </div>
  );
}
