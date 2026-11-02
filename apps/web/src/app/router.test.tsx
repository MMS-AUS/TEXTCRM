import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppRouter } from './router.tsx';

function renderAt(path: string) {
  const router = createAppRouter(
    { services: null, missingConfig: ['VITE_FIREBASE_API_KEY'] },
    createMemoryHistory({ initialEntries: [path] }),
  );
  render(<RouterProvider router={router} />);
}

describe('router', () => {
  afterEach(cleanup);

  it('shows a 404 page for unknown addresses', async () => {
    renderAt('/no-such-page');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeDefined();
    expect(screen.getByRole('link', { name: /back to the dashboard/i }).getAttribute('href')).toBe(
      '/dashboard',
    );
  });

  it('protects app pages: without Firebase config they explain what is missing', async () => {
    renderAt('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Configuration missing' })).toBeDefined();
    expect(screen.getByText('VITE_FIREBASE_API_KEY')).toBeDefined();
  });
});
