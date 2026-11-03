import { formatPhone } from '@mms/shared';
import { History } from 'lucide-react';
import { formatDate, formatDateTime, formatRelative } from '../lib/format.ts';
import { Avatar, EmptyState, Tooltip } from '../ui/index.ts';

export type HistoryEntry = {
  id: number;
  occurredAt: string;
  action: string;
  actorName: string | null;
  actorType: string;
  changes: { before?: Record<string, unknown>; after?: Record<string, unknown> };
};

const ACTIONS: Record<string, string> = {
  create: 'created this record',
  update: 'updated',
  archive: 'archived this record',
  restore: 'restored this record',
  address_add: 'added an address',
  address_update: 'updated an address',
  address_remove: 'removed an address',
  update_site: 'updated the site',
  update_system: 'updated the system',
  update_pricing: 'updated the pricing',
};

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'string' && /mobile|phone/i.test(field)) return formatPhone(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) return formatDate(value);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/** Fields whose raw value means nothing to a person (ids) show only that they changed. */
const OPAQUE = /Id$/;

/** "Who changed what, when" from the audit log, newest first. */
export function HistoryList({
  entries,
  labels,
  actions,
}: {
  entries: HistoryEntry[];
  /** Field name → label, e.g. { firstName: 'First name' }; an 'action.field' key wins. */
  labels: Record<string, string>;
  /** Extra action → phrase, e.g. { update_grid: 'updated the grid application' }. */
  actions?: Record<string, string>;
}) {
  if (entries.length === 0) {
    return <EmptyState icon={<History />} title="No history yet" />;
  }
  return (
    <ol className="flex flex-col">
      {entries.map((entry) => {
        const actor = entry.actorName ?? (entry.actorType === 'user' ? 'Someone' : 'The system');
        const after = entry.changes.after ?? {};
        const before = entry.changes.before ?? {};
        const fields =
          entry.action.startsWith('update') || entry.action === 'address_update'
            ? Object.keys(after)
            : [];
        const detail =
          typeof after.address === 'string'
            ? after.address
            : typeof before.address === 'string'
              ? before.address
              : null;
        return (
          <li key={entry.id} className="flex gap-3 border-b border-line py-3 last:border-0">
            <Avatar name={actor} size="sm" className="mt-0.5" />
            <div className="min-w-0 flex-1 text-sm">
              <p>
                <span className="font-medium">{actor}</span>{' '}
                <span className="text-fg-muted">
                  {actions?.[entry.action] ?? ACTIONS[entry.action] ?? entry.action}
                </span>
                {detail && <span className="text-fg-muted">: {detail}</span>}
                <span className="text-fg-subtle"> · </span>
                <Tooltip content={formatDateTime(entry.occurredAt)}>
                  <time dateTime={entry.occurredAt} className="text-fg-subtle" tabIndex={0}>
                    {formatRelative(entry.occurredAt)}
                  </time>
                </Tooltip>
              </p>
              {fields.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {fields.map((field) => (
                    <li key={field} className="text-fg-muted">
                      <span className="text-fg">
                        {labels[`${entry.action}.${field}`] ?? labels[field] ?? field}
                      </span>
                      {OPAQUE.test(field) ? (
                        ' changed'
                      ) : (
                        <>
                          {': '}
                          <span className="line-through decoration-fg-subtle/60">
                            {show(field, before[field])}
                          </span>
                          {' → '}
                          <span className="text-fg">{show(field, after[field])}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
