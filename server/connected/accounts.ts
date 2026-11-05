import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import path from 'node:path';
import type { Store } from '../db';
import type { AccountConfig, AccountProvider, AccountView } from '../../shared/connected';
import { CredentialVault, type Secrets } from './vault';
export type Http = typeof fetch;
export const regions: Record<string, { accounts: string; projects: string }> = {
  com: { accounts: 'https://accounts.zoho.com', projects: 'https://projects.zoho.com' },
  eu: { accounts: 'https://accounts.zoho.eu', projects: 'https://projects.zoho.eu' },
  in: { accounts: 'https://accounts.zoho.in', projects: 'https://projects.zoho.in' },
  'com.au': { accounts: 'https://accounts.zoho.com.au', projects: 'https://projects.zoho.com.au' },
  jp: { accounts: 'https://accounts.zoho.jp', projects: 'https://projects.zoho.jp' },
  ca: { accounts: 'https://accounts.zohocloud.ca', projects: 'https://projects.zohocloud.ca' },
};
export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  account: string;
  label: string;
}
export const scopes = {
  outlook: [
    'offline_access',
    'https://graph.microsoft.com/User.Read',
    'https://graph.microsoft.com/Mail.Read',
  ],
  zoho: [
    'ZohoProjects.portals.READ',
    'ZohoProjects.projects.READ',
    'ZohoProjects.tasklists.READ',
    'ZohoProjects.tasks.READ',
    'ZohoProjects.bugs.READ',
    'ZohoProjects.users.READ',
    'ZohoProjects.timesheets.READ',
    'ZohoProjects.timesheets.CREATE',
  ],
};
export class ProviderError extends Error {
  constructor(
    public status: number,
    public requestId = '',
    public uncertain = false,
  ) {
    super(
      'Provider request failed (' +
        status +
        '). Check account consent, permissions and connection status.',
    );
  }
}
export class Accounts {
  private sessions = new Map<
    string,
    { provider: AccountProvider; verifier: string; config: AccountConfig; expiresAt: number }
  >();
  private refreshes = new Map<AccountProvider, Promise<Tokens>>();
  private locks = new Map<AccountProvider, Promise<unknown>>();
  private exclusive<T>(provider: AccountProvider, task: () => Promise<T>) {
    const next = (this.locks.get(provider) || Promise.resolve()).catch(() => undefined).then(task);
    this.locks.set(provider, next);
    return next;
  }
  constructor(
    public store: Store,
    public secrets: Secrets = new CredentialVault(path.resolve(store.file + '.credentials')),
    public http: Http = fetch,
  ) {}
  config(provider: AccountProvider): AccountConfig {
    return (
      this.store.get('account_config', provider) || {
        provider,
        clientId: '',
        tenant: 'common',
        region: 'com',
        version: 0,
      }
    );
  }
  callback(provider: AccountProvider) {
    return (
      'http://127.0.0.1:' + (process.env.PORT || '3001') + '/api/accounts/' + provider + '/callback'
    );
  }
  async view(provider: AccountProvider): Promise<AccountView> {
    const config = this.config(provider),
      tokens = await this.secrets.get<Tokens>(provider + ':tokens');
    return {
      ...config,
      configured: !!config.clientId,
      connected: !!tokens,
      account: tokens?.label,
      expiresAt: tokens?.expiresAt,
      scopes: tokens?.scopes || [],
      hasClientSecret: !!(await this.secrets.get(provider + ':client-secret')),
      callbackUrl: this.callback(provider),
    };
  }
  async configure(provider: AccountProvider, raw: unknown) {
    return this.exclusive(provider, () => this.configureNow(provider, raw));
  }
  private async configureNow(provider: AccountProvider, raw: unknown) {
    const input = z
      .object({
        clientId: z.string().trim().min(1).max(200),
        tenant: z
          .string()
          .regex(/^[a-zA-Z0-9.-]+$/)
          .default('common'),
        region: z.enum(['com', 'eu', 'in', 'com.au', 'jp', 'ca']).default('com'),
        clientSecret: z.string().max(4000).optional(),
        version: z.number().int().min(0),
      })
      .strict()
      .parse(raw);
    const current = this.config(provider);
    if (input.version !== current.version)
      throw new Error('Connection settings changed. Reload before saving.');
    if (
      provider === 'zoho' &&
      !input.clientSecret &&
      !(await this.secrets.get('zoho:client-secret'))
    )
      throw new Error('Enter the Zoho client secret in this form.');
    // Prove the vault works before persisting usable account settings.
    if (input.clientSecret) await this.secrets.set(provider + ':client-secret', input.clientSecret);
    await this.secrets.remove(provider + ':tokens');
    this.store.remove('connected_account', provider);
    const config: AccountConfig = {
      provider,
      clientId: input.clientId,
      tenant: input.tenant,
      region: input.region,
      version: current.version + 1,
    };
    this.store.put('account_config', provider, config);
    return this.view(provider);
  }
  async disconnect(provider: AccountProvider) {
    return this.exclusive(provider, async () => {
      const config = this.config(provider);
      this.store.put('account_config', provider, { ...config, version: config.version + 1 });
      await this.secrets.remove(provider + ':tokens');
      this.store.remove('connected_account', provider);
      return this.view(provider);
    });
  }
  begin(provider: AccountProvider) {
    for (const [id, session] of this.sessions)
      if (session.expiresAt < Date.now()) this.sessions.delete(id);
    const config = this.config(provider);
    if (!config.clientId) throw new Error('Complete the guided client setup first.');
    const state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(32).toString('base64url');
    this.sessions.set(state, { provider, verifier, config, expiresAt: Date.now() + 600000 });
    const base =
      provider === 'outlook'
        ? 'https://login.microsoftonline.com/' + config.tenant + '/oauth2/v2.0/authorize'
        : regions[config.region].accounts + '/oauth/v2/auth';
    const url = new URL(base);
    const values = {
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: this.callback(provider),
      state,
      scope: scopes[provider].join(provider === 'zoho' ? ',' : ' '),
      ...(provider === 'outlook'
        ? {
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256',
          }
        : { access_type: 'offline', prompt: 'consent' }),
    };
    Object.entries(values).forEach(([k, v]) => url.searchParams.set(k, v));
    return { url: url.toString(), state };
  }
  private tokenUrl(provider: AccountProvider, config = this.config(provider)) {
    return provider === 'outlook'
      ? 'https://login.microsoftonline.com/' + config.tenant + '/oauth2/v2.0/token'
      : regions[config.region].accounts + '/oauth/v2/token';
  }
  private async exchange(provider: AccountProvider, fields: Record<string, string>) {
    const config = this.config(provider),
      secret = await this.secrets.get<string>(provider + ':client-secret');
    const response = await this.http(this.tokenUrl(provider), {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        ...(secret ? { client_secret: secret } : {}),
        ...fields,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        'Account authorization failed. Verify the registered redirect URL, client settings and organizational consent.',
      );
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.access_token !== 'string' || !data.access_token)
      throw new Error('Provider did not return an access token.');
    return data;
  }
  async finish(provider: AccountProvider, code: string, state: string, cookieState: string) {
    return this.exclusive(provider, () => this.finishNow(provider, code, state, cookieState));
  }
  private async finishNow(
    provider: AccountProvider,
    code: string,
    state: string,
    cookieState: string,
  ) {
    const session = this.sessions.get(state);
    this.sessions.delete(state);
    if (
      !session ||
      session.provider !== provider ||
      state !== cookieState ||
      session.expiresAt < Date.now() ||
      session.config.version !== this.config(provider).version
    )
      throw new Error(
        'Sign-in session expired or did not match this browser. Start sign-in again.',
      );
    const data = await this.exchange(provider, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.callback(provider),
      ...(provider === 'outlook' ? { code_verifier: session.verifier } : {}),
    });
    const accessToken = data.access_token as string;
    let account: string, label: string;
    if (provider === 'outlook') {
      const response = await this.http(
        'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName',
        {
          redirect: 'error',
          headers: { Authorization: 'Bearer ' + accessToken },
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok) throw new ProviderError(response.status);
      const me = (await response.json()) as Record<string, string>;
      if (!me.id) throw new Error('Microsoft account identity was missing.');
      account = me.id;
      label = me.mail || me.userPrincipalName || me.id;
    } else {
      // Stable configured client + refresh token identifies this consent; no email address is guessed.
      account = createHash('sha256')
        .update(String(data.refresh_token || accessToken))
        .digest('hex');
      label = 'Zoho authorized account (' + this.config(provider).region + ')';
    }
    const tokens: Tokens = {
      accessToken,
      refreshToken: String(data.refresh_token || ''),
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
      account,
      label,
      scopes: typeof data.scope === 'string' ? data.scope.split(/[ ,]+/) : scopes[provider],
    };
    await this.secrets.set(provider + ':tokens', tokens);
    this.store.put('connected_account', provider, { account, label });
    return this.view(provider);
  }
  async tokens(provider: AccountProvider): Promise<Tokens> {
    const saved = await this.secrets.get<Tokens>(provider + ':tokens');
    if (!saved) throw new Error('Connect ' + provider + ' in Connected applications first.');
    if (saved.expiresAt > Date.now() + 60000) return saved;
    if (!saved.refreshToken) throw new Error('Sign in again to renew this account connection.');
    let refreshing = this.refreshes.get(provider);
    if (!refreshing) {
      refreshing = this.exclusive(provider, async () => {
        const current = await this.secrets.get<Tokens>(provider + ':tokens');
        if (!current || current.account !== saved.account)
          throw new Error('Account changed during token renewal.');
        if (current.expiresAt > Date.now() + 60000) return current;
        const data = await this.exchange(provider, {
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken,
        });
        const tokens = {
          ...current,
          accessToken: String(data.access_token),
          refreshToken: String(data.refresh_token || current.refreshToken),
          expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
        };
        await this.secrets.set(provider + ':tokens', tokens);
        return tokens;
      });
      this.refreshes.set(provider, refreshing);
      void refreshing.finally(() => this.refreshes.delete(provider)).catch(() => undefined);
    }
    return refreshing;
  }
  async request(
    provider: AccountProvider,
    endpoint: string,
    options: RequestInit = {},
    expectedAccount?: string,
  ) {
    if (provider === 'outlook' && options.method && options.method.toUpperCase() !== 'GET')
      throw new Error('Outlook is read-only. Copy your reviewed draft and send it manually.');
    const tokens = await this.tokens(provider);
    if (expectedAccount && tokens.account !== expectedAccount) throw new ProviderError(409);
    const base =
      provider === 'outlook'
        ? 'https://graph.microsoft.com'
        : regions[this.config(provider).region].projects;
    const url = new URL(endpoint, base);
    if (
      url.origin !== base ||
      (provider === 'outlook'
        ? !url.pathname.startsWith('/v1.0/me')
        : !/^\/api\/v3(?:\.1)?\//.test(url.pathname))
    )
      throw new Error('Provider URL is outside the approved API.');
    let response: Response;
    try {
      response = await this.http(url, {
        ...options,
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + tokens.accessToken,
          'Content-Type': 'application/json',
          ...(provider === 'outlook'
            ? { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' }
            : {}),
          ...options.headers,
        },
        signal: options.signal || AbortSignal.timeout(30000),
      });
    } catch {
      throw new ProviderError(0, '', !!options.method && options.method !== 'GET');
    }
    if (!response.ok)
      throw new ProviderError(
        response.status,
        response.headers.get('request-id') || '',
        response.status >= 500,
      );
    return response;
  }
}
