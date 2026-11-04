import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import {
  INTEGRATION_INFO,
  INTEGRATION_PROVIDERS,
  type ConnectionStatus,
  type IntegrationProvider,
} from '@mms/shared';
import type { Config } from '../config.ts';
import type { Db, Tx } from '../db/client.ts';
import { integrationConnections, integrationOAuthStates, users } from '../db/schema/index.ts';
import type { Logger } from '../logger.ts';
import { recordAudit, type Actor } from '../modules/audit.ts';
import { decryptJson, encryptJson, parseEncryptionKey, type EncryptionKey } from './crypto.ts';
import {
  gmailAuthorizeUrl,
  gmailExchangeCode,
  gmailProfile,
  gmailRefresh,
  gmailRevoke,
  type GmailConfig,
} from './gmail.ts';
import { ProviderError, type Fetch } from './http.ts';
import { messageMediaCheck, type MessageMediaCreds } from './messagemedia.ts';
import { needsRefresh, pkce, randomToken, type OAuthTokens } from './oauth.ts';
import {
  tenantsFromThisSignIn,
  xeroAuthorizeUrl,
  xeroConnections,
  xeroDeleteConnection,
  xeroExchangeCode,
  xeroOrganisation,
  xeroRefresh,
  xeroRevoke,
  type XeroConfig,
  type XeroTenant,
} from './xero.ts';

// Integration connections (Phase 5): connect (OAuth or API key), status, test, disconnect.
// Secrets are encrypted at rest and never returned by the API.

export type Integrations = {
  fetch: Fetch;
  key: EncryptionKey;
  gmail: GmailConfig | null;
  xero: XeroConfig | null;
  /** MessageMedia credentials from .env, used when none were saved in the CRM. */
  messageMediaEnv: MessageMediaCreds | null;
  /** Where the browser goes after an OAuth callback (the web app). */
  appUrl: string;
};

type IntegrationsConfig = Partial<
  Pick<
    Config,
    | 'TOKEN_ENCRYPTION_KEY'
    | 'GOOGLE_OAUTH_CLIENT_ID'
    | 'GOOGLE_OAUTH_CLIENT_SECRET'
    | 'GOOGLE_OAUTH_REDIRECT_URI'
    | 'XERO_CLIENT_ID'
    | 'XERO_CLIENT_SECRET'
    | 'XERO_REDIRECT_URI'
    | 'MESSAGEMEDIA_API_KEY'
    | 'MESSAGEMEDIA_API_SECRET'
    | 'MESSAGEMEDIA_DEFAULT_SENDER'
  >
> & { APP_URL: string };

export function createIntegrations(
  config: IntegrationsConfig,
  fetchImpl: Fetch = fetch,
): Integrations {
  const oauth = (id?: string, secret?: string, redirect?: string) =>
    id && secret && redirect ? { clientId: id, clientSecret: secret, redirectUri: redirect } : null;
  return {
    fetch: fetchImpl,
    key: parseEncryptionKey(config.TOKEN_ENCRYPTION_KEY),
    gmail: oauth(
      config.GOOGLE_OAUTH_CLIENT_ID,
      config.GOOGLE_OAUTH_CLIENT_SECRET,
      config.GOOGLE_OAUTH_REDIRECT_URI,
    ),
    xero: oauth(config.XERO_CLIENT_ID, config.XERO_CLIENT_SECRET, config.XERO_REDIRECT_URI),
    messageMediaEnv:
      config.MESSAGEMEDIA_API_KEY && config.MESSAGEMEDIA_API_SECRET
        ? {
            apiKey: config.MESSAGEMEDIA_API_KEY,
            apiSecret: config.MESSAGEMEDIA_API_SECRET,
            defaultSender: config.MESSAGEMEDIA_DEFAULT_SENDER ?? null,
          }
        : null,
    appUrl: config.APP_URL,
  };
}

/** A problem the person can fix (shown as-is). */
export class IntegrationUserError extends Error {}

type Connection = typeof integrationConnections.$inferSelect;
type OAuthProvider = 'gmail' | 'xero';
type User = { id: string; email: string };

