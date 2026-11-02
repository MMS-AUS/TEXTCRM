import { useNavigate } from '@tanstack/react-router';
import { CornerDownLeft, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { useProfile } from '../../auth/auth-context.ts';
import { cn, Dialog, DialogContent } from '../../ui/index.ts';
import { visibleNav, type NavItem } from '../nav.ts';

/**
 * ⌘K / Ctrl+K palette. For now it jumps between pages; searching leads, contacts and
 * projects is added as those screens are built (Phase 2).
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { permissions } = useProfile();
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const { main, settings } = visibleNav(permissions);
  const pages = settings ? [...main, settings] : main;
  const needle = query.trim().toLowerCase();
  const results = pages.filter((item) => item.label.toLowerCase().includes(needle));
  const activeIndex = Math.min(active, results.length - 1);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setQuery('');
      setActive(0);
    }
  };

  const go = (item: NavItem) => {
    close(false);
    void navigate({ to: item.to });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title="Search"
        hideTitle
        className="top-[12vh] max-w-xl translate-y-0 overflow-hidden"
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-fg-subtle" />
          <input
            autoFocus
            role="combobox"
            aria-label="Search"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={
              results[activeIndex] ? `${listId}-${String(activeIndex)}` : undefined
            }
            placeholder="Go to a page…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive(Math.min(activeIndex + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive(Math.max(activeIndex - 1, 0));
              } else if (event.key === 'Enter') {
                const item = results[activeIndex];
                if (item) go(item);
              }
            }}
            className="h-12 w-full bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {results.length > 0 ? (
            <>
              <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-fg-subtle">Pages</p>
              <ul id={listId} role="listbox" aria-label="Pages">
                {results.map((item, index) => {
                  const Icon = item.icon;
                  const selected = index === activeIndex;
                  return (
                    <li
                      key={item.to}
                      id={`${listId}-${String(index)}`}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => {
                        setActive(index);
                      }}
                      onClick={() => {
                        go(item);
                      }}
                      className={cn(
                        'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-fg',
                        selected && 'bg-surface-2',
                      )}
                    >
                      <Icon className="size-4 text-fg-muted" />
                      {item.label}
                      {selected && <CornerDownLeft className="ml-auto size-3.5 text-fg-subtle" />}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="px-2 py-6 text-center text-sm text-fg-muted">No pages match “{query}”.</p>
          )}
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-fg-subtle">
          Searching leads, contacts and projects arrives with those screens.
        </p>
      </DialogContent>
    </Dialog>
  );
}
