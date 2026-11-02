import { z } from 'zod';
import { optionalText } from './contacts.ts';
import type { Feature } from './permissions.ts';

/** Activity types a person can log (system activities are written by the CRM). */
export const LOGGABLE_ACTIVITY_TYPES = ['note', 'call', 'meeting', 'task'] as const;
export const ACTIVITY_ENTITY_TYPES = ['lead', 'contact', 'project', 'ticket'] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

/** Which permission guards each record type's timeline. */
export const ACTIVITY_ENTITY_FEATURE: Record<ActivityEntityType, Feature> = {
  lead: 'leads',
  contact: 'contacts',
  project: 'projects',
  ticket: 'tickets',
};

export const CALL_OUTCOMES = [
  'Answered',
  'No answer',
  'Left voicemail',
  'Busy',
  'Wrong number',
] as const;

const entity = {
  entityType: z.enum(ACTIVITY_ENTITY_TYPES),
  entityId: z.uuid(),
};

const optionalInstant = z.iso
  .datetime({ offset: true })
  .nullish()
  .or(z.literal(''))
  .transform((value) => value || null);

export const activityInputSchema = z.discriminatedUnion('type', [
  z.object({
    ...entity,
    type: z.literal('note'),
    body: z.string().trim().min(1, 'Write the note.').max(10_000),
  }),
  z.object({
    ...entity,
    type: z.literal('call'),
    direction: z.enum(['outbound', 'inbound']).default('outbound'),
    outcome: z.enum(CALL_OUTCOMES),
    durationMinutes: z.number().int().min(0).max(600).nullish(),
    body: optionalText(10_000),
  }),
  z.object({
    ...entity,
    type: z.literal('meeting'),
    subject: z.string().trim().min(1, 'Say what the meeting was about.').max(200),
    occurredAt: optionalInstant,
    body: optionalText(10_000),
  }),
  z.object({
    ...entity,
    type: z.literal('task'),
    subject: z.string().trim().min(1, 'Say what needs doing.').max(200),
    dueAt: z.iso.datetime({ offset: true, error: 'Choose when it is due.' }),
    assignedUserId: z
      .uuid()
      .nullish()
      .or(z.literal(''))
      .transform((value) => value || null),
    body: optionalText(10_000),
  }),
]);

export type ActivityInput = z.input<typeof activityInputSchema>;