const STATE_TTL_MS = 10 * 60_000;

/** Why a provider can't be used yet, or null when it is set up. */
export function setupProblem(int: Integrations, provider: IntegrationProvider): string | null {
  if (!int.key.ok) return int.key.problem;
  if (provider === 'gmail' && !int.gmail) {
    return 'Gmail isn’t set up: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI are needed in .env.';
  }
  if (provider === 'xero' && !int.xero) {
    return 'Xero isn’t set up: XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI are needed in .env.';
  }
  return null;
}

function requireKey(int: Integrations): Buffer {
  if (!int.key.ok) throw new IntegrationUserError(int.key.problem);
  return int.key.key;
}

const ownerOf = (provider: IntegrationProvider, user: User) =>
  INTEGRATION_INFO[provider].owner === 'user' ? user.id : null;

export async function loadConnection(
  db: Db | Tx,
  provider: IntegrationProvider,
  userId: string | null,
) {
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.provider, provider),
        userId ? eq(integrationConnections.userId, userId) : isNull(integrationConnections.userId),
      ),
    );
  return row ?? null;
}

async function saveConnection(
  tx: Tx,
  provider: IntegrationProvider,
  userId: string | null,
  values: Omit<typeof integrationConnections.$inferInsert, 'provider' | 'userId'>,
) {
  const existing = await loadConnection(tx, provider, userId);
  if (existing) {
    await tx
      .update(integrationConnections)
      .set(values)
      .where(eq(integrationConnections.id, existing.id));
    return existing.id;
  }
  const [created] = await tx
    .insert(integrationConnections)
    .values({ provider, userId, ...values })
    .returning({ id: integrationConnections.id });
  if (!created) throw new Error('Insert returned no row');
  return created.id;
}

// ── OAuth (Gmail, Xero) ─────────────────────────────────────────────────

