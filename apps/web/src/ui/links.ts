/** "example.com" → "https://example.com"; mailto:/tel:/http(s): kept; anything else refused. */
export function normaliseLink(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (/^[a-z][\w+.-]*:/i.test(value)) return null; // javascript:, data:, …
  return `https://${value}`;
}
