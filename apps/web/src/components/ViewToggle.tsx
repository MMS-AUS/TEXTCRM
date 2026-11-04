import { LayoutGrid, Table2 } from 'lucide-react';
import { cn, focusRing } from '../ui/index.ts';

/** Board / Table switch for list pages. */
export function ViewToggle({
  view,
  onChange,
}: {
  view: 'board' | 'table';
  onChange: (view: 'board' | 'table') => void;
}) {
  return (
    <div
      role="group"
      aria-label="View"
      className="inline-flex rounded-md border border-line bg-surface-2 p-0.5"
    >
      {(
        [
          ['board', 'Board', LayoutGrid],
          ['table', 'Table', Table2],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => {
            onChange(value);
          }}
          className={cn(
            'flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-2.5 text-sm text-fg-muted transition-colors hover:text-fg',
            'aria-pressed:bg-surface aria-pressed:text-fg aria-pressed:shadow-xs',
            focusRing,
          )}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}
