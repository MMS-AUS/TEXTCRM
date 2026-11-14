import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EmailLinks } from './EmailLinks.tsx';

describe('EmailLinks', () => {
  afterEach(cleanup);

  it('shows the primary email and each extra email as a mailto link', () => {
    render(<EmailLinks email="a@x.example" extraEmails={['b@x.example', 'c@x.example']} />);
    expect(screen.getByRole('link', { name: 'a@x.example' }).getAttribute('href')).toBe(
      'mailto:a@x.example',
    );
    expect(screen.getByRole('link', { name: 'c@x.example' }).getAttribute('href')).toBe(
      'mailto:c@x.example',
    );
  });

  it('shows nothing without a primary email', () => {
    const { container } = render(<EmailLinks email={null} extraEmails={[]} />);
    expect(container.textContent).toBe('');
  });
});