/** Step 1: a provider sign-in URL bound to this user (state + PKCE stored server-side). */
export async function startOAuth(db: Db, int: Integrations, provider: OAuthProvider, user: User) {
  const problem = setupProblem(int, provider);
  if (problem) throw new IntegrationUserError(problem);
  const state = randomToken();
  const { verifier, challenge } = pkce();
  await db.delete(integrationOAuthStates).where(lt(integrationOAuthStates.expiresAt, new Date()));
  await db.insert(integrationOAuthStates).values({
    state,
    provider,
    userId: user.id,
    codeVerifier: verifier,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  return provider === 'gmail' && int.gmail
    ? gmailAuthorizeUrl(int.gmail, { state, codeChallenge: challenge, loginHint: user.email })
    : xeroAuthorizeUrl(int.xero as XeroConfig, { state, codeChallenge: challenge });
}

const resultUrl = (int: Integrations, provider: OAuthProvider, outcome: { error?: string }) => {
  const params = new URLSearchParams({ provider, result: outcome.error ? 'error' : 'connected' });
  if (outcome.error) params.set('message', outcome.error);
  return `${int.appUrl}/settings/integrations?${params.toString()}`;
};

/**
 * Step 2 (the provider redirects the browser here): checks the state, exchanges the code,
 * identifies the account and stores the encrypted tokens. Returns where to send the browser.
 */
export async function completeOAuth(
  db: Db,
  int: Integrations,
  provider: OAuthProvider,
  query: { state?: string; code?: string; error?: string },
  log?: Logger,
): Promise<string> {
  try {
    if (!query.state)
      throw new IntegrationUserError(
        'The sign-in response had no state. Start again from Settings.',
      );
    // Single use: the row is deleted as it is read.
    const [pending] = await db
      .delete(integrationOAuthStates)
      .where(
        and(
          eq(integrationOAuthStates.state, query.state),
          eq(integrationOAuthStates.provider, provider),
        ),
      )
      .returning();
    if (!pending || pending.expiresAt < new Date()) {
      throw new IntegrationUserError(
        'This sign-in link has expired or was already used. Start again from Settings.',
      );
    }
    if (query.error) {
      throw new IntegrationUserError(
        query.error === 'access_denied'
          ? 'The connection was cancelled.'
          : `The provider refused the sign-in (${query.error}).`,
      );
    }
    if (!query.code)
      throw new IntegrationUserError(
        'The sign-in response had no code. Start again from Settings.',
      );
    const problem = setupProblem(int, provider);
    if (problem) throw new IntegrationUserError(problem);
    const key = requireKey(int);
    const [user] = await db
      .select({ id: users.id, email: users.email, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, pending.userId));
    if (!user?.isActive) throw new IntegrationUserError('Your CRM account is no longer active.');
    const actor: Actor = {
      userId: user.id,
      meta: { requestId: `oauth-${provider}`, ipAddress: null, userAgent: null },
    };

    if (provider === 'gmail' && int.gmail) {
      const tokens = await gmailExchangeCode(
        int.fetch,
        int.gmail,
        query.code,
        pending.codeVerifier,
      );
      const profile = await gmailProfile(int.fetch, tokens.accessToken);
      if (profile.emailAddress !== user.email.toLowerCase()) {
        await gmailRevoke(int.fetch, tokens.refreshToken).catch(() => undefined);
        throw new IntegrationUserError(
          `You signed in to Google as ${profile.emailAddress}, but your CRM account is ${user.email}. Connect your own work mailbox.`,
        );
      }
      await db.transaction(async (tx) => {
        await saveConnection(tx, 'gmail', user.id, {
          accountId: profile.emailAddress,
          accountName: profile.emailAddress,
          secrets: encryptJson(key, tokens),
          scopes: tokens.scopes,
          metadata: { messagesTotal: profile.messagesTotal },
          status: 'connected',
          lastError: null,
          lastCheckedAt: new Date(),
          connectedByUserId: user.id,
        });
        await recordAudit(tx, actor, {
          action: 'connect',
          entityType: 'integration',
          entityId: 'gmail',
          after: { account: profile.emailAddress },
        });
      });
      return resultUrl(int, provider, {});
    }

    const xero = int.xero as XeroConfig;
    const tokens = await xeroExchangeCode(int.fetch, xero, query.code, pending.codeVerifier);
    const tenants = tenantsFromThisSignIn(
      tokens.accessToken,
      await xeroConnections(int.fetch, tokens.accessToken),
    );
    if (tenants.length === 0)
      throw new IntegrationUserError(
        'No Xero organisation was chosen. Connect again and pick the business organisation.',
      );
    const chosen = tenants.length === 1 ? tenants[0] : undefined;
    const org = chosen
      ? await xeroOrganisation(int.fetch, tokens.accessToken, chosen.tenantId)
      : null;
    const previous = await loadConnection(db, 'xero', null);
    await db.transaction(async (tx) => {
      await saveConnection(tx, 'xero', null, {
        accountId: chosen?.tenantId ?? null,
        accountName: org?.name ?? chosen?.tenantName ?? null,
        secrets: encryptJson(key, tokens),
        scopes: tokens.scopes,
        metadata: {
          tenants,
          connectionId: chosen?.connectionId ?? null,
          isDemoCompany: org?.isDemoCompany ?? null,
        },
        status: chosen ? 'connected' : 'needs_tenant',
        lastError: null,
        lastCheckedAt: new Date(),
        connectedByUserId: user.id,
      });
      await recordAudit(tx, actor, {
        action: 'connect',
        entityType: 'integration',
        entityId: 'xero',
        after: { organisation: org?.name ?? null, choices: tenants.length },
      });
    });
    // A reconnect replaces the old grant; revoke it so it can't linger (best effort).
    if (previous) {
      const old = decryptJson<OAuthTokens>(key, previous.secrets);
      if (old.refreshToken !== tokens.refreshToken) {
        await xeroRevoke(int.fetch, xero, old.refreshToken).catch(() => undefined);
      }
    }
    return resultUrl(int, provider, {});
  } catch (error) {
    if (error instanceof IntegrationUserError || error instanceof ProviderError) {
      log?.warn({ provider, err: error.message }, 'Integration connect failed');
      return resultUrl(int, provider, { error: error.message });
    }
    log?.error({ err: error, provider }, 'Integration connect failed unexpectedly');
    return resultUrl(int, provider, {
      error: 'Something went wrong while connecting. Please try again.',
    });
  }
}

/**
 * The connection's tokens, refreshed if they're about to expire. The row is locked while
 * refreshing so two requests can't both spend Xero's single-use refresh token.
 */
export async function freshTokens(
  db: Db,
  int: Integrations,
  connectionId: string,
): Promise<OAuthTokens> {
  const key = requireKey(int);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connectionId))
      .for('update');
    if (!row) throw new IntegrationUserError('This integration is no longer connected.');
    const tokens = decryptJson<OAuthTokens>(key, row.secrets);
    if (!needsRefresh(tokens)) return tokens;
    // A refresh failure rolls this back; the caller records the outcome (e.g. "expired").
    const next =
      row.provider === 'gmail'
        ? await gmailRefresh(int.fetch, int.gmail as GmailConfig, tokens.refreshToken)
        : await xeroRefresh(int.fetch, int.xero as XeroConfig, tokens.refreshToken);
    await tx
      .update(integrationConnections)
      .set({
        secrets: encryptJson(key, next),
        status: row.status === 'needs_tenant' ? 'needs_tenant' : 'connected',
        lastError: null,
      })
      .where(eq(integrationConnections.id, row.id));
    return next;
  });
}

