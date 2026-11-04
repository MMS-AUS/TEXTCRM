import type { ImportAction, ImportTarget } from '@mms/shared';
import type { BadgeTone } from '../../../ui/index.ts';

export const TARGET_LABELS: Record<ImportTarget, string> = { leads: 'Leads', contacts: 'Contacts' };

export const STATUS_LABELS: Record<string, string> = {
  uploading: 'Uploading',
  ready: 'Mapping columns',
  previewed: 'Previewed',
  queued: 'Waiting to run',
  running: 'Importing',
  completed: 'Done',
  failed: 'Stopped — retrying',
};

export const STATUS_TONES: Record<string, BadgeTone> = {
  uploading: 'neutral',
  ready: 'neutral',
  previewed: 'accent',
  queued: 'info',
  running: 'info',
  completed: 'success',
  failed: 'danger',
};

export const ACTION_TONES: Record<ImportAction, BadgeTone> = {
  create: 'success',
  update: 'info',
  skip: 'neutral',
  error: 'danger',
};

/** Before the run the preview says what will happen; afterwards, what did. */
export const ACTION_LABELS: Record<'planned' | 'done', Record<ImportAction, string>> = {
  planned: { create: 'Will create', update: 'Will update', skip: 'Will skip', error: 'Error' },
  done: { create: 'Created', update: 'Updated', skip: 'Skipped', error: 'Error' },
};
