import type { IntegrationProvider } from '@mms/shared';

// Outbound calls to providers: a timeout on every request, JSON parsed defensively, and
// failures turned into ProviderError with a message a user can act on (never a token).

export type Fetch = typeof fetch;

/**
 * auth — the credentials were refused · revoked — the grant is gone, reconnect ·
 * network — couldn't reach the provider · provider — the provider answered with an error.
 */
export type ProviderErrorKind = 'auth' | 'revoked' | 'network' | 'provider';

export class ProviderError extends Error {
  readonly provider: IntegrationProvider;
  readonly kind: ProviderErrorKind;
  readonly status: number | undefined;

  constructor(
    provider: IntegrationProvider,
    kind: ProviderErrorKind,
    message: string,
    status?: number,
  ) {
    super(message);
    this.provider = provider;
    this.kind = kind;
    this.status = status;
  }
}

const LABEL: Record<IntegrationProvider, string> = {
  gmail: 'Google',
  xero: 'Xero',
  messagemedia: 'MessageMedia',
};

export const TIMEOUT_MS = 15_000;

/** One request; returns the status and parsed JSON (or null). Network failures throw. */
export async function call(
  fetchImpl: Fetch,
  provider: IntegrationProvider,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; ok: boolean; body: unknown }> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    response = await fetchImpl(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new ProviderError(
      provider,
      'network',
      timedOut
        ? `${LABEL[provider]} didn't answer within ${String((init.timeoutMs ?? TIMEOUT_MS) / 1000)} seconds. Try again.`
        : `Couldn't reach ${LABEL[provider]}. Check the server's internet connection and try again.`,
    );
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { text: text.slice(0, 500) };
    }
  }
  return { status: response.status, ok: response.ok, body };
}

/** A field of an unknown JSON body, as a string. */
export function field(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
}

/** An OAuth token endpoint's error (RFC 6749 §5.2) as a ProviderError. */
export function tokenError(
  provider: IntegrationProvider,
  status: number,
  body: unknown,
): ProviderError {
  const code = field(body, 'error');
  if (code === 'invalid_grant') {
    return new ProviderError(
      provider,
      'revoked',
      `${LABEL[provider]} access has expired or was revoked. Reconnect ${provider === 'gmail' ? 'your mailbox' : 'Xero'}.`,
      status,
    );
  }
  if (code === 'invalid_client' || status === 401) {
    return new ProviderError(
      provider,
      'auth',
      `${LABEL[provider]} refused the CRM's client ID/secret. Check the ${provider === 'gmail' ? 'GOOGLE_OAUTH_' : 'XERO_'}* settings in .env.`,
      status,
    );
  }
  const detail = field(body, 'error_description') ?? code ?? `HTTP ${String(status)}`;
  return new ProviderError(
    provider,
    'provider',
    `${LABEL[provider]} sign-in failed: ${detail}.`,
    status,
  );
}

/** A non-OK API response as a ProviderError. */
export function apiError(
  provider: IntegrationProvider,
  status: number,
  body: unknown,
  action: string,
) {
  if (status === 401) {
    return new ProviderError(
      provider,
      provider === 'messagemedia' ? 'auth' : 'revoked',
      `${LABEL[provider]} refused the credentials while trying to ${action}.`,
      status,
    );
  }
  if (status === 403) {
    return new ProviderError(
      provider,
      'auth',
      `${LABEL[provider]} says the account isn't allowed to ${action} (403). Check its permissions or plan.`,
      status,
    );
  }
  if (status === 429) {
    return new ProviderError(
      provider,
      'provider',
      `${LABEL[provider]} is rate-limiting requests. Wait a minute and try again.`,
      status,
    );
  }
  const detail =
    field(body, 'message') ??
    field(body, 'Message') ??
    field(body, 'Detail') ??
    field(body, 'error_description');
  return new ProviderError(
    provider,
    'provider',
    `${LABEL[provider]} couldn't ${action}: ${detail ?? `HTTP ${String(status)}`}.`,
    status,
  );
}
