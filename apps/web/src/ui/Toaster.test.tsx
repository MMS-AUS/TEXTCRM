import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { dismissToast, toast } from './toast-store.ts';
import { Toaster } from './Toaster.tsx';

describe('Toaster', () => {
  afterEach(cleanup);

  it('shows toasts raised anywhere and removes dismissed ones', () => {
    render(<Toaster />);
    let id = 0;
    act(() => {
      id = toast({ title: 'Lead saved', description: 'Assigned to Micky', tone: 'success' });
    });
    expect(screen.getByText('Lead saved')).toBeDefined();
    expect(screen.getByText('Assigned to Micky')).toBeDefined();
    act(() => {
      dismissToast(id);
    });
    expect(screen.queryByText('Lead saved')).toBeNull();
  });
});
