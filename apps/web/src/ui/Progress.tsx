import { cn } from './cn.ts';

/** A thin progress bar; `value` is 0–1. */
export function Progress({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn('h-1.5 overflow-hidden rounded-full bg-surface-3', className)}
    >
      <div
        className="h-full bg-accent transition-[width]"
        style={{ width: `${String(percent)}%` }}
      />
    </div>
  );
}
