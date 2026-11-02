import type { ReactNode } from 'react';

/** Label/value pairs on a record page. Empty values show a dash. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-col divide-y divide-line">
      {items.map(({ label, value }) => (
        <div key={label} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2.5 text-sm">
          <dt className="text-fg-muted">{label}</dt>
          <dd className="min-w-0 break-words text-fg">
            {value === null || value === undefined || value === '' ? (
              <span className="text-fg-subtle">—</span>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
