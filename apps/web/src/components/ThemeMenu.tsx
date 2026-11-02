import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import {
  THEME_MODES,
  THEME_STYLES,
  useTheme,
  type ThemeMode,
  type ThemeStyle,
} from '../lib/theme.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '../ui/index.ts';

const STYLE_LABELS: Record<ThemeStyle, string> = {
  graphite: 'Graphite',
  mms: 'Make My Solar',
};

const MODE_LABELS: Record<ThemeMode, { label: string; icon: typeof Sun }> = {
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
  system: { label: 'Match system', icon: Monitor },
};

/** Theme style (Graphite / Make My Solar) and appearance (light / dark / system). */
export function ThemeMenu() {
  const { style, mode, setStyle, setMode } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Theme">
          <Palette />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={style}
          onValueChange={(value) => {
            const next = THEME_STYLES.find((option) => option === value);
            if (next) setStyle(next);
          }}
        >
          {THEME_STYLES.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              onSelect={(event) => {
                event.preventDefault();
              }}
            >
              {STYLE_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            const next = THEME_MODES.find((option) => option === value);
            if (next) setMode(next);
          }}
        >
          {THEME_MODES.map((option) => {
            const { label, icon: Icon } = MODE_LABELS[option];
            return (
              <DropdownMenuRadioItem
                key={option}
                value={option}
                onSelect={(event) => {
                  event.preventDefault();
                }}
              >
                <Icon />
                {label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
