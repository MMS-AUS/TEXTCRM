import { Link } from '@tanstack/react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useProfile } from '../../auth/auth-context.ts';
import { BrandMark } from '../../components/BrandMark.tsx';
import { cn, focusRing, Tooltip } from '../../ui/index.ts';
import { visibleNav, type NavItem } from '../nav.ts';

const itemClasses = cn(
  'relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-fg-muted transition-colors',
  'hover:bg-surface-2 hover:text-fg',
  // Active page: filled background plus a highlight bar on the left edge.
  'data-[status=active]:bg-surface-2 data-[status=active]:text-fg',
  'before:absolute before:inset-y-1.5 before:-left-2 before:w-[3px] before:rounded-r-full before:bg-highlight before:opacity-0 data-[status=active]:before:opacity-100',
  '[&_svg]:size-4 [&_svg]:shrink-0 data-[status=active]:[&_svg]:text-accent-text',
  focusRing,
);

function NavLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      to={item.to}
      onClick={onNavigate}
      className={cn(itemClasses, collapsed && 'justify-center px-0')}
    >
      <Icon />
      <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
    </Link>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

/** The navigation list — used by the desktop sidebar and the mobile drawer. */
export function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { permissions } = useProfile();
  const { main, settings } = visibleNav(permissions);
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
      {main.map((item) => (
        <NavLink key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
      {settings && (
        <div className="mt-auto pt-2">
          <NavLink item={settings} collapsed={collapsed} onNavigate={onNavigate} />
        </div>
      )}
    </nav>
  );
}

/** Desktop sidebar (≥1024px). Collapses to icons; the choice is remembered per browser. */
export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-sidebar transition-[width] duration-200 lg:flex',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 shrink-0 items-center border-b border-line',
          collapsed ? 'justify-center px-2' : 'px-4',
        )}
      >
        <Link to="/dashboard" className={cn('rounded-md', focusRing)}>
          <BrandMark variant={collapsed ? 'square' : 'full'} />
        </Link>
      </div>
      <SidebarNav collapsed={collapsed} />
      <div className="border-t border-line p-2">
        <Tooltip content={toggleLabel} side="right">
          <button
            type="button"
            onClick={onToggle}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            className={cn(itemClasses, 'w-full cursor-pointer', collapsed && 'justify-center px-0')}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
