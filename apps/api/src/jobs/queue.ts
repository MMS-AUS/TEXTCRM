import { PgBoss, type Queue } from 'pg-boss';
import { JOB_QUEUES, type JobQueueName } from '@mms/shared';

// Background jobs (Step 3.1) run on pg-boss: the queue lives in Postgres (schema `pgboss`, which
// pg-boss creates and migrates itself), so there is no Redis. The API only sends jobs; the
// worker process (src/worker.ts) runs them.

/** Queue names live in @mms/shared so Settings can label them. */
export const QUEUES = JOB_QUEUES;

export type QueueName = JobQueueName;

export const JOB_SCHEMA = 'pgboss';

const DAY = 24 * 3600;

/** Retries back off (30 s, 1 min, 2 min…); a job that keeps failing ends in the dead-letter queue. */
const QUEUE_OPTIONS: Record<Exclude<QueueName, 'dead-letter'>, Omit<Queue, 'name'>> = {
  'system-heartbeat': { retryLimit: 0, expireInSeconds: 60, deleteAfterSeconds: DAY },
  'files-cleanup-pending': { retryLimit: 3, retryDelay: 60, retryBackoff: true },
  'imports-run': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 1800 },
  // One sync at a time: a slow run is never overlapped by the next one.
  'sheets-sync': {
    policy: 'singleton',
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
  },
};

/** What the API needs from the queue; a fake stands in for it in tests. */
export interface JobQueue {
  send(name: QueueName, data: object): Promise<string | null>;
  /** Puts a failed job back in the queue. */
  retry(name: string, id: string): Promise<void>;
}

export function createBoss(connectionString: string, role: 'api' | 'worker'): PgBoss {
  return new PgBoss({
    connectionString,
    schema: JOB_SCHEMA,
    application_name: `mms-${role}`,
    // Only the worker runs maintenance and cron; the API just sends jobs.
    supervise: role === 'worker',
    schedule: role === 'worker',
  });
}

/** Creates (or updates) every queue with its retry policy and dead-letter queue. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  if (!(await boss.getQueue(QUEUES.deadLetter))) {
    await boss.createQueue(QUEUES.deadLetter, { retentionSeconds: 30 * DAY });
  }
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
    if (await boss.getQueue(name)) {
      // The policy is fixed when a queue is created; the retry settings can change.
      // pg-boss rejects keys set to undefined, so only the ones this queue defines are sent.
      await boss.updateQueue(name, {
        ...(options.retryLimit !== undefined && { retryLimit: options.retryLimit }),
        ...(options.retryDelay !== undefined && { retryDelay: options.retryDelay }),
        ...(options.retryBackoff !== undefined && { retryBackoff: options.retryBackoff }),
        ...(options.expireInSeconds !== undefined && { expireInSeconds: options.expireInSeconds }),
        ...(options.deleteAfterSeconds !== undefined && {
          deleteAfterSeconds: options.deleteAfterSeconds,
        }),
        deadLetter: QUEUES.deadLetter,
      });
    } else {
      await boss.createQueue(name, { ...options, deadLetter: QUEUES.deadLetter });
    }
  }
}

export function jobQueue(boss: PgBoss): JobQueue {
  return {
    send: (name, data) => boss.send(name, data),
    retry: async (name, id) => {
      await boss.retry(name, id);
    },
  };
}
