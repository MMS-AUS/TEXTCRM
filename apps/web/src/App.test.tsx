import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

describe('App placeholder', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the API as ok when /api/health answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'ok' })));
    render(<App />);
    expect(screen.getByRole('heading', { name: 'MMS CRM' })).toBeDefined();
    expect((await screen.findByText('API: ok')).dataset.testid).toBe('api-status');
  });

  it('shows the API as unreachable when the request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(<App />);
    expect(await screen.findByText('API: unreachable')).toBeDefined();
  });
});
