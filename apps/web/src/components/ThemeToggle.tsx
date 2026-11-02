import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '../lib/theme.ts';
import { cn, focusRing } from '../ui/cn.ts';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'Match system theme', icon: Monitor },
];

export function ThemeToggle() {
  const { preference, setTheme } = useTheme();
  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={preference === value}
          onClick={() => {
            setTheme(value);
          }}
          className={cn(
            'grid size-6 cursor-pointer place-items-center rounded-sm text-fg-subtle transition-colors hover:text-fg',
            'aria-pressed:bg-surface aria-pressed:text-fg aria-pressed:shadow-xs',
            focusRing,
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
