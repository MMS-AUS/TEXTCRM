import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn.ts';

const TONES = {
  info: { icon: Info, classes: 'bg-info-subtle text-info-text' },
  success: { icon: CircleCheck, classes: 'bg-success-subtle text-success-text' },
  warning: { icon: TriangleAlert, classes: 'bg-warning-subtle text-warning-text' },
  danger: { icon: CircleAlert, classes: 'bg-danger-subtle text-danger-text' },
} as const;

/** An inline message, e.g. why a form couldn't be saved. Danger alerts are announced. */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { icon: Icon, classes } = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-2.5 rounded-md p-3 text-sm', classes, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
