import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { normaliseLink } from './links.ts';
import { RichTextEditor } from './RichTextEditor.tsx';

// jsdom has no layout; ProseMirror asks for rectangles when it scrolls the cursor into view.
beforeAll(() => {
  const rect = () => new DOMRect(0, 0, 0, 0);
  const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  for (const proto of [Range.prototype, Element.prototype, Text.prototype] as object[]) {
    Object.assign(proto, { getClientRects: rects, getBoundingClientRect: rect });
  }
});

describe('RichTextEditor', () => {
  afterEach(cleanup);

  it('is a labelled text box with the formatting toolbar', async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor label="Message" required defaultValue="<p>Hello</p>" onChange={onChange} />,
    );
    const box = await screen.findByRole('textbox', { name: /Message/ });
    expect(box.getAttribute('aria-required')).toBe('true');
    for (const name of [
      'Undo',
      'Redo',
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Text colour',
      'Highlight',
      'Alignment',
      'Bulleted list',
      'Numbered list',
      'Quote',
      'Horizontal line',
      'Link',
      'Clear formatting',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDefined();
    }
    expect(screen.getByRole('combobox', { name: 'Font' }).textContent).toContain('Sans Serif');
    expect(screen.getByRole('combobox', { name: 'Size' }).textContent).toContain('Normal');
    fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' }));
    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toBe('<ul><li><p>Hello</p></li></ul>');
    });
    expect(String(onChange.mock.lastCall?.[1]).trim()).toBe('Hello');
    expect(screen.getByRole('button', { name: 'Bulleted list' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('aligns, quotes and adds a line', async () => {
    const onChange = vi.fn();
    render(<RichTextEditor label="Message" defaultValue="<p>Hello</p>" onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Alignment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Align centre' }));
    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toBe('<p style="text-align: center;">Hello</p>');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
    await waitFor(() => {
      expect(String(onChange.mock.lastCall?.[0])).toMatch(
        /^<blockquote><p[^>]*>Hello<\/p><\/blockquote>/,
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal line' }));
    await waitFor(() => {
      expect(String(onChange.mock.lastCall?.[0])).toContain('<hr>');
    });
  });

  it('adds a link from the link bar', async () => {
    const onChange = vi.fn();
    render(<RichTextEditor label="Message" defaultValue="<p>Hi</p>" onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Link' }));
    fireEvent.change(screen.getByLabelText('Link address'), {
      target: { value: 'makemysolar.com.au' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
    await waitFor(() => {
      expect(String(onChange.mock.lastCall?.[0])).toContain('href="https://makemysolar.com.au"');
    });
  });

  it('only accepts web, email and phone links', () => {
    expect(normaliseLink('example.com/x')).toBe('https://example.com/x');
    expect(normaliseLink('sam@example.com')).toBe('mailto:sam@example.com');
    expect(normaliseLink('http://a.example')).toBe('http://a.example');
    expect(normaliseLink('javascript:alert(1)')).toBeNull();
    expect(normaliseLink('  ')).toBeNull();
  });
});
