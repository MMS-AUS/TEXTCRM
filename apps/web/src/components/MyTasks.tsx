import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleCheckBig } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../lib/errors.ts';
import { formatDateTime } from '../lib/format.ts';
import { useTRPC } from '../lib/trpc.ts';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Skeleton,
  toast,
} from '../ui/index.ts';

function endOfToday(): string {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

/** Tasks assigned to me that are due today or overdue. */
export function MyTasks() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // Fixed for the life of the page so the query key stays stable.
  const [before] = useState(endOfToday);
  const tasks = useQuery(trpc.activities.myTasks.queryOptions({ before }));
  const complete = useMutation(trpc.activities.setCompleted.mutationOptions());

  return (
    <Card>
      <CardHeader>
        <CardTitle>My tasks</CardTitle>
        <CardDescription>Due today or overdue</CardDescription>
      </CardHeader>
      <CardContent className="pt-1">
        {tasks.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : tasks.isError ? (
          <Alert tone="danger">{errorMessage(tasks.error)}</Alert>
        ) : tasks.data.length === 0 ? (
          <EmptyState icon={<CircleCheckBig />} title="All caught up" className="py-6" />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {tasks.data.map((task) => {
              const overdue = task.dueAt !== null && new Date(task.dueAt) < new Date();
              return (
                <li key={task.id} className="flex items-start gap-3 py-2.5 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    aria-label={`Mark "${task.subject ?? 'task'}" as done`}
                    onCheckedChange={() => {
                      void complete
                        .mutateAsync({ id: task.id, completed: true })
                        .then(() => queryClient.invalidateQueries(trpc.activities.pathFilter()))
                        .catch((error: unknown) => {
                          toast({
                            title: "Couldn't complete the task",
                            description: errorMessage(error),
                            tone: 'danger',
                          });
                        });
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{task.subject}</p>
                    <p className="flex flex-wrap items-center gap-2 text-fg-muted">
                      {task.entityType === 'lead' ? (
                        <Link
                          to="/leads/$leadId"
                          params={{ leadId: task.entityId }}
                          className="hover:text-accent-text hover:underline"
                        >
                          {task.entityName ?? 'Lead'}
                        </Link>
                      ) : task.entityType === 'contact' ? (
                        <Link
                          to="/contacts/$contactId"
                          params={{ contactId: task.entityId }}
                          className="hover:text-accent-text hover:underline"
                        >
                          {task.entityName ?? 'Contact'}
                        </Link>
                      ) : null}
                      {task.dueAt && (
                        <Badge tone={overdue ? 'danger' : 'warning'}>
                          {overdue ? 'Overdue · ' : ''}
                          {formatDateTime(task.dueAt)}
                        </Badge>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
