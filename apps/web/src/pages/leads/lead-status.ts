import { LEAD_CONVERTED, LEAD_LOST, LEAD_PIPELINE } from '@mms/shared';
import type { BadgeTone } from '../../ui/index.ts';

/** Every status in display order: the pipeline, then the two end states. */
export const LEAD_STATUSES: readonly string[] = [...LEAD_PIPELINE, LEAD_CONVERTED, LEAD_LOST];

const TONES: Record<string, BadgeTone> = {
  New: 'info',
  Contacted: 'accent',
  'Site Survey Scheduled': 'accent',
  'Proposal Sent': 'warning',
  'Contract Signed': 'success',
  'Deposit Received': 'success',
  [LEAD_CONVERTED]: 'success',
  [LEAD_LOST]: 'neutral',
};

export function statusTone(status: string): BadgeTone {
  return TONES[status] ?? 'neutral';
}

/** Monday of this week in the business time zone, as YYYY-MM-DD ("New this week" filter). */
export function startOfWeek(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}
