import { apiError, call, field, ProviderError, type Fetch } from './http.ts';

// MessageMedia (Sinch) SMS (Phase 5): REST API with HTTP Basic auth (API key : secret).
// https://api.messagemedia.com — paths per MessageMedia's own SDKs.

export const MESSAGEMEDIA_API_URL = 'https://api.messagemedia.com';

export type MessageMediaCreds = { apiKey: string; apiSecret: string; defaultSender: string | null };

const basic = (creds: MessageMediaCreds) =>
  `Basic ${Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString('base64')}`;

/**
 * Proves the credentials work without sending anything: GET /v1/replies only reads (replies
 * stay unconfirmed until POST /v1/replies/confirmed, which we never call here).
 */
export async function messageMediaCheck(fetchImpl: Fetch, creds: MessageMediaCreds) {
  const response = await call(fetchImpl, 'messagemedia', `${MESSAGEMEDIA_API_URL}/v1/replies`, {
    headers: { Authorization: basic(creds) },
  });
  if (response.status === 401) {
    throw new ProviderError(
      'messagemedia',
      'auth',
      'MessageMedia refused the API key or secret. Copy them again from MessageMedia Hub → Settings → API settings.',
      401,
    );
  }
  if (!response.ok)
    throw apiError('messagemedia', response.status, response.body, 'check the account');
  const replies =
    typeof response.body === 'object' && response.body !== null && 'replies' in response.body
      ? response.body.replies
      : [];
  return { waitingReplies: Array.isArray(replies) ? replies.length : 0 };
}

/**
 * Sends one SMS (used from Step 5.3). Returns MessageMedia's message id; a response without
 * one is an error — never a made-up id.
 */
export async function messageMediaSend(
  fetchImpl: Fetch,
  creds: MessageMediaCreds,
  message: { to: string; content: string; from?: string | null; callbackUrl?: string },
) {
  if (!/^\+[1-9]\d{6,14}$/.test(message.to)) {
    throw new ProviderError(
      'messagemedia',
      'provider',
      `"${message.to}" isn't a phone number in international format.`,
    );
  }
  const source = message.from ?? creds.defaultSender;
  const response = await call(fetchImpl, 'messagemedia', `${MESSAGEMEDIA_API_URL}/v1/messages`, {
    method: 'POST',
    headers: { Authorization: basic(creds), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          content: message.content,
          destination_number: message.to,
          delivery_report: true,
          format: 'SMS',
          ...(source
            ? {
                source_number: source,
                source_number_type: /^\+?\d+$/.test(source) ? 'INTERNATIONAL' : 'ALPHANUMERIC',
              }
            : {}),
          ...(message.callbackUrl ? { callback_url: message.callbackUrl } : {}),
        },
      ],
    }),
  });
  if (!response.ok) throw apiError('messagemedia', response.status, response.body, 'send the SMS');
  const first =
    typeof response.body === 'object' && response.body !== null && 'messages' in response.body
      ? ((response.body as { messages: unknown[] }).messages[0] ?? null)
      : null;
  const messageId = field(first, 'message_id');
  if (!messageId) {
    throw new ProviderError(
      'messagemedia',
      'provider',
      "MessageMedia accepted the request but returned no message id; the SMS can't be tracked.",
    );
  }
  return { messageId, status: field(first, 'status') ?? 'queued' };
}
