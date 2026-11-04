import type { ReactNode } from 'react';
import { cn } from './cn.ts';
import { formatCount } from './format-count.ts';
import { Tooltip } from './Tooltip.tsx';

// Small, single-series charts for the dashboard (Step 2.9), built per the dataviz method:
// one accent hue (validated against both surfaces), thin marks with a 4px rounded data end
// and a square baseline, hairline recessive grid, values in text tokens (never the mark
// colour), a hover/focus tooltip on every mark, and a table view for the column chart.

const whole = new Intl.NumberFormat('en-AU');

/** A headline number: label, value, optional detail line. */
export function StatTile({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-sm text-fg-muted">{label}</span>
      <span className="text-3xl font-semibold tracking-tight text-fg">{value}</span>
      {detail && <span className="text-xs text-fg-muted">{detail}</span>}
    </div>
  );
}

export type BarDatum = { label: string; value: number; detail?: string };

/**
 * Ranked horizontal bars. Each row: label, a ≤10px bar growing from the left baseline, the
 * value at its tip. Bars share one scale (the largest value) so lengths compare.
 */
export function BarList({
  data,
  label,
  unit,
  empty = 'Nothing to show yet.',
  max,
}: {
  data: readonly BarDatum[];
  /** Accessible name of the chart. */
  label: string;
  /** "leads", "jobs" — used in each bar's tooltip. */
  unit: string;
  empty?: string;
  /** Scale maximum; defaults to the largest value. */
  max?: number;
}) {
  const top = Math.max(max ?? 0, ...data.map((d) => d.value), 1);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (data.length === 0 || total === 0) {
    return <p className="py-4 text-sm text-fg-muted">{empty}</p>;
  }
  return (
    <ul aria-label={label} className="flex flex-col gap-2.5">
      {data.map((d) => {
        const share = total ? Math.round((d.value / total) * 100) : 0;
        const tip = `${d.label}: ${whole.format(d.value)} ${unit}${share ? ` (${String(share)}%)` : ''}${d.detail ? ` · ${d.detail}` : ''}`;
        return (
          <li key={d.label}>
            <Tooltip content={tip}>
              <div
                tabIndex={0}
                aria-label={tip}
                className="group grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 rounded-sm text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <span className="truncate text-fg-muted group-hover:text-fg" title={d.label}>
                  {d.label}
                </span>
                <span className="relative h-2.5 rounded-r-[4px] bg-transparent">
                  <span
                    className="absolute inset-y-0 left-0 rounded-r-[4px] bg-accent transition-[width] group-hover:bg-accent-hover"
                    style={{
                      width: `${String(d.value === 0 ? 0 : Math.max(2, (d.value / top) * 100))}%`,
                    }}
                  />
                </span>
                <span className="w-10 text-right text-fg tabular-nums">{formatCount(d.value)}</span>
              </div>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/** Clean tick values from 0 to at least `max` (4 steps of 1/2/2.5/5 × 10ⁿ). */
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= rough) ?? 10) * power;
  const count = Math.ceil(max / step);
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

export type ColumnDatum = {
  key: string;
  /** Short axis label, e.g. "Jun". */
  label: string;
  /** Full name for the tooltip and table, e.g. "June 2026". */
  name: string;
  value: number;
  /** Extra tooltip text, e.g. "3 jobs". */
  detail?: string;
};

/**
 * Columns over time (one series). ≤24px columns with a 4px rounded cap on a square baseline,
 * hairline gridlines with clean ticks, the latest value labelled on its cap, a tooltip per
 * column, and the same numbers as a table under "Show as table".
 */
export function ColumnChart({
  data,
  label,
  formatValue,
  formatTick = formatCount,
  tableHeaders,
}: {
  data: readonly ColumnDatum[];
  label: string;
  formatValue: (value: number) => string;
  formatTick?: (value: number) => string;
  tableHeaders: [string, string];
}) {
  const scale = ticks(Math.max(...data.map((d) => d.value), 0));
  const top = scale[scale.length - 1] ?? 1;
  const last = data[data.length - 1];
  return (
    <figure className="flex flex-col gap-3">
      <div role="img" aria-label={label} className="grid grid-cols-[auto_1fr] gap-x-2">
        {/* Y axis */}
        <div className="relative h-44 text-right text-xs text-fg-subtle tabular-nums" aria-hidden>
          {scale.map((tick) => (
            <span
              key={tick}
              className="absolute right-0"
              style={{ bottom: `${String((tick / top) * 100)}%`, transform: 'translateY(50%)' }}
            >
              {formatTick(tick)}
            </span>
          ))}
          <span className="invisible block">{formatTick(top)}</span>
        </div>
        <div className="relative h-44">
          {scale.map((tick) => (
            <span
              key={tick}
              aria-hidden
              className="absolute inset-x-0 h-px bg-line"
              style={{ bottom: `${String((tick / top) * 100)}%` }}
            />
          ))}
          <ol className="absolute inset-0 flex items-end justify-around gap-0.5">
            {data.map((d) => {
              const tip = `${d.name}: ${formatValue(d.value)}${d.detail ? ` · ${d.detail}` : ''}`;
              const height = d.value === 0 ? 0 : Math.max(1.5, (d.value / top) * 100);
              return (
                <li key={d.key} className="flex h-full flex-1 items-end justify-center">
                  <Tooltip content={tip}>
                    <span
                      tabIndex={0}
                      aria-label={tip}
                      className="group relative flex h-full w-full max-w-12 items-end justify-center outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    >
                      <span
                        className="w-full max-w-6 rounded-t-[4px] bg-accent transition-colors group-hover:bg-accent-hover"
                        style={{ height: `${String(height)}%` }}
                      />
                      {d === last && d.value > 0 && (
                        <span
                          className="absolute text-xs font-medium whitespace-nowrap text-fg"
                          style={{ bottom: `calc(${String(height)}% + 4px)` }}
                        >
                          {formatValue(d.value)}
                        </span>
                      )}
                    </span>
                  </Tooltip>
                </li>
              );
            })}
          </ol>
        </div>
        <span />
        <ol className="flex justify-around gap-0.5 pt-1.5 text-xs text-fg-muted" aria-hidden>
          {data.map((d) => (
            <li key={d.key} className="flex-1 text-center">
              {d.label}
            </li>
          ))}
        </ol>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-fg-muted hover:text-fg">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-fg-muted">
              <th className="py-1 font-medium">{tableHeaders[0]}</th>
              <th className="py-1 text-right font-medium">{tableHeaders[1]}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.map((d) => (
              <tr key={d.key} className="border-t border-line">
                <td className="py-1">{d.name}</td>
                <td className="py-1 text-right">{formatValue(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** A filled share of a whole: the fill in the accent, the track a lighter step of it. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-2 overflow-hidden rounded-full bg-accent-subtle"
    >
      <div className="h-full rounded-full bg-accent" style={{ width: `${String(percent)}%` }} />
    </div>
  );
}
