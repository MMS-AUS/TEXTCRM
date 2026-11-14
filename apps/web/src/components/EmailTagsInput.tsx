import { X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { cn, type FieldControlProps } from '../ui/index.ts';

const SEPARATORS = /[\s,;]+/;
const LOOKS_LIKE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "a@x.com  b@y.com" → ["a@x.com", "b@y.com"]. */
function splitEmails(text: string): string[] {
  return text.split(SEPARATORS).filter(Boolean);
}

/**
 * Several email addresses in one box. Type an address and press Space (or Enter or comma) and it
 * becomes a tag; the first tag is the primary address, the rest are extra addresses. The value is
 * one space-separated string, which the server splits into primary + extras.
 */
export function EmailTagsInput({
  value,
  onChange,
  onBlur,
  name,
  props,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  props: FieldControlProps;
}) {
  const tags = splitEmails(value);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const commit = (text: string) => {
    const added = splitEmails(text);
    if (added.length > 0) onChange([...tags, ...added].join(' '));
  };

  return (
    <div
      onClick={() => input.current?.focus()}
      className={cn(
        'flex min-h-8 w-full min-w-0 cursor-text flex-wrap items-center gap-1 rounded-md border border-line-strong bg-surface px-1.5 py-1 text-sm text-fg shadow-xs',
        'transition-[border-color,box-shadow] duration-100 hover:border-fg-subtle/60 focus-within:border-accent focus-within:ring-3 focus-within:ring-ring',
        props.invalid && 'border-danger focus-within:ring-danger/25',
      )}
    >
      {tags.map((tag, index) => (
        <span
          key={`${tag}-${String(index)}`}
          title={index === 0 ? 'Primary email' : 'Extra email'}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded bg-surface-2 py-0.5 pr-0.5 pl-2 text-fg',
            index === 0 && 'font-medium',
            !LOOKS_LIKE_EMAIL.test(tag) && 'bg-danger/10 text-danger',
          )}
        >
          <span className="truncate">{tag}</span>
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            className="rounded p-0.5 text-fg-muted hover:text-fg"
            onClick={(event) => {
              event.stopPropagation();
              onChange(tags.filter((_, i) => i !== index).join(' '));
            }}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={input}
        {...props}
        name={name}
        type="text"
        inputMode="email"
        autoComplete="off"
        aria-invalid={props.invalid || undefined}
        value={draft}
        placeholder={tags.length === 0 ? 'name@example.com — press Space to add another' : ''}
        className="min-w-40 flex-1 bg-transparent px-1 outline-none placeholder:text-fg-subtle"
        onChange={(event) => {
          const text = event.target.value;
          if (!SEPARATORS.test(text)) {
            setDraft(text);
            return;
          }
          // A space, comma or semicolon (or a pasted list) finishes the address before it.
          const parts = text.split(SEPARATORS);
          const rest = parts.pop() ?? '';
          commit(parts.join(' '));
          setDraft(rest);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter' && draft.trim()) {
            event.preventDefault();
            commit(draft);
            setDraft('');
          } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
            onChange(tags.slice(0, -1).join(' '));
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft);
          setDraft('');
          onBlur?.();
        }}
      />
    </div>
  );
}
