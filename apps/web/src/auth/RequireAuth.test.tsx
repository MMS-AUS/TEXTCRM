import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAuth, fakeProfile, renderWithProviders } from '../test/render.tsx';
import { RequireAuth } from './RequireAuth.tsx';

const secret = <p>Protected content</p>;

describe('RequireAuth', () => {
  afterEach(cleanup);

  it('shows a loading message while the session is checked', () => {
    renderWithProviders(<RequireAuth>{secret}</RequireAuth>, {
      auth: fakeAuth({ status: 'loading' }),
    });
    expect(screen.getByText('Checking your session…')).toBeDefined();
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('shows the login screen, not the content, when signed out', async () => {
    renderWithProviders(<RequireAuth>{secret}</RequireAuth>, {
      auth: fakeAuth({ status: 'signedOut' }),
      responses: { 'health.ping': { status: 'ok' } },
    });
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDefined();
    expect(screen.queryByText('Protected content')).toBeNull();
    expect(await screen.findByText('API: ok')).toBeDefined();
  });

  it('shows the refusal message on the login screen', () => {
    renderWithProviders(<RequireAuth>{secret}</RequireAuth>, {
      auth: fakeAuth({ status: 'signedOut', message: 'Your account does not have access.' }),
    });
    expect(screen.getByRole('alert').textContent).toBe('Your account does not have access.');
  });

  it('starts Google sign-in from the button', () => {
    const auth = fakeAuth({ status: 'signedOut' });
    renderWithProviders(<RequireAuth>{secret}</RequireAuth>, { auth });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(auth.signInWithGoogle).toHaveBeenCalledOnce();
  });

  it('renders the protected content for a signed-in user', () => {
    renderWithProviders(<RequireAuth>{secret}</RequireAuth>, {
      auth: fakeAuth({ status: 'signedIn', profile: fakeProfile }),
    });
    expect(screen.getByText('Protected content')).toBeDefined();
  });
});
