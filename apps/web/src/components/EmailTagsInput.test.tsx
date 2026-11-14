import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EmailTagsInput } from './EmailTagsInput.tsx';

const props = { id: 'email', invalid: false, 'aria-describedby': undefined };

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <EmailTagsInput value={value} onChange={setValue} props={props} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const typeInto = (text: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
};

describe('EmailTagsInput', () => {
  afterEach(cleanup);

  it('turns an address into a tag when Space is pressed, so a second one can be typed', () => {
    render(<Harness />);
    typeInto('a@home.example ');
    typeInto('b@work.example ');
    expect(screen.getByTestId('value').textContent).toBe('a@home.example b@work.example');
    expect(screen.getByTitle('Primary email').textContent).toContain('a@home.example');
    expect(screen.getByTitle('Extra email').textContent).toContain('b@work.example');
  });

  it('keeps a half-typed address in the value, so submitting without leaving the box loses nothing', () => {
    render(<Harness />);
    typeInto('a@home.example');
    expect(screen.getByTestId('value').textContent).toBe('a@home.example');
    expect(screen.queryByTitle('Primary email')).toBeNull(); // not a tag until it is finished
    fireEvent.blur(screen.getByRole('textbox'));
    expect(screen.getByTitle('Primary email').textContent).toContain('a@home.example');
    expect(screen.getByTestId('value').textContent).toBe('a@home.example');
  });

  it('takes a pasted list, and removes a tag with its x button', () => {
    render(<Harness />);
    typeInto('a@x.example, b@x.example c@x.example');
    fireEvent.blur(screen.getByRole('textbox'));
    expect(screen.getByTestId('value').textContent).toBe('a@x.example b@x.example c@x.example');
    fireEvent.click(screen.getByRole('button', { name: 'Remove b@x.example' }));
    expect(screen.getByTestId('value').textContent).toBe('a@x.example c@x.example');
  });
});
