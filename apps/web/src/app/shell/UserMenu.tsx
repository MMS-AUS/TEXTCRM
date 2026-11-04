import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, LogOut, PlugZap } from 'lucide-react';
import { useAuth, useProfile } from '../../auth/auth-context.ts';
import {
  Avatar,
  Badge,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  focusRing,
} from '../../ui/index.ts';

export function UserMenu() {
  const profile = useProfile();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${profile.name}`}
          className={cn(
            'flex h-8 cursor-pointer items-center gap-2 rounded-md pr-1.5 pl-1 transition-colors hover:bg-surface-2',
            focusRing,
          )}
        >
          <Avatar name={profile.name} size="sm" />
          <span className="hidden max-w-32 truncate text-sm font-medium md:inline">
            {profile.name}
          </span>
          <ChevronDown className="hidden size-3.5 text-fg-subtle md:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar name={profile.name} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{profile.name}</p>
            <p className="truncate text-xs text-fg-muted">{profile.email}</p>
          </div>
        </div>
        <div className="px-2 pb-2">
          <Badge tone="accent">{profile.role.name}</Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void navigate({ to: '/settings/integrations' });
          }}
        >
          <PlugZap />
          Connected accounts
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void signOut();
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
