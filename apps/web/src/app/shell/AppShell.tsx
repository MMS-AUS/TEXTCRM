import { useEffect, useState, type ReactNode } from 'react';
import { BrandMark } from '../../components/BrandMark.tsx';
import { Drawer, DrawerContent } from '../../ui/index.ts';
import { CommandPalette } from './CommandPalette.tsx';
import { Sidebar, SidebarNav } from './Sidebar.tsx';
import { TopBar } from './TopBar.tsx';

const COLLAPSED_KEY = 'mms-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** The signed-in layout: sidebar (drawer below 1024px), top bar, ⌘K palette, page content. */
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      // Not remembered; fine.
    }
  };

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      <Drawer open={navOpen} onOpenChange={setNavOpen}>
        <DrawerContent side="left" title="Navigation" hideTitle className="w-72 bg-sidebar">
          <div className="flex h-14 shrink-0 items-center border-b border-line px-4">
            <BrandMark variant="full" />
          </div>
          <SidebarNav
            collapsed={false}
            onNavigate={() => {
              setNavOpen(false);
            }}
          />
        </DrawerContent>
      </Drawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenNav={() => {
            setNavOpen(true);
          }}
          onOpenSearch={() => {
            setSearchOpen(true);
          }}
        />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
