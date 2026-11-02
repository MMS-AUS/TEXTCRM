import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from './cn.ts';

const badgeVariants = cva(
  'inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap inset-ring',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-2 text-fg-muted inset-ring-line-strong/70',
        accent: 'bg-accent-subtle text-accent-text inset-ring-accent/20',
        success: 'bg-success-subtle text-success-text inset-ring-success/20',
        warning: 'bg-warning-subtle text-warning-text inset-ring-warning/30',
        danger: 'bg-danger-subtle text-danger-text inset-ring-danger/20',
        info: 'bg-info-subtle text-info-text inset-ring-info/20',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

const dotColours = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
} as const;

export type BadgeTone = keyof typeof dotColours;

export type BadgeProps = ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    /** Leading status dot — use for statuses (the "StatusPill" form). */
    dot?: boolean;
  };

export function Badge({ tone, dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && (
        <span className={cn('size-1.5 rounded-full', dotColours[tone ?? 'neutral'])} aria-hidden />
      )}
      {children}
    </span>
  );
}
