import { isTicketClosed, TICKET_PRIORITIES, type TicketPriority } from '@mms/shared';
import type { BadgeTone } from '../../ui/index.ts';

export const PRIORITY_TONES: Record<TicketPriority, BadgeTone> = {
  Low: 'neutral',
  Medium: 'info',
  High: 'warning',
  Urgent: 'danger',
};

export function priorityTone(priority: string): BadgeTone {
  const known = TICKET_PRIORITIES.find((p) => p === priority);
  return known ? PRIORITY_TONES[known] : 'neutral';
}

/** Closed → green or grey; waiting on a brand or parts → amber; everything else in progress. */
export function ticketStatusTone(status: string): BadgeTone {
  if (isTicketClosed(status)) return status.startsWith('Resolved') ? 'success' : 'neutral';
  if (/warranty|awaiting/i.test(status)) return 'warning';
  return 'accent';
}

/** "3 days" / "today". */
export function ageLabel(days: number): string {
  if (days === 0) return 'today';
  return `${String(days)} day${days === 1 ? '' : 's'}`;
}
