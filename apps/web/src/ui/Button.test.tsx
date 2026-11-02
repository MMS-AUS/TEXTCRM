import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from './Button.tsx';
import { Field } from './Field.tsx';
import { Input } from './Input.tsx';

describe('Button', () => {
  afterEach(cleanup);

  it('is a non-submitting button by default', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('blocks clicks and reports busy while loading', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders its child instead of a button with asChild', () => {
    render(
      <Button asChild>
        <a href="/leads">Leads</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Leads' }).getAttribute('href')).toBe('/leads');
  });

  it('gives icon buttons an accessible name', () => {
    render(
      <IconButton label="Delete lead">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Delete lead' })).toBeDefined();
  });
});

describe('Field', () => {
  afterEach(cleanup);

  it('labels the control and announces the error', () => {
    render(
      <Field label="Mobile" error="Enter an Australian mobile.">
        {(props) => <Input {...props} />}
      </Field>,
    );
    const input = screen.getByLabelText('Mobile');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Enter an Australian mobile.');
  });
});
