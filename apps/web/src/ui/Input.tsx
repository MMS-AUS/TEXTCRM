import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn.ts';

const fieldBase = [
  'w-full min-w-0 rounded-md border border-line-strong bg-surface text-sm text-fg shadow-xs',
  'transition-[border-color,box-shadow] duration-100 outline-none placeholder:text-fg-subtle',
  'hover:border-fg-subtle/60 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted disabled:shadow-none',
  'read-only:bg-surface-2 read-only:focus-visible:border-line-strong read-only:focus-visible:ring-0',
  'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/25',
];

export type InputProps = ComponentProps<'input'> & {
  /** Marks the field invalid (red border, aria-invalid). Pair with an error message via Field. */
  invalid?: boolean;
  /** An icon shown inside the field on the left, e.g. a search glass. */
  leading?: ReactNode;
};

export function Input({ invalid, leading, className, ...props }: InputProps) {
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'h-8 px-2.5', leading !== undefined && 'pl-8', className)}
      {...props}
    />
  );
  if (leading === undefined) return input;
  return (
    <div className="relative w-full">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-fg-subtle [&_svg]:size-4">
        {leading}
      </span>
      {input}
    </div>
  );
}

export type TextareaProps = ComponentProps<'textarea'> & { invalid?: boolean };

export function Textarea({ invalid, className, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'min-h-16 resize-y px-2.5 py-1.5', className)}
      {...props}
    />
  );
}
