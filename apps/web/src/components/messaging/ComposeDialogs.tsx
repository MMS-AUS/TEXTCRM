import { countSms, formatPhone, MAX_SMS_SEGMENTS } from '@mms/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, MessageSquare, Send } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../lib/errors.ts';
import { useCan } from '../../lib/hooks.ts';
import { useTRPC } from '../../lib/trpc.ts';
import {
  Alert,
  Button,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Textarea,
  toast,
} from '../../ui/index.ts';
import { ACTIVITY_ENTITY_FEATURE } from '@mms/shared';
import { EmailDialog } from './EmailComposer.tsx';
import type { Target } from './types.ts';

export type { ReplyTo, Target } from './types.ts';

function useRefreshMessages() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.messaging.pathFilter()),
      queryClient.invalidateQueries(trpc.activities.pathFilter()),
    ]);
}

/** "123 / 160 · 1 SMS" — the same count the server makes (shared countSms). */
export function SmsCounter({ text }: { text: string }) {
  const count = countSms(text);
  const tooLong = count.segments > MAX_SMS_SEGMENTS;
  return (
    <div className="flex flex-col gap-1 text-xs" aria-live="polite">
      <p className={cn('tabular-nums', tooLong ? 'text-danger-text' : 'text-fg-muted')}>
        {count.units} characters ·{' '}
        {count.segments === 1 ? '1 SMS' : `${String(count.segments)} SMS parts`} · {count.remaining}{' '}
        left in this part
        <span className="text-fg-subtle"> · {count.encoding}</span>
      </p>
      {count.encoding === 'UCS-2' && (
        <p className="text-warning-text">
          An emoji or special character (such as curly quotes) is in the message, so each SMS part
          fits 70 characters instead of 160.
        </p>
      )}
      {tooLong && <p className="text-danger-text">Keep it to {MAX_SMS_SEGMENTS} parts or fewer.</p>}
    </div>
  );
}

function SmsForm({ target, onDone }: { target: Target; onDone: () => void }) {
  const trpc = useTRPC();
  const refresh = useRefreshMessages();
  const send = useMutation(trpc.messaging.sendSms.mutationOptions());
  const [to, setTo] = useState(target.phone ? formatPhone(target.phone) : '');
  const [content, setContent] = useState('');
  const count = countSms(content);
  const ready =
    content.trim().length > 0 && to.trim().length > 0 && count.segments <= MAX_SMS_SEGMENTS;

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        send
          .mutateAsync({
            entityType: target.entityType,
            entityId: target.entityId,
            to: target.phone && to === formatPhone(target.phone) ? undefined : to,
            content,
          })
          .then(async (result) => {
            await refresh();
            toast({
              title: `SMS sent to ${formatPhone(result.to)}`,
              description: result.deliveryReports
                ? 'Its delivery status updates in Messages.'
                : 'Delivery reports need the CRM on a public address, so the status stays "sent".',
              tone: 'success',
            });
            onDone();
          })
          .catch(async () => {
            await refresh(); // the failed attempt is logged
          });
      }}
    >
      <DialogBody className="flex flex-col gap-4">
        {send.isError && <Alert tone="danger">{errorMessage(send.error)}</Alert>}
        <Field
          label="To"
          required
          hint={target.phone ? undefined : 'This record has no mobile — type the number.'}
        >
          {(props) => (
            <Input
              {...props}
              type="tel"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Message" required>
          {(props) => (
            <Textarea
              {...props}
              rows={5}
              autoFocus
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
              }}
            />
          )}
        </Field>
        <SmsCounter text={content} />
        <p className="text-xs text-fg-muted">
          Sent from your SMS sender ID, or the business’s if you don’t have one.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={send.isPending} disabled={!ready}>
          <Send />
          Send SMS
        </Button>
      </DialogFooter>
    </form>
  );
}

/** "Send SMS" and "Send email" for a record page; only for people who may edit the record. */
export function ComposeButtons({
  target,
  disabled = false,
}: {
  target: Target;
  disabled?: boolean;
}) {
  const can = useCan();
  const [open, setOpen] = useState<'sms' | 'email' | null>(null);
  if (!can(ACTIVITY_ENTITY_FEATURE[target.entityType], 'edit')) return null;
  const close = () => {
    setOpen(null);
  };
  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => {
          setOpen('sms');
        }}
      >
        <MessageSquare />
        Send SMS
      </Button>
      <Button
        disabled={disabled}
        onClick={() => {
          setOpen('email');
        }}
      >
        <Mail />
        Send email
      </Button>
      <Dialog
        open={open === 'sms'}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent title={`SMS to ${target.name}`} className="max-w-lg">
          {open === 'sms' && <SmsForm target={target} onDone={close} />}
        </DialogContent>
      </Dialog>
      <EmailDialog
        target={target}
        open={open === 'email'}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      />
    </>
  );
}
