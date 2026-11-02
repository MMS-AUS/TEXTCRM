import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  readThemeSettings,
  resolveMode,
  setThemeSettings,
  themeAttribute,
} from './theme.ts';

function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

describe('theme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('defaults to Graphite following the system', () => {
    expect(readThemeSettings()).toEqual({ style: 'graphite', mode: 'system' });
    mockSystemDark(true);
    expect(resolveMode('system')).toBe('dark');
    mockSystemDark(false);
    expect(resolveMode('system')).toBe('light');
  });

  it('ignores unknown saved values', () => {
    localStorage.setItem('mms-theme-style', 'purple');
    localStorage.setItem('mms-theme', 'sepia');
    expect(readThemeSettings()).toEqual({ style: 'graphite', mode: 'system' });
    localStorage.setItem('mms-theme-style', 'mms');
    localStorage.setItem('mms-theme', 'dark');
    expect(readThemeSettings()).toEqual({ style: 'mms', mode: 'dark' });
  });

  it('combines style and resolved mode into the <html data-theme> value', () => {
    mockSystemDark(true);
    expect(themeAttribute({ style: 'mms', mode: 'light' })).toBe('mms-light');
    expect(themeAttribute({ style: 'graphite', mode: 'system' })).toBe('graphite-dark');
    applyTheme({ style: 'mms', mode: 'system' });
    expect(document.documentElement.dataset.theme).toBe('mms-dark');
  });

  it('saves and applies a change', () => {
    setThemeSettings({ style: 'mms', mode: 'light' });
    expect(document.documentElement.dataset.theme).toBe('mms-light');
    expect(readThemeSettings()).toEqual({ style: 'mms', mode: 'light' });
  });
});
