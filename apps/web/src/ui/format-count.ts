const compact = new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-AU');

/** 1,284 / 12.9K / 4.2M — in full below 10,000 (dataviz tick and tile convention). */
export function formatCount(value: number): string {
  return Math.abs(value) < 10_000 ? whole.format(value) : compact.format(value);
}
