import { Parser } from 'htmlparser2';
import sanitizeHtml from 'sanitize-html';

// Email HTML (Step 5.2). Everything that is stored or sent is cleaned here first: the
// composer's HTML keeps its formatting (fonts, sizes, colours, alignment, lists, quotes, links)
// through a strict allowlist of tags and inline styles, and a received email keeps its structure
// but loses scripts, stylesheets, images (tracking pixels) and anything that could run in the CRM.

const LINK_SCHEMES = ['http', 'https', 'mailto', 'tel'];

const COLOR = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i,
];

/**
 * The only inline styles kept. Values are matched whole, so nothing like url(), expression()
 * or position can get through.
 */
const ALLOWED_STYLES: sanitizeHtml.IOptions['allowedStyles'] = {
  '*': {
    color: COLOR,
    'background-color': COLOR,
    'text-align': [/^(left|right|center|justify)$/],
    'font-size': [/^\d{1,2}(\.\d+)?(px|pt)$/],
    'font-family': [/^[a-z0-9 ,'"-]{1,100}$/i],
  },
};

/** What the composer can produce. */
const COMPOSE: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'span',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'a',
    'blockquote',
    'hr',
  ],
  allowedAttributes: { a: ['href'], '*': ['style'] },
  allowedStyles: ALLOWED_STYLES,
  allowedSchemes: LINK_SCHEMES,
  allowProtocolRelative: false,
};

/** Gmail's and Outlook's quoted earlier messages: already in the CRM as their own messages. */
function isQuotedHistory(frame: sanitizeHtml.IFrame) {
  const cls = frame.attribs.class ?? '';
  return (
    /\bgmail_quote\b/.test(cls) ||
    /\bgmail_attr\b/.test(cls) ||
    frame.attribs.id === 'divRplyFwdMsg' ||
    frame.attribs.id === 'appendonsend' ||
    (frame.tag === 'blockquote' && frame.attribs.type === 'cite')
  );
}

const INBOUND: sanitizeHtml.IOptions = {
  allowedTags: [
    ...(COMPOSE.allowedTags as string[]),
    'div',
    'span',
    'h1',
    'h2',
    'h3',
    'h4',
    'hr',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
  ],
  // target/rel are set by transformTags below (attributes are filtered after it runs).
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    '*': ['style'],
  },
  allowedStyles: ALLOWED_STYLES,
  allowedSchemes: LINK_SCHEMES,
  allowProtocolRelative: false,
  // Links open outside the CRM and don't pass it along as the referrer.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
    }),
  },
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title', 'head'],
};

export function sanitizeComposeHtml(html: string): string {
  return (
    sanitizeHtml(html, COMPOSE)
      // Spans whose styles were all removed carry nothing.
      .replace(/<span>([^<]*)<\/span>/g, '$1')
      .trim()
  );
}

/**
 * Cleaned composer HTML made ready for mail apps: quotes and lines get the inline styles Gmail
 * uses (mail apps ignore stylesheets), and paragraphs lose the browser's default gap, as in Gmail.
 */
export function emailReadyHtml(html: string): string {
  return html
    .replace(
      /<blockquote(\s[^>]*)?>/g,
      '<blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">',
    )
    .replace(/<hr\s*\/?>/g, '<hr style="border:none;border-top:1px solid #ccc;margin:12px 0">')
    .replace(/<p(\s[^>]*)?><\/p>/g, '<p$1><br></p>')
    .replace(/<p>/g, '<p style="margin:0">')
    .replace(/<p style="(?!margin)/g, '<p style="margin:0;');
}

export function sanitizeInboundHtml(html: string): string {
  // First pass: drop the quoted history while every attribute is still there to recognise it.
  const unquoted = sanitizeHtml(html, {
    allowedTags: false,
    allowedAttributes: false,
    exclusiveFilter: isQuotedHistory,
  });
  const clean = sanitizeHtml(unquoted, INBOUND);
  // Empty wrappers left behind by removed quotes and images.
  return clean
    .replace(/(<(div|span|p)>\s*(<br\s*\/?>)?\s*<\/\2>\s*)+$/g, '')
    .replace(/(<br\s*\/?>\s*)+$/g, '')
    .trim();
}

const BLOCK = new Set([
  'p',
  'div',
  'blockquote',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'pre',
  'table',
  'tr',
  'hr',
]);

/**
 * The plain-text version of (already cleaned) email HTML: paragraphs separated by a blank
 * line, list items as "• " or "1. ", links as "text (url)" when the text isn't the url.
 */
export function htmlToText(html: string): string {
  let out = '';
  const lists: { ordered: boolean; n: number }[] = [];
  const links: { href: string; start: number }[] = [];
  let pre = 0;
  const breakLine = (blank: boolean) => {
    out = out.replace(/[ \t]+$/, '');
    if (out === '') return;
    const want = blank ? '\n\n' : '\n';
    if (!out.endsWith(want)) out = out.replace(/\n*$/, want);
  };
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (name === 'br') out = out.replace(/[ \t]+$/, '') + '\n';
        else if (name === 'hr') {
          breakLine(true);
          out += '——————————';
          breakLine(true);
        } else if (name === 'li') {
          breakLine(false);
          const list = lists.at(-1);
          const indent = '  '.repeat(Math.max(0, lists.length - 1));
          if (list) list.n += 1;
          out += indent + (list?.ordered ? `${String(list.n)}. ` : '• ');
        } else if (name === 'ul' || name === 'ol') {
          breakLine(lists.length === 0);
          lists.push({ ordered: name === 'ol', n: 0 });
        } else if (name === 'td' || name === 'th') {
          if (!out.endsWith('\n') && out !== '') out += '  ';
        } else if (BLOCK.has(name)) breakLine(true);
        if (name === 'pre') pre += 1;
        if (name === 'a') links.push({ href: attribs.href ?? '', start: out.length });
      },
      ontext(text) {
        if (pre > 0) {
          out += text;
          return;
        }
        const collapsed = text.replace(/\s+/g, ' ');
        out += out === '' || out.endsWith('\n') ? collapsed.trimStart() : collapsed;
      },
      onclosetag(name) {
        if (name === 'a') {
          const link = links.pop();
          if (link?.href) {
            const label = out.slice(link.start).trim();
            const bare = link.href.replace(/^mailto:/, '');
            if (label !== link.href && label !== bare) out += ` (${bare})`;
          }
        } else if (name === 'ul' || name === 'ol') {
          lists.pop();
          breakLine(lists.length === 0);
        } else if (name === 'li') breakLine(false);
        else if (BLOCK.has(name)) breakLine(true);
        if (name === 'pre') pre -= 1;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text as simple HTML (a received email with no HTML part). */
export function textToSimpleHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Plain-text email: drops the quoted earlier messages ("On … wrote:" and "> " lines). */
export function stripQuotedText(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex(
    (line, i) =>
      /^On .+wrote:\s*$/.test(line) ||
      (/^On .+/.test(line) && /wrote:\s*$/.test(lines[i + 1] ?? '')) ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(line) ||
      (/^From: .+/.test(line) && /^(Sent|Date): /.test(lines[i + 1] ?? '')),
  );
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).filter((line) => !/^>/.test(line));
  return kept.join('\n').trim();
}
