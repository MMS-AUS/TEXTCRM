import type { ComponentProps } from 'react';
import { cn } from './cn.ts';

// A plain table with the DataTable look, for short lists that need no sorting or paging
// (settings pages, previews). Server-paged lists use DataTable.

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
      <div className="overflow-x-auto">
        <table className={cn('w-full border-collapse text-sm', className)} {...props} />
      </div>
    </div>
  );
}

export function TableHead(props: ComponentProps<'thead'>) {
  return <thead className="bg-surface-2/70" {...props} />;
}

export function TableHeaderCell({
  className,
  end = false,
  ...props
}: ComponentProps<'th'> & { end?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-9 border-b border-line px-3 text-left text-xs font-medium whitespace-nowrap text-fg-muted',
        end && 'text-right',
        className,
      )}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b border-line transition-colors last:border-0 hover:bg-surface-2/70',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  end = false,
  wrap = false,
  ...props
}: ComponentProps<'td'> & { end?: boolean; wrap?: boolean }) {
  return (
    <td
      className={cn(
        'h-10 px-3 py-2 text-fg',
        !wrap && 'whitespace-nowrap',
        end && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  );
}
