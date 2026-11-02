import { useEffect, useSyncExternalStore } from 'react';

/** Visual style: the neutral "Graphite" design or the Make My Solar brand. */
export const THEME_STYLES = ['graphite', 'mms'] as const;
export type ThemeStyle = (typeof THEME_STYLES)[number];

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedMode = 'light' | 'dark';

export type ThemeSettings = { style: ThemeStyle; mode: ThemeMode };

// Keep in sync with the inline script in index.html.
const STYLE_KEY = 'mms-theme-style';
const MODE_KEY = 'mms-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return options.some((option) => option === value);
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage blocked (private mode, site data disabled): use the defaults.
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

export function readThemeSettings(): ThemeSettings {
  const style = readStorage(STYLE_KEY);
  const mode = readStorage(MODE_KEY);
  return {
    style: isOneOf(THEME_STYLES, style) ? style : 'graphite',
    mode: isOneOf(THEME_MODES, mode) ? mode : 'system',
  };
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

export function resolveMode(mode: ThemeMode): ResolvedMode {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

/** The value of <html data-theme>, e.g. "mms-dark". */
export function themeAttribute(settings: ThemeSettings): string {
  return `${settings.style}-${resolveMode(settings.mode)}`;
}

export function applyTheme(settings: ThemeSettings): void {
  document.documentElement.dataset.theme = themeAttribute(settings);
}

// One shared store, so every component (menus, logo) sees the same choice.
let current = readThemeSettings();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setThemeSettings(next: Partial<ThemeSettings>): void {
  current = { ...current, ...next };
  writeStorage(STYLE_KEY, current.style);
  writeStorage(MODE_KEY, current.mode);
  applyTheme(current);
  for (const listener of listeners) listener();
}

/** The user's theme style + light/dark choice, persisted per browser; "system" follows the OS live. */
export function useTheme() {
  const settings = useSyncExternalStore(subscribe, () => current);

  useEffect(() => {
    applyTheme(settings);
    if (settings.mode !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      applyTheme(current);
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, [settings]);

  return {
    style: settings.style,
    mode: settings.mode,
    setStyle: (style: ThemeStyle) => {
      setThemeSettings({ style });
    },
    setMode: (mode: ThemeMode) => {
      setThemeSettings({ mode });
    },
  };
}
