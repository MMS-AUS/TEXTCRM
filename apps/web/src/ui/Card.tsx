import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn.ts';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-lg border border-line bg-surface text-fg shadow-xs', className)}
      {...props}
    />
  );
}

/** Title row; `actions` sit on the right (buttons, menus). */
export function CardHeader({
  className,
  actions,
  children,
  ...props
}: ComponentProps<'div'> & { actions?: ReactNode }) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex items-start justify-between gap-4 px-5 pt-4', className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-0.5">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3 className={cn('text-base font-semibold tracking-tight text-fg', className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-fg-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-5 py-4 [[data-slot=card-header]+&]:pt-3', className)}
      {...props}
    />
  );
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center justify-end gap-2 rounded-b-lg border-t border-line bg-surface-2/60 px-5 py-3',
        className,
      )}
      {...props}
    />
  );
}
