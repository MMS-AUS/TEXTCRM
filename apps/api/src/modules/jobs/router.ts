import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { jobListInputSchema, WORKER_STALE_SECONDS, type JOB_STATES_SHOWN } from '@mms/shared';
import type { Db } from '../../db/client.ts';
import { JOB_SCHEMA, QUEUES, type JobQueue } from '../../jobs/queue.ts';
import { permissionProcedure, router } from '../../trpc/trpc.ts';

// Settings → Background jobs (Step 3.1). Reads pg-boss's own job table directly (read-only):
// pg-boss's API lists one queue at a time, the page needs all of them.

const jobTable = sql.raw(`${JOB_SCHEMA}.job`);

type JobRow = {
  id: string;
  name: string;
  state: (typeof JOB_STATES_SHOWN)[number];
  retry_count: number;
  retry_limit: number;
  created_on: Date;
  started_on: Date | null;
  completed_on: Date | null;
  output: unknown;
};

/** A failed job's error message (never its stack), or a completed job's short result. */
function outcome(state: string, output: unknown): string | null {
  if (output === null || typeof output !== 'object') return null;
  if (state === 'failed' || state === 'retry') {
    const message = 'message' in output ? output.message : null;
    return typeof message === 'string' ? message.slice(0, 500) : 'Failed without a message';
  }
  const text = JSON.stringify(output);
  return text === '{}' ? null : text.slice(0, 300);
}

async function installed(db: Db) {
  const result = await db.execute<{ ok: boolean }>(
    sql`select to_regclass(${`${JOB_SCHEMA}.job`}) is not null as ok`,
  );
  return result.rows[0]?.ok === true;
}

export function requireJobs(jobs: JobQueue | null): JobQueue {
  if (!jobs) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: "The job queue isn't running. Restart the API and check its log.",
    });
  }
  return jobs;
}

export const jobsRouter = router({
  overview: permissionProcedure('integrations', 'view')
    .input(jobListInputSchema)
    .query(async ({ ctx, input }) => {
      if (!(await installed(ctx.db))) {
        return { installed: false as const };
      }
      const [heartbeat, counts, rows] = await Promise.all([
        ctx.db.execute<{ last: Date | null }>(
          sql`select max(completed_on) as last from ${jobTable}
              where name = ${QUEUES.heartbeat} and state = 'completed'`,
        ),
        ctx.db.execute<{ name: string; state: string; total: number }>(
          sql`select name, state::text as state, count(*)::int as total from ${jobTable}
              where created_on > now() - interval '24 hours' group by 1, 2`,
        ),
        ctx.db.execute<JobRow>(
          sql`select id, name, state::text as state, retry_count, retry_limit, created_on,
                     started_on, completed_on, output
              from ${jobTable}
              where (name <> ${QUEUES.heartbeat} or state = 'failed')
                ${input.failedOnly ? sql`and state = 'failed'` : sql``}
                ${input.queue ? sql`and name = ${input.queue}` : sql``}
              order by created_on desc
              limit 100`,
        ),
      ]);
      const last = heartbeat.rows[0]?.last ?? null;
      const iso = (value: Date | string | null) =>
        value === null ? null : new Date(value).toISOString();
      return {
        installed: true as const,
        workerLastSeenAt: iso(last),
        workerRunning:
          last !== null && Date.now() - new Date(last).getTime() < WORKER_STALE_SECONDS * 1000,
        queues: Object.values(QUEUES).map((name) => {
          const of = (state: string) =>
            counts.rows.find((row) => row.name === name && row.state === state)?.total ?? 0;
          return {
            name,
            completed: of('completed'),
            failed: of('failed'),
            waiting: of('created') + of('retry'),
            active: of('active'),
          };
        }),
        jobs: rows.rows.map((row) => ({
          id: row.id,
          queue: row.name,
          state: row.state,
          attempts: row.retry_count + (row.state === 'created' ? 0 : 1),
          maxAttempts: row.retry_limit + 1,
          createdAt: iso(row.created_on) ?? '',
          startedAt: iso(row.started_on),
          completedAt: iso(row.completed_on),
          outcome: outcome(row.state, row.output),
        })),
      };
    }),

  retry: permissionProcedure('integrations', 'edit')
    .input(z.object({ queue: z.enum(Object.values(QUEUES)), id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireJobs(ctx.jobs).retry(input.queue, input.id);
      return { id: input.id };
    }),
});
