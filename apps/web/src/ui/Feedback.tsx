import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn.ts';

/** Placeholder block while content loads. Size it with className (e.g. "h-4 w-32"). */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-surface-3', className)}
      {...props}
    />
  );
}

/** "Nothing here yet" — say what's missing and, where possible, offer the next action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <div className="mb-2 grid size-10 place-items-center rounded-lg border border-line bg-surface-2 text-fg-muted shadow-xs [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-base font-medium text-fg">{title}</p>
      {description && <p className="max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