async function markResult(
  db: Db,
  connection: Connection | null,
  outcome: {
    status: ConnectionStatus;
    error: string | null;
    extra?: Partial<typeof integrationConnections.$inferInsert>;
  },
) {
  if (!connection) return;
  await db
    .update(integrationConnections)
    .set({
      status: outcome.status,
      lastError: outcome.error,
      lastCheckedAt: new Date(),
      ...outcome.extra,
    })
    .where(eq(integrationConnections.id, connection.id));
}

// ── Test, disconnect ────────────────────────────────────────────────────

export type TestResult = {
  ok: boolean;
  status: ConnectionStatus | 'not_connected';
  message: string;
  account: string | null;
};

async function messageMediaCreds(db: Db | Tx, int: Integrations) {
  const row = await loadConnection(db, 'messagemedia', null);
  if (row) {
    const stored = decryptJson<{ apiKey: string; apiSecret: string }>(requireKey(int), row.secrets);
    const sender =
      typeof row.metadata.defaultSender === 'string' ? row.metadata.defaultSender : null;
    return { row, creds: { ...stored, defaultSender: sender }, source: 'stored' as const };
  }
  return int.messageMediaEnv
    ? { row: null, creds: int.messageMediaEnv, source: 'env' as const }
    : null;
}

/** A real, read-only call that proves the connection works; records the outcome. */
export async function testConnection(
  db: Db,
  int: Integrations,
  provider: IntegrationProvider,
  user: User,
): Promise<TestResult> {
  if (provider === 'messagemedia') {
    if (!int.key.ok && !int.messageMediaEnv)
      return { ok: false, status: 'not_connected', message: int.key.problem, account: null };
    const found = await messageMediaCreds(db, int);
    if (!found) {
      return {
        ok: false,
        status: 'not_connected',
        message:
          'MessageMedia isn’t connected: save the API key and secret, or set MESSAGEMEDIA_API_KEY/SECRET in .env.',
        account: null,
      };
    }
    try {
      const result = await messageMediaCheck(int.fetch, found.creds);
      await markResult(db, found.row, { status: 'connected', error: null });
      return {
        ok: true,
        status: 'connected',
        message: `MessageMedia accepted the credentials${found.source === 'env' ? ' from .env' : ''}. ${String(result.waitingReplies)} unread repl${result.waitingReplies === 1 ? 'y' : 'ies'} waiting.`,
        account: found.creds.defaultSender,
      };
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      await markResult(db, found.row, { status: 'error', error: error.message });
      return {
        ok: false,
        status: 'error',
        message: error.message,
        account: found.creds.defaultSender,
      };
    }
  }

  const problem = setupProblem(int, provider);
  const connection = await loadConnection(db, provider, ownerOf(provider, user));
  if (!connection) {
    return {
      ok: false,
      status: 'not_connected',
      message: problem ?? `${INTEGRATION_INFO[provider].label} isn’t connected yet.`,
      account: null,
    };
  }
  if (problem)
    return { ok: false, status: 'error', message: problem, account: connection.accountName };
  if (provider === 'xero' && connection.status === 'needs_tenant') {
    return {
      ok: false,
      status: 'needs_tenant',
      message: 'Choose which Xero organisation the CRM should use.',
      account: null,
    };
  }
  try {
    const tokens = await freshTokens(db, int, connection.id);
    if (provider === 'gmail') {
      const profile = await gmailProfile(int.fetch, tokens.accessToken);
      await markResult(db, connection, {
        status: 'connected',
        error: null,
        extra: { metadata: { ...connection.metadata, messagesTotal: profile.messagesTotal } },
      });
      return {
        ok: true,
        status: 'connected',
        message: `Gmail is working for ${profile.emailAddress} (${profile.messagesTotal.toLocaleString('en-AU')} messages).`,
        account: profile.emailAddress,
      };
    }
    const org = await xeroOrganisation(int.fetch, tokens.accessToken, connection.accountId ?? '');
    await markResult(db, connection, {
      status: 'connected',
      error: null,
      extra: {
        accountName: org.name,
        metadata: { ...connection.metadata, isDemoCompany: org.isDemoCompany },
      },
    });
    return {
      ok: true,
      status: 'connected',
      message: `Xero is working for ${org.name}${org.isDemoCompany ? ' (demo company)' : ''}.`,
      account: org.name,
    };
  } catch (error) {
    if (!(error instanceof ProviderError || error instanceof IntegrationUserError)) throw error;
    const status: ConnectionStatus =
      error instanceof ProviderError && error.kind === 'revoked' ? 'expired' : 'error';
    await markResult(db, connection, { status, error: error.message });
    return { ok: false, status, message: error.message, account: connection.accountName };
  }
}

