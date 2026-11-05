import { describe, expect, it } from 'vitest';
import {
  htmlToText,
  sanitizeComposeHtml,
  sanitizeInboundHtml,
  stripQuotedText,
} from './email-html.ts';
import { parseAddressList } from './gmail.ts';

describe('email HTML', () => {
  it('the composer keeps simple formatting only', () => {
    expect(
      sanitizeComposeHtml(
        '<h1 style="color:red">Hi</h1><p onclick="x()"><strong>B</strong> <em>I</em> <u>U</u> <a href="javascript:x()">bad</a> <a href="https://ok.example" target="_top">ok</a></p><iframe src="x"></iframe>',
      ),
    ).toBe(
      'Hi<p><strong>B</strong> <em>I</em> <u>U</u> <a>bad</a> <a href="https://ok.example">ok</a></p>',
    );
  });

  it('received HTML drops styles, images and quoted history; links open safely', () => {
    expect(
      sanitizeInboundHtml(
        '<style>p{}</style><p style="x">Yes <img src="t.gif"><a href="https://a.example">link</a></p><blockquote type="cite">old</blockquote>',
      ),
    ).toBe(
      '<p>Yes <a href="https://a.example" target="_blank" rel="noopener noreferrer nofollow">link</a></p>',
    );
  });

  it('turns HTML into readable plain text', () => {
    expect(
      htmlToText(
        '<p>Hi &amp; welcome,</p><ol><li>One</li><li>Two<ul><li>Sub</li></ul></li></ol><p>Line<br>break  with   spaces</p><p><a href="mailto:a@b.co">a@b.co</a> <a href="https://x.example">site</a></p>',
      ),
    ).toBe(
      'Hi & welcome,\n\n1. One\n2. Two\n  • Sub\n\nLine\nbreak with spaces\n\na@b.co site (https://x.example)',
    );
  });

  it('cuts the quoted earlier message from a plain-text reply', () => {
    expect(stripQuotedText('Sounds good.\n\nOn Tue, 4 Nov 2026, Micky wrote:\n> Hello')).toBe(
      'Sounds good.',
    );
    expect(stripQuotedText('Yes\r\n> quoted\r\nThanks')).toBe('Yes\nThanks');
  });

  it('parses address headers', () => {
    expect(parseAddressList('"Smith, Jack" <Jack@Example.com>, olivia@example.com, junk')).toEqual([
      { name: 'Smith, Jack', address: 'jack@example.com' },
      { name: null, address: 'olivia@example.com' },
    ]);
  });
});
