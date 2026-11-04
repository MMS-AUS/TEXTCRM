import { formatDateTime, formatRelative } from '../lib/format.ts';
import { Tooltip } from '../ui/index.ts';

/** "5 minutes ago", with the exact date and time on hover/focus. */
export function When({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-fg-subtle">—</span>;
  return (
    <Tooltip content={formatDateTime(iso)}>
      <time dateTime={iso} tabIndex={0}>
        {formatRelative(iso)}
      </time>
    </Tooltip>
  );
}