/** Revokes access at the provider (best effort, reported) and deletes the stored secrets. */
export async function disconnect(
  db: Db,
  int: Integrations,
  provider: IntegrationProvider,
  user: User,
  actor: Actor,
) {
  const connection = await loadConnection(db, provider, ownerOf(provider, user));
  if (!connection) return { disconnected: false, warning: null };
  let warning: string | null = null;
  if (provider !== 'messagemedia' && int.key.ok) {
    try {
      const tokens = decryptJson<OAuthTokens>(int.key.key, connection.secrets);
      if (provider === 'gmail') {
        await gmailRevoke(int.fetch, tokens.refreshToken);
      } else if (int.xero) {
        const connectionId =
          typeof connection.metadata.connectionId === 'string'
            ? connection.metadata.connectionId
            : null;
        if (connectionId && !needsRefresh(tokens))
          await xeroDeleteConnection(int.fetch, tokens.accessToken, connectionId);
        await xeroRevoke(int.fetch, int.xero, tokens.refreshToken);
      }
    } catch (error) {
      warning = `Removed from the CRM, but ${INTEGRATION_INFO[provider].label} couldn't be told to revoke access (${error instanceof Error ? error.message : 'unknown error'}). Remove the app's access in ${provider === 'gmail' ? 'your Google account' : 'Xero → Settings → Connected apps'}.`;
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(integrationConnections).where(eq(integrationConnections.id, connection.id));
    await recordAudit(tx, actor, {
      action: 'disconnect',
      entityType: 'integration',
      entityId: provider,
      before: { account: connection.accountName },
    });
  });
  return { disconnected: true, warning };
}

// ── MessageMedia credentials, Xero organisation choice ──────────────────

