import { cn } from './cn.ts';

const SIZES = {
  sm: 'size-6 text-[0.625rem]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
} as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** A person's initials in a circle (photos can come later). Decorative: name it nearby. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full bg-accent-subtle font-semibold text-accent-text inset-ring inset-ring-accent/15 select-none',
        SIZES[size],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
