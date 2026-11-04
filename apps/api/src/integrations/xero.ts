import { apiError, call, field, ProviderError, tokenError, type Fetch } from './http.ts';
import { expiresIn, jwtClaims, type OAuthTokens } from './oauth.ts';

// Xero (Phase 5): the business organisation, via OAuth 2.0 (authorization code + PKCE, client
// secret). Xero rotates the refresh token on every refresh — always store the new one.

export const XERO_AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
export const XERO_REVOKE_URL = 'https://identity.xero.com/connect/revocation';
export const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
export const XERO_API_URL = 'https://api.xero.com/api.xro/2.0';

/** §2.2 Xero scopes; offline_access gives the refresh token. */
export const XERO_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.transactions',
  'accounting.contacts',
  'accounting.settings',
];

export type XeroConfig = { clientId: string; clientSecret: string; redirectUri: string };

const basic = (config: XeroConfig) =>
  `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;

export function xeroAuthorizeUrl(
  config: XeroConfig,
  { state, codeChallenge }: { state: string; codeChallenge: string },
) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: XERO_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${XERO_AUTHORIZE_URL}?${params.toString()}`;
}

function tokensFrom(body: unknown): OAuthTokens {
  const accessToken = field(body, 'access_token');
  const refreshToken = field(body, 'refresh_token');
  if (!accessToken || !refreshToken) {
    throw new ProviderError(
      'xero',
      'provider',
      "Xero didn't return a refresh token (offline_access). Connect again.",
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

async function tokenRequest(fetchImpl: Fetch, config: XeroConfig, params: Record<string, string>) {
  const response = await call(fetchImpl, 'xero', XERO_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basic(config), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!response.ok) throw tokenError('xero', response.status, response.body);
  return tokensFrom(response.body);
}

export const xeroExchangeCode = (
  fetchImpl: Fetch,
  config: XeroConfig,
  code: string,
  codeVerifier: string,
) =>
  tokenRequest(fetchImpl, config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });

export const xeroRefresh = (fetchImpl: Fetch, config: XeroConfig, refreshToken: string) =>
  tokenRequest(fetchImpl, config, { grant_type: 'refresh_token', refresh_token: refreshToken });

export type XeroTenant = {
  connectionId: string;
  tenantId: string;
  tenantName: string;
  tenantType: string;
  authEventId: string | null;
};

/** The organisations this token can reach. */
export async function xeroConnections(
  fetchImpl: Fetch,
  accessToken: string,
): Promise<XeroTenant[]> {
  const response = await call(fetchImpl, 'xero', XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok)
    throw apiError('xero', response.status, response.body, 'list connected organisations');
  if (!Array.isArray(response.body)) return [];
  return response.body.flatMap((item: unknown) => {
    const tenantId = field(item, 'tenantId');
    const connectionId = field(item, 'id');
    if (!tenantId || !connectionId) return [];
    return [
      {
        connectionId,
        tenantId,
        tenantName: field(item, 'tenantName') ?? 'Xero organisation',
        tenantType: field(item, 'tenantType') ?? 'ORGANISATION',
        authEventId: field(item, 'authEventId') ?? null,
      },
    ];
  });
}

/** The organisations just authorised in this sign-in (Xero tags them with the auth event). */
export function tenantsFromThisSignIn(accessToken: string, tenants: XeroTenant[]): XeroTenant[] {
  const event = jwtClaims(accessToken).authentication_event_id;
  const fromEvent = typeof event === 'string' ? tenants.filter((t) => t.authEventId === event) : [];
  return (fromEvent.length ? fromEvent : tenants).filter((t) => t.tenantType === 'ORGANISATION');
}

/** The organisation's name and details — a real read with the tenant header. */
export async function xeroOrganisation(fetchImpl: Fetch, accessToken: string, tenantId: string) {
  const response = await call(fetchImpl, 'xero', `${XERO_API_URL}/Organisation`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'xero-tenant-id': tenantId },
  });
  if (!response.ok) throw apiError('xero', response.status, response.body, 'read the organisation');
  const list =
    typeof response.body === 'object' && response.body !== null && 'Organisations' in response.body
      ? response.body.Organisations
      : null;
  const org: unknown = Array.isArray(list) ? list[0] : null;
  return {
    name: field(org, 'Name') ?? 'Xero organisation',
    legalName: field(org, 'LegalName') ?? null,
    countryCode: field(org, 'CountryCode') ?? null,
    isDemoCompany:
      typeof org === 'object' && org !== null && 'IsDemoCompany' in org
        ? org.IsDemoCompany === true
        : false,
  };
}

/** Disconnects one organisation from the CRM's Xero app. */
export async function xeroDeleteConnection(
  fetchImpl: Fetch,
  accessToken: string,
  connectionId: string,
) {
  const response = await call(
    fetchImpl,
    'xero',
    `${XERO_CONNECTIONS_URL}/${encodeURIComponent(connectionId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok && response.status !== 404) {
    throw apiError('xero', response.status, response.body, 'disconnect the organisation');
  }
}

/** Revokes the refresh token (and with it every access token from it). */
export async function xeroRevoke(fetchImpl: Fetch, config: XeroConfig, refreshToken: string) {
  const response = await call(fetchImpl, 'xero', XERO_REVOKE_URL, {
    method: 'POST',
    headers: { Authorization: basic(config), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }),
  });
  if (!response.ok && response.status !== 400) {
    throw apiError('xero', response.status, response.body, 'revoke access');
  }
}
