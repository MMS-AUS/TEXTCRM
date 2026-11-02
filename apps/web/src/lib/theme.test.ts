import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readThemePreference, resolveTheme } from './theme.ts';

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

  it('follows the system when no choice is saved', () => {
    expect(readThemePreference()).toBe('system');
    mockSystemDark(true);
    expect(resolveTheme('system')).toBe('dark');
    mockSystemDark(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('ignores unknown saved values', () => {
    localStorage.setItem('mms-theme', 'purple');
    expect(readThemePreference()).toBe('system');
    localStorage.setItem('mms-theme', 'dark');
    expect(readThemePreference()).toBe('dark');
  });

  it('applies the resolved theme to <html>', () => {
    mockSystemDark(true);
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
