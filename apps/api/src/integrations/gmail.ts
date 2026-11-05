import { apiError, call, field, ProviderError, tokenError, type Fetch } from './http.ts';
import { expiresIn, type OAuthTokens } from './oauth.ts';

// Gmail (Phase 5): per-user OAuth for an internal Google Workspace app. Only what connecting
// and checking needs is here; sending and history sync build on it (Step 5.2).

export const GMAIL_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GMAIL_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GMAIL_PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';

/** §2.2 Gmail: send, read (history sync), and who the mailbox belongs to. */
export const GMAIL_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export type GmailConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function gmailAuthorizeUrl(
  config: GmailConfig,
  { state, codeChallenge, loginHint }: { state: string; codeChallenge: string; loginHint?: string },
) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // A refresh token every time (offline + consent), so reconnecting always works.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `${GMAIL_AUTHORIZE_URL}?${params.toString()}`;
}

function tokensFrom(body: unknown, previousRefreshToken?: string): OAuthTokens {
  const accessToken = field(body, 'access_token');
  const refreshToken = field(body, 'refresh_token') ?? previousRefreshToken;
  if (!accessToken || !refreshToken) {
    throw new ProviderError(
      'gmail',
      'provider',
      "Google didn't return a refresh token. Remove the CRM's access at myaccount.google.com → Security → Third-party connections, then connect again.",
    );
  }
  const expires =
    typeof body === 'object' && body !== null && 'expires_in' in body ? body.expires_in : undefined;
  return {
    accessToken,
    refreshToken,
    expiresAt: expiresIn(expires),
    scopes: (field(body, 'scope') ?? '').split(' ').filter(Boolean),
  };
}

export async function gmailExchangeCode(
  fetchImpl: Fetch,
  config: GmailConfig,
  code: string,
  codeVerifier: string,
): Promise<OAuthTokens> {
  const response = await call(fetchImpl, 'gmail', GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!response.ok) throw tokenError('gmail', response.status, response.body);
  return tokensFrom(response.body);
}

