import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn, focusRing } from './cn.ts';
import { Spinner } from './Spinner.tsx';

const buttonVariants = cva(
  [
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none',
    'transition-[background-color,border-color,color,box-shadow] duration-100',
    'disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    focusRing,
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accent-fg shadow-xs inset-ring inset-ring-white/10 hover:bg-accent-hover',
        secondary:
          'border border-line-strong bg-surface text-fg shadow-xs hover:bg-surface-2 active:bg-surface-3',
        ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg active:bg-surface-3',
        danger: 'bg-danger text-white shadow-xs hover:bg-danger-hover',
      },
      size: {
        sm: 'h-7 px-2.5 text-sm',
        md: 'h-8 px-3 text-sm',
        lg: 'h-10 px-4 text-base',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Shows a spinner, sets aria-busy and blocks clicks. */
    loading?: boolean;
    /** Render the single child (e.g. a link) with button styling instead of a <button>. */
    asChild?: boolean;
  };

export function Button({
  variant,
  size,
  loading = false,
  asChild = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

const iconSizes = { sm: 'w-7 px-0', md: 'w-8 px-0', lg: 'w-10 px-0' } as const;

export type IconButtonProps = Omit<ButtonProps, 'children' | 'asChild'> & {
  /** Accessible name — required, because the button has no visible text. */
  label: string;
  children: ReactNode;
};

/** A square button holding one icon. */
export function IconButton({
  label,
  size,
  variant = 'ghost',
  loading,
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      variant={variant}
      size={size}
      loading={loading}
      className={cn(iconSizes[size ?? 'md'], className)}
      {...props}
    >
      {!loading && children}
    </Button>
  );
}
