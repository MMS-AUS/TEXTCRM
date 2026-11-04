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

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The plain text as simple HTML: escaped, paragraphs and line breaks kept. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${paragraphs.join('')}</div>`;
}

export type OutgoingEmail = {
  from: { name: string | null; address: string };
  to: string[];
  cc: string[];
  subject: string;
  text: string;
};

/** An RFC 5322 message (multipart/alternative: text + HTML). Inputs are header-safe (zod). */
export function buildMime(
  email: OutgoingEmail,
  boundary = `mms-${Date.now().toString(36)}`,
): string {
  const headers = [
    `From: ${mailbox(email.from.name, email.from.address)}`,
    `To: ${email.to.join(', ')}`,
    ...(email.cc.length ? [`Cc: ${email.cc.join(', ')}`] : []),
    `Subject: ${encodeHeader(email.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset="UTF-8"`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(body),
    ].join('\r\n');
  return [
    ...headers,
    '',
    part('text/plain', email.text),
    part('text/html', textToHtml(email.text)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Sends through the user's own mailbox; Gmail files it in their Sent folder. */
export async function gmailSend(fetchImpl: Fetch, accessToken: string, mime: string) {
  const response = await call(fetchImpl, 'gmail', GMAIL_SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(mime, 'utf8').toString('base64url') }),
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
