import { Menu, Search } from 'lucide-react';
import { BrandMark } from '../../components/BrandMark.tsx';
import { ThemeMenu } from '../../components/ThemeMenu.tsx';
import { cn, focusRing, IconButton } from '../../ui/index.ts';
import { UserMenu } from './UserMenu.tsx';

const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function TopBar({
  onOpenNav,
  onOpenSearch,
}: {
  onOpenNav: () => void;
  onOpenSearch: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas/85 px-3 backdrop-blur-md sm:px-6">
      <IconButton label="Open navigation" className="lg:hidden" onClick={onOpenNav}>
        <Menu />
      </IconButton>
      <span className="mr-1 lg:hidden">
        <BrandMark variant="square" />
      </span>
      <button
        type="button"
        onClick={onOpenSearch}
        aria-keyshortcuts="Control+K Meta+K"
        className={cn(
          'flex h-8 w-full max-w-sm min-w-0 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-fg-subtle shadow-xs transition-colors hover:border-fg-subtle/60 hover:text-fg-muted',
          focusRing,
        )}
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">Search…</span>
        <kbd className="ml-auto hidden rounded-sm border border-line bg-surface-2 px-1.5 font-sans text-xs text-fg-subtle sm:inline">
          {isApple ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ThemeMenu />
        <UserMenu />
      </div>
    </header>
  );
}
