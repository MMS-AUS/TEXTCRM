import { z } from 'zod';

/** Background job queues (Step 3.1) and what each does, for Settings → Background jobs. */
export const JOB_QUEUES = {
  heartbeat: 'system-heartbeat',
  cleanupUploads: 'files-cleanup-pending',
  runImport: 'imports-run',
  syncSheets: 'sheets-sync',
  syncGmail: 'gmail-sync',
  deadLetter: 'dead-letter',
} as const;

export type JobQueueName = (typeof JOB_QUEUES)[keyof typeof JOB_QUEUES];

export const JOB_QUEUE_LABELS: Record<JobQueueName, { label: string; description: string }> = {
  'system-heartbeat': {
    label: 'Heartbeat',
    description: 'Every minute — shows the worker is running',
  },
  'files-cleanup-pending': {
    label: 'Upload clean-up',
    description: 'Hourly — removes uploads that were never finished',
  },
  'imports-run': { label: 'Imports', description: 'Runs a confirmed import from the wizard' },
  'sheets-sync': { label: 'Sheet sync', description: 'Reads the live leads sheets' },
  'gmail-sync': {
    label: 'Gmail inbox sync',
    description:
      'Customer emails from connected mailboxes — on each Gmail push, and every 2 minutes',
  },
  'dead-letter': { label: 'Failed after retries', description: 'Jobs that failed every attempt' },
};

export const JOB_STATES_SHOWN = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
] as const;

export const jobListInputSchema = z.object({
  failedOnly: z.boolean().default(false),
  queue: z.enum(Object.values(JOB_QUEUES)).optional(),
});

/** The worker counts as running if its heartbeat (every minute) completed recently. */
export const WORKER_STALE_SECONDS = 180;
