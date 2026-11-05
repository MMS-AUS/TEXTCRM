import type { ActivityEntityType } from '@mms/shared';

/** Who a message goes to: the record it's sent from and its customer's details. */
export type Target = {
  entityType: ActivityEntityType;
  entityId: string;
  /** The customer's mobile (E.164) and email, used as the default recipient. */
  phone: string | null;
  email: string | null;
  /** Shown in the dialog title, e.g. the customer's name. */
  name: string;
};

/** Replying to a received email: it threads in Gmail and goes back to its sender. */
export type ReplyTo = { id: string; from: string; subject: string };

export const reSubject = (subject: string) => (/^re:/i.test(subject) ? subject : `Re: ${subject}`);
