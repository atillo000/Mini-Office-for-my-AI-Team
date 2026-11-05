import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { Store } from '../server/db';
import { Accounts, type Http, type Tokens } from '../server/connected/accounts';
import { CredentialVault, MemorySecrets } from '../server/connected/vault';
import { MailService } from '../server/connected/mail';
import { ZohoService } from '../server/connected/zoho';
import { ActionService, timeInput, validateTime } from '../server/connected/actions';
import { notifications } from '../server/team/notifications';
import { createApp } from '../server/app';
import { CodexAdapter } from '../server/agents/codex';
import { Artifacts } from '../server/agents/artifacts';
import type { ExternalDraft, MailItem } from '../shared/connected';
import type { Job } from '../shared/types';
const stores: Store[] = [],
  apps: FastifyInstance[] = [],
  mailServices: MailService[] = [];
afterEach(async () => {
  await Promise.all(mailServices.splice(0).map((m) => m.close()));
  await Promise.all(apps.splice(0).map((a) => a.close()));
  stores.splice(0).forEach((s) => s.close());
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const token = (account: string): Tokens => ({
  accessToken: 'private-fixture-access',
  refreshToken: 'private-fixture-refresh',
  account,
  label: account,
  expiresAt: Date.now() + 3600000,
  scopes: [],
});
async function fixture(handler: (url: URL, init?: RequestInit) => Promise<Response> | Response) {
  const store = new Store(':memory:');
  stores.push(store);
  const secrets = new MemorySecrets();
  await secrets.set('outlook:tokens', token('outlook-fixture'));
  await secrets.set('zoho:tokens', token('zoho-fixture'));
  store.put('connected_account', 'outlook', { account: 'outlook-fixture' });
  const calls: { url: URL; init?: RequestInit }[] = [];
  const http = (async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as Http;
  const accounts = new Accounts(store, secrets, http),
    zoho = new ZohoService(store, accounts);
  return {
    store,
    secrets,
    calls,
    accounts,
    zoho,
    actions: new ActionService(store, accounts, zoho, () => {}),
  };
}
const mailItem: MailItem = {
  id: 'local-mail',
  account: 'outlook-fixture',
  providerId: 'immutable-id',
  changeKey: 'version-1',
  subject: '20260109 review',
  body: 'Please review this project.',
  from: 'sender@example.invalid',
  replyTo: ['reply@example.invalid'],
  receivedAt: '2026-11-03T08:00:00Z',
  isRead: false,
  webLink: '',
  removed: false,
  projectIds: [],
  projectNumbers: ['20260109'],
  routing: 'PROJECT',
  reason: 'Project number matched',
  version: 1,
};
const input = {
  portalId: '100',
  projectId: '200',
  category: 'PROJECT' as const,
  projectNumber: '20260109',
  proposalStage: false,
  module: 'task' as const,
  taskId: '300',
  ownerId: '400',
  date: '2026-11-03',
  durationMinutes: 90,
  billing: 'Non Billable' as const,
  description: 'Investigated replacement utility',
  workConfirmed: true as const,
};
function zohoHandler(url: URL) {
  const wrap = (key: string, values: unknown[]) =>
    json({ [key]: values, page_info: { has_next_page: false } });
  if (url.pathname.endsWith('/projects'))
    return wrap('projects', [{ id: '200', name: '20260109 Rio Tinto AUS' }]);
  if (url.pathname.endsWith('/users'))
    return wrap('users', [{ id: '400', full_name: 'Fixture user', zuid: '800' }]);
  if (url.pathname.endsWith('/tasks'))
    return wrap('tasks', [{ id: '300', name: 'Investigation / research' }]);
  if (url.pathname.endsWith('/settings/timelog'))
    return json({ period_settings: { future_log: 'not_allow' }, overlap_restriction: 'restrict' });
  if (url.pathname.endsWith('/timelogs'))
    return json({ time_logs: [], page_info: { has_next_page: false } });
  return undefined;
}
describe('Account consent and encrypted credentials', () => {
  it('encrypts credentials with authenticated encryption instead of saving plaintext', async () => {
    const previous = process.env.OFFICE_VAULT_KEY;
    process.env.OFFICE_VAULT_KEY = Buffer.alloc(32, 8).toString('base64');
    try {
      const root = mkdtempSync(path.join(os.tmpdir(), 'office-vault-')),
        vault = new CredentialVault(root);
      await vault.set('outlook:tokens', { secret: 'never-write-this-in-plaintext' });
      expect(readFileSync(path.join(root, 'secrets.json'), 'utf8')).not.toContain('never-write');
      expect(await new CredentialVault(root).get('outlook:tokens')).toEqual({
        secret: 'never-write-this-in-plaintext',
      });
      await vault.remove('outlook:tokens');
      expect(await vault.get('outlook:tokens')).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.OFFICE_VAULT_KEY;
      else process.env.OFFICE_VAULT_KEY = previous;
    }
  });
  it('binds PKCE sign-in to the browser and rejects reuse or missing consent state', async () => {
    const { accounts, calls, secrets, store } = await fixture((url) =>
      url.pathname.endsWith('/token')
        ? json({
            access_token: 'oauth-only-access',
            refresh_token: 'oauth-only-refresh',
            expires_in: 3600,
            scope: 'User.Read Mail.Read Mail.Send',
          })
        : json({ id: 'verified-me', mail: 'fixture@example.invalid' }),
    );
    await accounts.configure('outlook', { clientId: 'public-client-id', version: 0 });
    const first = accounts.begin('outlook');
    expect(new URL(first.url).searchParams.get('code_challenge_method')).toBe('S256');
    await expect(accounts.finish('outlook', 'code', first.state, 'wrong-browser')).rejects.toThrow(
      'session',
    );
    expect(calls).toHaveLength(0);
    const next = accounts.begin('outlook');
    const connected = await accounts.finish('outlook', 'code', next.state, next.state);
    expect(connected).toMatchObject({ connected: true, account: 'fixture@example.invalid' });
    await expect(accounts.finish('outlook', 'code', next.state, next.state)).rejects.toThrow(
      'session',
    );
    expect(await secrets.get<Tokens>('outlook:tokens')).toMatchObject({ account: 'verified-me' });
    expect(JSON.stringify(store.list('account_config'))).not.toContain('oauth-only');
    await accounts.disconnect('outlook');
    expect((await accounts.view('outlook')).connected).toBe(false);
  });
  it('rejects off-provider pagination URLs and account changes before sending any credential', async () => {
    const { accounts, calls } = await fixture(() => json({}));
    await expect(accounts.request('outlook', 'https://attacker.invalid/collect')).rejects.toThrow(
      'outside',
    );
    await expect(
      accounts.request(
        'zoho',
        '/api/v3/portal/100/projects',
        { method: 'POST' },
        'different-account',
      ),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('serializes refreshes so a rotated token is not lost', async () => {
    const { accounts, secrets, calls } = await fixture(() =>
      json({ access_token: 'renewed-access', refresh_token: 'renewed-refresh', expires_in: 3600 }),
    );
    await secrets.set('outlook:tokens', { ...token('outlook-fixture'), expiresAt: 0 });
    await Promise.all([
      accounts.tokens('outlook'),
      accounts.tokens('outlook'),
      accounts.tokens('outlook'),
    ]);
    expect(calls).toHaveLength(1);
    expect(await secrets.get<Tokens>('outlook:tokens')).toMatchObject({
      refreshToken: 'renewed-refresh',
    });
  });
});
describe('Actual inbox ingestion', () => {
  it('preserves message content on partial delta updates and removes deleted inbox entries', async () => {
    let page = 0;
    const { accounts, store } = await fixture(() => {
      const values = [
        [
          {
            id: 'one',
            changeKey: 'initial',
            subject: '20260109 update',
            body: { content: 'Keep this original body' },
            from: { emailAddress: { address: 'client@example.invalid' } },
            receivedDateTime: '2026-11-03T08:00:00Z',
          },
        ],
        [{ id: 'one', changeKey: 'changed', isRead: true }],
        [{ id: 'one', '@removed': { reason: 'deleted' } }],
      ];
      return json({
        value: values[page++] || [],
        '@odata.deltaLink':
          'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?token=' + page,
      });
    });
    const mail = new MailService(store, accounts, () => {});
    mailServices.push(mail);
    const sync = async () => {
      await mail.start();
      while (mail.state()?.state === 'RUNNING') await new Promise((r) => setTimeout(r, 2));
    };
    await sync();
    const id = (await mail.items())[0].id;
    await sync();
    expect(await mail.item(id)).toMatchObject({
      subject: '20260109 update',
      body: 'Keep this original body',
      isRead: true,
      changeKey: 'changed',
    });
    await sync();
    expect(await mail.items()).toHaveLength(0);
  });
  it('follows every page, stores real message IDs and a delta cursor, and searches body without returning all bodies', async () => {
    const { accounts, store, calls } = await fixture((url) =>
      url.searchParams.get('page') === '2'
        ? json({
            value: [
              {
                id: 'two',
                changeKey: 'b',
                subject: 'Prototype proposal 20260109',
                body: { content: 'A proposal, not approved work' },
                receivedDateTime: '2026-11-03T09:00:00Z',
              },
            ],
            '@odata.deltaLink':
              'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?token=checkpoint',
          })
        : json({
            value: [
              {
                id: 'one',
                changeKey: 'a',
                subject: 'Project update',
                body: { content: 'Discuss 20260109 and needle-body' },
                from: { emailAddress: { address: 'client@example.invalid' } },
                receivedDateTime: '2026-11-03T08:00:00Z',
              },
            ],
            '@odata.nextLink':
              'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?page=2',
          }),
    );
    const mail = new MailService(store, accounts, () => {});
    mailServices.push(mail);
    await mail.start();
    while (mail.state()?.state === 'RUNNING') await new Promise((r) => setTimeout(r, 2));
    expect(calls).toHaveLength(2);
    expect(mail.state()).toMatchObject({ complete: true, state: 'IDLE', processed: 2 });
    const items = await mail.items();
    expect(items).toHaveLength(2);
    expect(items[0].routing).toBe('BUSINESS_DEVELOPMENT');
    expect(items[1].routing).toBe('PROJECT');
    expect(items[1].body).toBe('');
    expect((await mail.item(items[1].id)).body).toContain('needle-body');
    expect(await mail.items(50, 0, 'needle-body')).toHaveLength(1);
    expect(store.list('work_records')).toHaveLength(0);
  });
  it('saves a resumable cursor on failure and never reports an incomplete inbox as complete', async () => {
    let fail = true;
    const { accounts, store } = await fixture((url) => {
      if (!url.searchParams.has('page'))
        return json({
          value: [],
          '@odata.nextLink':
            'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?page=2',
        });
      if (fail) throw new Error('Network failure');
      return json({
        value: [],
        '@odata.deltaLink':
          'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?token=done',
      });
    });
    const mail = new MailService(store, accounts, () => {});
    mailServices.push(mail);
    await mail.start();
    while (mail.state()?.state === 'RUNNING') await new Promise((r) => setTimeout(r, 2));
    expect(mail.state()).toMatchObject({ state: 'FAILED', complete: false });
    expect(mail.state()!.cursor).toContain('page=2');
    fail = false;
    await mail.start();
    while (mail.state()?.state === 'RUNNING') await new Promise((r) => setTimeout(r, 2));
    expect(mail.state()).toMatchObject({ state: 'IDLE', complete: true });
  });
});
describe('Exact email and time-log approvals', () => {
  it('keeps replies local and blocks sending even with an old write-capable account grant', async () => {
    const { store, actions, calls } = await fixture((_url, init) => {
      if (init?.method === 'POST')
        return new Response(null, { status: 202, headers: { 'request-id': 'send-receipt' } });
      return json({
        changeKey: 'version-1',
        from: { emailAddress: { address: mailItem.from } },
        replyTo: [{ emailAddress: { address: mailItem.replyTo[0] } }],
        subject: mailItem.subject,
      });
    });
    store.put('mail_items', mailItem.id, mailItem);
    const draft = await actions.reply(mailItem.id, 'I will review this.');
    await expect(
      actions.approve(draft.id, { version: draft.version, scopeHash: '0'.repeat(64) }),
    ).rejects.toThrow('sending is disabled');
    const approval = { version: draft.version, scopeHash: draft.scopeHash };
    const results = await Promise.allSettled([
      actions.approve(draft.id, approval),
      actions.approve(draft.id, approval),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(0);
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
    expect(store.get<ExternalDraft>('external_drafts', draft.id)).toMatchObject({
      state: 'DRAFT',
    });
    expect((draft.payload as { to: string }).to).toBe('reply@example.invalid');
  });
  it('invalidates prior review after edits and never accepts changed recipients', async () => {
    const { store, actions } = await fixture(() =>
      json({
        changeKey: 'changed',
        subject: mailItem.subject,
        from: { emailAddress: { address: 'different@example.invalid' } },
      }),
    );
    store.put('mail_items', mailItem.id, mailItem);
    const first = await actions.reply(mailItem.id, 'Initial reply');
    const edited = await actions.reply(mailItem.id, 'Revised reply', first);
    await expect(
      actions.approve(first.id, { version: first.version, scopeHash: first.scopeHash }),
    ).rejects.toThrow('sending is disabled');
    await expect(
      actions.approve(edited.id, { version: edited.version, scopeHash: edited.scopeHash }),
    ).rejects.toThrow('sending is disabled');
    expect(edited.approval).toBeUndefined();
  });
  it('uses live IDs and v3 module payload and verifies the resulting time log', async () => {
    const { actions, calls } = await fixture((url, init) => {
      const discovery = zohoHandler(url);
      if (discovery) return discovery;
      if (init?.method === 'POST') return json({ id: '500' }, 201);
      if (url.pathname.endsWith('/logs/500'))
        return json({
          id: '500',
          project: { id: '200' },
          owner: { zpuid: '400' },
          date: input.date,
          log_hour: '01:30',
          billing_status: input.billing,
          type: 'task',
          module_detail: { id: '300' },
          notes: input.description,
        });
      throw new Error('Unexpected fixture endpoint');
    });
    const draft = await actions.time(input);
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
    const result = await actions.approve(draft.id, {
      version: draft.version,
      scopeHash: draft.scopeHash,
    });
    expect(result.state).toBe('SUBMITTED');
    expect(result.receipt?.verifiedAt).toBeTypeOf('number');
    const body = JSON.parse(String(calls.find((c) => c.init?.method === 'POST')!.init!.body));
    expect(body).toMatchObject({
      module: { type: 'task', id: '300' },
      owner_zpuid: '400',
      hours: '01:30',
      bill_status: 'Non Billable',
    });
    expect(body).not.toHaveProperty('task_id');
    expect(body).not.toHaveProperty('daily_log');
  });
  it('keeps an accepted write with failed readback unknown and blocks duplicate retries', async () => {
    let writes = 0;
    const { store, actions } = await fixture((url, init) => {
      const discovery = zohoHandler(url);
      if (discovery) return discovery;
      if (init?.method === 'POST') {
        writes++;
        return json({ id: '500' });
      }
      return json({ error: 'No read access' }, 403);
    });
    const draft = await actions.time(input);
    const result = await actions.approve(draft.id, {
      version: draft.version,
      scopeHash: draft.scopeHash,
    });
    expect(result.state).toBe('UNKNOWN_OUTCOME');
    const duplicate = await actions.time(input);
    await expect(
      actions.approve(duplicate.id, { version: duplicate.version, scopeHash: duplicate.scopeHash }),
    ).rejects.toThrow('identical submission');
    expect(writes).toBe(1);
    new ActionService(store, actions.accounts, actions.zoho, () => {});
    expect(store.get<ExternalDraft>('external_drafts', draft.id)?.state).toBe('UNKNOWN_OUTCOME');
  });
  it.each([
    [{ ...input, proposalStage: true }, '20260109 Rio Tinto AUS', 'Proposal-stage'],
    [{ ...input, category: 'GENERAL' }, '20260109 Rio Tinto AUS', 'category'],
    [{ ...input, date: '2999-01-01' }, '20260109 Rio Tinto AUS', 'Future'],
    [{ ...input, date: '2026-02-30' }, '20260109 Rio Tinto AUS', 'real work date'],
    [{ ...input, startTime: '08:00', endTime: '09:00' }, '20260109 Rio Tinto AUS', 'duration'],
  ])('rejects invalid work routing and invented/future time', (data, name, message) => {
    expect(() => validateTime(timeInput.parse(data), String(name))).toThrow(String(message));
  });
  it('accepts the explicitly confirmed General and proposal buckets without guessing user or task IDs', () => {
    expect(() =>
      validateTime(
        timeInput.parse({ ...input, category: 'GENERAL', module: 'general', taskId: undefined }),
        'SIN_TecSurge_General',
      ),
    ).not.toThrow();
    expect(() =>
      validateTime(
        timeInput.parse({ ...input, category: 'BUSINESS_DEVELOPMENT', proposalStage: true }),
        'SIN_TecSurge_BusinessDevelopment',
      ),
    ).not.toThrow();
  });
  it('counts the whole day of local uncertain submissions before accepting more hours', async () => {
    const { actions, store } = await fixture((url) => zohoHandler(url) || json({}));
    const draft = await actions.time({ ...input, durationMinutes: 60 });
    for (let i = 0; i < 3; i++)
      store.put('external_drafts', 'older-' + i, {
        ...draft,
        id: 'older-' + i,
        scopeHash: 'older-' + i,
        payload: { ...draft.payload, durationMinutes: 480 },
        state: 'UNKNOWN_OUTCOME',
      });
    await expect(
      actions.approve(draft.id, { version: draft.version, scopeHash: draft.scopeHash }),
    ).rejects.toThrow('hours available');
  });
});
describe('Notifications and API boundaries', () => {
  it('aggregates real pending work and excludes simulated historical replies; read markers cannot approve work', async () => {
    const { store, accounts } = await fixture(() => json({}));
    store.put('mail_items', mailItem.id, mailItem);
    store.put('messages', 'old', {
      id: 'old',
      sender: 'alex',
      channel: 'alex',
      mode: 'simulation',
      text: 'Old demo',
      at: 1,
    });
    const app = await createApp(store, { skipExternal: true, token: 'test-ceo', accounts });
    stores.splice(stores.indexOf(store), 1);
    apps.push(app);
    expect((await app.inject('/api/notifications')).statusCode).toBe(401);
    const headers = { authorization: 'Bearer test-ceo' };
    const items = (await app.inject({ url: '/api/notifications', headers })).json().items;
    expect(items.map((n: { category: string }) => n.category)).toEqual(['EMAIL']);
    await app.inject({
      method: 'POST',
      url: '/api/notifications/' + encodeURIComponent(items[0].id) + '/read',
      headers,
      payload: { revision: items[0].revision },
    });
    expect(notifications(store)[0].read).toBe(true);
    expect(store.list('external_drafts')).toHaveLength(0);
    expect(
      (
        await app.inject({
          url: '/api/accounts/outlook/callback?code=x&state=untrusted-state-at-least-20-characters',
        })
      ).statusCode,
    ).toBe(400);
  });
  it('produces a real runner-backed chat record with a completed-turn receipt', async () => {
    const { store, accounts } = await fixture(() => json({}));
    class ChatFixture extends CodexAdapter {
      constructor() {
        super(
          undefined,
          '/unused',
          new Artifacts(mkdtempSync(path.join(os.tmpdir(), 'office-chat-'))),
        );
      }
      async health() {
        return {
          available: true,
          executionReady: true,
          version: 'Test-only adapter',
          detail: 'fixture',
        };
      }
      async execute(_workspace: string, prompt: string) {
        expect(prompt).toContain('read-only');
        return {
          text: 'Fixture real-runner response',
          threadId: 'test-fixture',
          completed: true as const,
          exitCode: 0 as const,
          startedAt: Date.now(),
          finishedAt: Date.now(),
        };
      }
    }
    const app = await createApp(store, {
      skipExternal: true,
      token: '',
      accounts,
      adapter: new ChatFixture(),
    });
    stores.splice(stores.indexOf(store), 1);
    apps.push(app);
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: { channel: 'alex', text: 'Help me plan next steps.' },
    });
    for (let i = 0; i < 200 && store.list<Job>('jobs')[0].state !== 'COMPLETED'; i++)
      await new Promise((r) => setTimeout(r, 5));
    const job = store.list<Job>('jobs')[0];
    expect(job.state).toBe('COMPLETED');
    expect(store.snapshot().messages.at(-1)).toMatchObject({
      mode: 'execution',
      text: 'Fixture real-runner response',
    });
    expect((await app.inject('/api/jobs/' + job.id + '/artifacts/chat-run.json')).statusCode).toBe(
      200,
    );
  });
});
