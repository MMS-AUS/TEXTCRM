import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useId, useState } from 'react';
import { cn } from './cn.ts';
import { Spinner } from './Spinner.tsx';

export type ComboboxOption = { value: string; label: string; description?: string };

/**
 * Pick one record from a long, searchable list (e.g. a company). The parent runs the search:
 * it receives the typed text via `onSearchChange` and passes back matching `options`.
 */
export function Combobox({
  value,
  selectedLabel,
  options,
  onSelect,
  onSearchChange,
  loading = false,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches.',
  clearLabel,
  disabled,
  invalid,
  id,
  'aria-describedby': describedBy,
}: {
  value: string | null;
  /** Label of the current value (it may not be in the current search results). */
  selectedLabel?: string | null;
  options: readonly ComboboxOption[];
  onSelect: (value: string | null, option?: ComboboxOption) => void;
  onSearchChange: (search: string) => void;
  loading?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** When set, a "clear" row (e.g. "No company") appears while a value is chosen. */
  clearLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  'aria-describedby'?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const activeIndex = Math.min(active, options.length - 1);

  const setOpenAndReset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSearch('');
      setActive(0);
      onSearchChange('');
    }
  };

  const choose = (option: ComboboxOption | null) => {
    onSelect(option?.value ?? null, option ?? undefined);
    setOpenAndReset(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpenAndReset}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            'flex h-8 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-left text-sm shadow-xs',
            'transition-[border-color,box-shadow] duration-100 outline-none hover:border-fg-subtle/60',
            'focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-ring data-[state=open]:border-accent',
            'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted aria-invalid:border-danger',
          )}
        >
          <span className={cn('truncate', !value && 'text-fg-subtle')}>
            {value ? (selectedLabel ?? 'Selected') : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-(--radix-popover-trigger-width) min-w-56 overflow-hidden rounded-lg border border-line bg-surface-raised text-sm text-fg shadow-md data-[state=open]:animate-pop-in"
        >
          <div className="flex items-center gap-2 border-b border-line px-2.5">
            <Search className="size-4 shrink-0 text-fg-subtle" />
            <input
              autoFocus
              aria-label={searchPlaceholder}
              aria-controls={listId}
              aria-activedescendant={
                options[activeIndex] ? `${listId}-${String(activeIndex)}` : undefined
              }
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActive(0);
                onSearchChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActive(Math.min(activeIndex + 1, options.length - 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive(Math.max(activeIndex - 1, 0));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const option = options[activeIndex];
                  if (option) choose(option);
                }
              }}
              className="h-9 w-full bg-transparent outline-none placeholder:text-fg-subtle"
            />
            {loading && <Spinner className="text-fg-subtle" />}
          </div>
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${String(index)}`}
                role="option"
                aria-selected={option.value === value}
                onMouseMove={() => {
                  setActive(index);
                }}
                onClick={() => {
                  choose(option);
                }}
                className={cn(
                  'relative flex min-h-8 cursor-pointer flex-col justify-center rounded-md py-1 pr-2 pl-8',
                  index === activeIndex && 'bg-surface-2',
                )}
              >
                {option.value === value && (
                  <Check className="absolute left-2 size-4 text-accent-text" />
                )}
                <span className="truncate">{option.label}</span>
                {option.description && (
                  <span className="truncate text-xs text-fg-muted">{option.description}</span>
                )}
              </li>
            ))}
            {options.length === 0 && !loading && (
              <li className="px-2 py-3 text-center text-fg-muted">{emptyText}</li>
            )}
          </ul>
          {clearLabel && value && (
            <button
              type="button"
              onClick={() => {
                choose(null);
              }}
              className="flex h-9 w-full cursor-pointer items-center gap-2 border-t border-line px-3 text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" />
              {clearLabel}
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