export async function saveMessageMedia(
  db: Db,
  int: Integrations,
  creds: MessageMediaCreds,
  actor: Actor,
) {
  const key = requireKey(int);
  // Never store credentials that don't work.
  await messageMediaCheck(int.fetch, creds);
  await db.transaction(async (tx) => {
    await saveConnection(tx, 'messagemedia', null, {
      accountId: `${creds.apiKey.slice(0, 4)}…`,
      accountName: creds.defaultSender ?? 'MessageMedia account',
      secrets: encryptJson(key, { apiKey: creds.apiKey, apiSecret: creds.apiSecret }),
      scopes: [],
      metadata: { defaultSender: creds.defaultSender },
      status: 'connected',
      lastError: null,
      lastCheckedAt: new Date(),
      connectedByUserId: actor.userId,
    });
    await recordAudit(tx, actor, {
      action: 'connect',
      entityType: 'integration',
      entityId: 'messagemedia',
      after: { key: `${creds.apiKey.slice(0, 4)}…`, defaultSender: creds.defaultSender },
    });
  });
}

export async function selectXeroTenant(db: Db, int: Integrations, tenantId: string, actor: Actor) {
  const connection = await loadConnection(db, 'xero', null);
  const tenants = (connection?.metadata.tenants ?? []) as XeroTenant[];
  const tenant = tenants.find((t) => t.tenantId === tenantId);
  if (!connection || !tenant)
    throw new IntegrationUserError(
      'That organisation isn’t one of the ones Xero offered. Connect again.',
    );
  const tokens = await freshTokens(db, int, connection.id);
  const org = await xeroOrganisation(int.fetch, tokens.accessToken, tenant.tenantId);
  await db.transaction(async (tx) => {
    await tx
      .update(integrationConnections)
      .set({
        accountId: tenant.tenantId,
        accountName: org.name,
        status: 'connected',
        lastError: null,
        lastCheckedAt: new Date(),
        metadata: {
          ...connection.metadata,
          connectionId: tenant.connectionId,
          isDemoCompany: org.isDemoCompany,
        },
      })
      .where(eq(integrationConnections.id, connection.id));
    await recordAudit(tx, actor, {
      action: 'select_tenant',
      entityType: 'integration',
      entityId: 'xero',
      after: { organisation: org.name },
    });
  });
  return { organisation: org.name };
}

// ── Status ──────────────────────────────────────────────────────────────

const view = (row: Connection | null) =>
  row && {
    status: row.status as ConnectionStatus,
    account: row.accountName,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError,
    connectedAt: row.createdAt.toISOString(),
  };

/** What each provider looks like for this user. Never includes secrets. */
export async function integrationStatus(
  db: Db,
  int: Integrations,
  user: User,
  canViewOrganisation: boolean,
) {
  const result = [];
  for (const provider of INTEGRATION_PROVIDERS) {
    const info = INTEGRATION_INFO[provider];
    if (info.owner === 'organisation' && !canViewOrganisation) continue;
    const row = await loadConnection(db, provider, ownerOf(provider, user));
    const mm =
      provider === 'messagemedia' ? (row ? 'stored' : int.messageMediaEnv ? 'env' : null) : null;
    result.push({
      provider,
      label: info.label,
      owner: info.owner,
      purpose: info.purpose,
      problem:
        provider === 'messagemedia'
          ? int.key.ok || int.messageMediaEnv
            ? null
            : int.key.problem
          : setupProblem(int, provider),
      connection: view(row),
      /** MessageMedia only: credentials saved in the CRM, or taken from .env. */
      credentialsFrom: mm,
      xeroChoices:
        provider === 'xero' && row?.status === 'needs_tenant'
          ? ((row.metadata.tenants ?? []) as XeroTenant[]).map((t) => ({
              tenantId: t.tenantId,
              name: t.tenantName,
            }))
          : [],
    });
  }
  const mailboxes = canViewOrganisation
    ? await db
        .select({
          user: users.name,
          account: integrationConnections.accountName,
          status: integrationConnections.status,
        })
        .from(integrationConnections)
        .innerJoin(users, eq(users.id, integrationConnections.userId))
        .where(eq(integrationConnections.provider, 'gmail'))
        .orderBy(sql`lower(${users.name})`)
    : [];
  return { providers: result, mailboxes };
}
