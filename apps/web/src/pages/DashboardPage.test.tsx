import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAuth, fakeProfile, renderWithProviders } from '../test/render.tsx';
import { DashboardPage } from './DashboardPage.tsx';

describe('DashboardPage', () => {
  afterEach(cleanup);

  const responses = {
    'health.ping': { status: 'ok' },
    'optionLists.list': [
      { key: 'phases', name: 'Phases', activeOptions: 3 },
      { key: 'states', name: 'States', activeOptions: 8 },
    ],
  };

  it('greets the user and shows data from a protected procedure', async () => {
    renderWithProviders(<DashboardPage />, {
      auth: fakeAuth({ status: 'signedIn', profile: fakeProfile }),
      responses,
    });
    expect(screen.getByRole('heading', { name: 'Welcome, Sam' })).toBeDefined();
    expect(screen.getByText('Admin')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId('option-list-count').textContent).toBe('2');
    });
  });

  it('signs out from the header', () => {
    const auth = fakeAuth({ status: 'signedIn', profile: fakeProfile });
    renderWithProviders(<DashboardPage />, { auth, responses });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
});