export async function gmailRefresh(
  fetchImpl: Fetch,
  config: GmailConfig,
  refreshToken: string,
): Promise<OAuthTokens> {
  const response = await call(fetchImpl, 'gmail', GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  if (!response.ok) throw tokenError('gmail', response.status, response.body);
  // Google keeps the same refresh token unless it says otherwise.
  return tokensFrom(response.body, refreshToken);
}

/** The mailbox the token opens: its address and size. */
export async function gmailProfile(fetchImpl: Fetch, accessToken: string) {
  const response = await call(fetchImpl, 'gmail', GMAIL_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok)
    throw apiError('gmail', response.status, response.body, 'read the mailbox profile');
  const emailAddress = field(response.body, 'emailAddress');
  if (!emailAddress) {
    throw new ProviderError('gmail', 'provider', 'Google returned a profile without an address.');
  }
  return {
    emailAddress: emailAddress.toLowerCase(),
    messagesTotal: Number(field(response.body, 'messagesTotal') ?? 0),
    historyId: field(response.body, 'historyId'),
  };
}

/** Revokes the grant at Google (best effort on disconnect). */
export async function gmailRevoke(fetchImpl: Fetch, token: string): Promise<void> {
  const response = await call(fetchImpl, 'gmail', GMAIL_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  // 400 invalid_token: already revoked — the goal is met.
  if (!response.ok && response.status !== 400) {
    throw apiError('gmail', response.status, response.body, 'revoke access');
  }
}

// ── Sending (Step 5.2) ───────────────────────────────────────────────────

export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/** RFC 2047 encoded-word for non-ASCII header text (subject, display names). */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

const mailbox = (name: string | null, address: string) =>
  name ? `${encodeHeader(name.replace(/["\\<>]/g, ''))} <${address}>` : address;

/** Base64 body wrapped at 76 characters (RFC 2045). */
const base64Lines = (text: string) =>
  Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');

/** The composer's (already cleaned) HTML in a plain, readable email wrapper. */
const emailHtml = (html: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${html}</div>`;

export type MimeFile = {
  fileName: string;
  contentType: string;
  content: Buffer;
  /** Set for an image shown inside the email (e.g. the signature logo: src="cid:…"). */
  contentId?: string;
};

export type OutgoingEmail = {
  from: { name: string | null; address: string };
  to: string[];
  cc: string[];
  subject: string;
  /** The plain-text part. */
  text: string;
  /** The HTML part (cleaned by sanitizeComposeHtml, then emailReadyHtml). */
  html: string;
  /** Replying: the original's Message-ID header, so mail apps thread it. */
  inReplyTo?: string | null;
  /** Files attached to the email. */
  attachments?: MimeFile[];
  /** Images the HTML shows by Content-ID (cid:). */
  inline?: MimeFile[];
};

/** Base64 of bytes wrapped at 76 characters (RFC 2045). */
const base64Bytes = (bytes: Buffer) => bytes.toString('base64').replace(/.{76}/g, '$&\r\n');

/** filename="…" safe for any name: ASCII fallback plus RFC 2231 UTF-8. */
function fileNameParams(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return /^[\x20-\x7e]*$/.test(fileName)
    ? `filename="${ascii}"`
    : `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

type Part = { headers: string[]; body: string };

const textPart = (type: string, text: string): Part => ({
  headers: [`Content-Type: ${type}; charset="UTF-8"`, 'Content-Transfer-Encoding: base64'],
  body: base64Lines(text),
});

const filePart = (file: MimeFile): Part => ({
  headers: [
    `Content-Type: ${file.contentType}; name="${file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: ${file.contentId ? 'inline' : 'attachment'}; ${fileNameParams(file.fileName)}`,
    ...(file.contentId
      ? [`Content-ID: <${file.contentId}>`, `X-Attachment-Id: ${file.contentId}`]
      : []),
  ],
  body: base64Bytes(file.content),
});

let boundaries = 0;
function multipart(subtype: string, parts: Part[], seed: string): Part {
  boundaries += 1;
  const boundary = `${seed}-${subtype}-${String(boundaries)}`;
  return {
    headers: [`Content-Type: multipart/${subtype}; boundary="${boundary}"`],
    body: [
      ...parts.map((part) => [`--${boundary}`, ...part.headers, '', part.body].join('\r\n')),
      `--${boundary}--`,
    ].join('\r\n'),
  };
}

/**
 * An RFC 5322 message. Text and HTML are alternatives; inline images sit with the HTML
 * (multipart/related); attachments wrap everything (multipart/mixed). Inputs are header-safe (zod).
 */
export function buildMime(email: OutgoingEmail, seed = `mms-${Date.now().toString(36)}`): string {
  let body = multipart(
    'alternative',
    [textPart('text/plain', email.text), textPart('text/html', emailHtml(email.html))],
    seed,
  );
  if (email.inline?.length)
    body = multipart('related', [body, ...email.inline.map(filePart)], seed);
  if (email.attachments?.length) {
    body = multipart('mixed', [body, ...email.attachments.map(filePart)], seed);
  }
  const headers = [
    `From: ${mailbox(email.from.name, email.from.address)}`,
    `To: ${email.to.join(', ')}`,
    ...(email.cc.length ? [`Cc: ${email.cc.join(', ')}`] : []),
    `Subject: ${encodeHeader(email.subject)}`,
    ...(email.inReplyTo
      ? [`In-Reply-To: ${email.inReplyTo}`, `References: ${email.inReplyTo}`]
      : []),
    'MIME-Version: 1.0',
    ...body.headers,
  ];
  return [...headers, '', body.body, ''].join('\r\n');
}

export const GMAIL_UPLOAD_SEND_URL =
  'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart';

/** Above this the JSON endpoint refuses the message; the upload endpoint takes up to 35 MB. */
const JSON_SEND_LIMIT = 4 * 1024 * 1024;

/** Sends through the user's own mailbox; Gmail files it in their Sent folder. */
export async function gmailSend(
  fetchImpl: Fetch,
  accessToken: string,
  mime: string,
  threadId?: string | null,
) {
  const metadata = threadId ? { threadId } : {};
  const large = Buffer.byteLength(mime, 'utf8') > JSON_SEND_LIMIT;
  const boundary = `mms-upload-${Date.now().toString(36)}`;
  const response = large
    ? await call(fetchImpl, 'gmail', GMAIL_UPLOAD_SEND_URL, {
        method: 'POST',
        // Up to 25 MB going up: allow longer than an ordinary API call.
        timeoutMs: 120_000,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary="${boundary}"`,
        },
        body: [
          `--${boundary}`,
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify(metadata),
          `--${boundary}`,
          'Content-Type: message/rfc822',
          '',
          mime,
          `--${boundary}--`,
          '',
        ].join('\r\n'),
      })
    : await call(fetchImpl, 'gmail', GMAIL_SEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: Buffer.from(mime, 'utf8').toString('base64url'), ...metadata }),
      });
  if (!response.ok) throw apiError('gmail', response.status, response.body, 'send the email');
  const id = field(response.body, 'id');
  if (!id)
    throw new ProviderError(
      'gmail',
      'provider',
      'Gmail accepted the email but returned no message id.',
    );
  return { messageId: id, threadId: field(response.body, 'threadId') ?? null };
}

// ── Inbox sync (Step 5.2): watch, history, messages ─────────────────────

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

/**
 * Asks Gmail to publish inbox changes to our Pub/Sub topic. A watch lasts 7 days, so the
 * worker renews it daily. Returns the mailbox's current history ID.
 */
export async function gmailWatch(fetchImpl: Fetch, accessToken: string, topicName: string) {
  const response = await call(fetchImpl, 'gmail', `${API}/watch`, {
    method: 'POST',
    headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicName, labelIds: ['INBOX'], labelFilterBehavior: 'include' }),
  });
  if (!response.ok)
    throw apiError('gmail', response.status, response.body, 'watch the inbox (Pub/Sub)');
  const historyId = field(response.body, 'historyId');
  const expiration = Number(field(response.body, 'expiration'));
  if (!historyId || !Number.isFinite(expiration)) {
    throw new ProviderError('gmail', 'provider', 'Gmail returned an unexpected watch response.');
  }
  return { historyId, expiresAt: new Date(expiration) };
}

/** Stops the Pub/Sub watch (on disconnect). */
export async function gmailStopWatch(fetchImpl: Fetch, accessToken: string) {
  const response = await call(fetchImpl, 'gmail', `${API}/stop`, {
    method: 'POST',
    headers: bearer(accessToken),
  });
  if (!response.ok) throw apiError('gmail', response.status, response.body, 'stop the watch');
}

export type HistoryPage = { messageIds: string[]; historyId: string | null; next: string | null };

/**
 * Messages added to the inbox since `startHistoryId`. Null when that ID is too old for Gmail
 * to answer (about a week) — the caller then lists recent messages instead.
 */
export async function gmailHistory(
  fetchImpl: Fetch,
  accessToken: string,
  startHistoryId: string,
  pageToken?: string,
): Promise<HistoryPage | null> {
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: 'messageAdded',
    labelId: 'INBOX',
    maxResults: '500',
    ...(pageToken ? { pageToken } : {}),
  });
  const response = await call(fetchImpl, 'gmail', `${API}/history?${params.toString()}`, {
    headers: bearer(accessToken),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw apiError('gmail', response.status, response.body, 'read the inbox');
  const body = response.body as {
    history?: { messagesAdded?: { message?: { id?: string } }[] }[];
    historyId?: string;
    nextPageToken?: string;
  };
  const messageIds = (body.history ?? []).flatMap((h) =>
    (h.messagesAdded ?? []).map((m) => m.message?.id).filter((id): id is string => !!id),
  );
  return { messageIds, historyId: body.historyId ?? null, next: body.nextPageToken ?? null };
}

/** The newest inbox message IDs (when the history is too old to read). */
export async function gmailRecentInbox(fetchImpl: Fetch, accessToken: string, max = 50) {
  const params = new URLSearchParams({
    labelIds: 'INBOX',
    maxResults: String(max),
    q: 'newer_than:3d',
  });
  const response = await call(fetchImpl, 'gmail', `${API}/messages?${params.toString()}`, {
    headers: bearer(accessToken),
  });
  if (!response.ok) throw apiError('gmail', response.status, response.body, 'list the inbox');
  const body = response.body as { messages?: { id?: string }[] };
  return (body.messages ?? []).map((m) => m.id).filter((id): id is string => !!id);
}

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string | null;
  labelIds: string[];
  /** When Gmail received it. */
  receivedAt: Date;
  from: { name: string | null; address: string } | null;
  to: string[];
  cc: string[];
  /** Only present on the sender's own copy. */
  bcc: string[];
  subject: string;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  /** An auto-reply / bounce (Auto-Submitted header). */
  autoSubmitted: boolean;
  text: string | null;
  html: string | null;
  attachments: number;
};

/** "Name <a@b.c>, d@e.f" → the addresses (lowercased) with their display names. */
export function parseAddressList(
  value: string | undefined,
): { name: string | null; address: string }[] {
  if (!value) return [];
  const out: { name: string | null; address: string }[] = [];
  // Commas inside quoted display names don't separate addresses.
  const parts = value.match(/(?:"[^"]*"|[^,])+/g) ?? [];
  for (const part of parts) {
    const angle = /<([^>]+)>/.exec(part);
    const address = (angle?.[1] ?? part).trim().toLowerCase();
    if (!/^[^\s@<>"]+@[^\s@<>"]+$/.test(address)) continue;
    const name = angle ? part.slice(0, angle.index).trim().replace(/^"|"$/g, '').trim() : '';
    out.push({ name: name || null, address });
  }
  return out;
}

function decodePart(part: GmailPart): string {
  const data = part.body?.data;
  if (!data) return '';
  const contentType = part.headers?.find((h) => h.name?.toLowerCase() === 'content-type')?.value;
  const charset = /charset="?([\w-]+)"?/i.exec(contentType ?? '')?.[1] ?? 'utf-8';
  const bytes = Buffer.from(data, 'base64url');
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Walks the MIME tree: the first text/plain and text/html parts; attachments are counted. */
function bodies(root: GmailPart) {
  const found: { text: string | null; html: string | null; attachments: number } = {
    text: null,
    html: null,
    attachments: 0,
  };
  const visit = (part: GmailPart) => {
    if (part.filename) {
      found.attachments += 1;
      return;
    }
    if (part.mimeType === 'text/plain' && found.text === null) found.text = decodePart(part);
    else if (part.mimeType === 'text/html' && found.html === null) found.html = decodePart(part);
    for (const child of part.parts ?? []) visit(child);
  };
  visit(root);
  return found;
}

/** One message, parsed. Null when it has gone (deleted before we read it). */
export async function gmailGetMessage(
  fetchImpl: Fetch,
  accessToken: string,
  id: string,
): Promise<GmailMessage | null> {
  const response = await call(
    fetchImpl,
    'gmail',
    `${API}/messages/${encodeURIComponent(id)}?format=full`,
    { headers: bearer(accessToken) },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw apiError('gmail', response.status, response.body, 'read an email');
  const body = response.body as {
    id?: string;
    threadId?: string;
    labelIds?: string[];
    internalDate?: string;
    payload?: GmailPart;
  };
  const payload = body.payload ?? {};
  const header = (name: string) =>
    payload.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;
  const internal = Number(body.internalDate);
  const auto = header('Auto-Submitted');
  return {
    id: body.id ?? id,
    threadId: body.threadId ?? null,
    labelIds: body.labelIds ?? [],
    receivedAt: Number.isFinite(internal) ? new Date(internal) : new Date(),
    from: parseAddressList(header('From'))[0] ?? null,
    to: parseAddressList(header('To')).map((a) => a.address),
    cc: parseAddressList(header('Cc')).map((a) => a.address),
    bcc: parseAddressList(header('Bcc')).map((a) => a.address),
    subject: (header('Subject') ?? '').replace(/\s+/g, ' ').trim(),
    messageIdHeader: header('Message-ID')?.trim() ?? null,
    inReplyTo: header('In-Reply-To')?.trim() ?? null,
    autoSubmitted: !!auto && auto.toLowerCase() !== 'no',
    ...bodies(payload),
  };
}

/**
 * The Message-ID header Gmail gave a message we sent. Recorded so the copies colleagues
 * receive (CC) are recognised as the same email, and replies to it can be matched.
 */
export async function gmailMessageIdHeader(
  fetchImpl: Fetch,
  accessToken: string,
  id: string,
): Promise<string | null> {
  const params = new URLSearchParams({ format: 'metadata', metadataHeaders: 'Message-ID' });
  const response = await call(
    fetchImpl,
    'gmail',
    `${API}/messages/${encodeURIComponent(id)}?${params.toString()}`,
    { headers: bearer(accessToken) },
  );
  if (!response.ok) return null;
  const body = response.body as { payload?: GmailPart };
  return (
    body.payload?.headers?.find((h) => h.name?.toLowerCase() === 'message-id')?.value?.trim() ??
    null
  );
}
