import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { parseSproutRows } from '../server/shifts/browser';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../server/db';
import { JobQueue } from '../server/agents/queue';
import { CodexAdapter } from '../server/agents/codex';
import { Artifacts } from '../server/agents/artifacts';
import { ReaderService } from '../server/readers/service';
import {
  allowedReaderUrl,
  extractRenderedView,
  type ReaderDriver,
} from '../server/readers/browser';
import type {
  CaptureMode,
  CommunicationReport,
  CommunicationRequest,
  LocalReplyDraft,
  ReaderProvider,
  RenderedView,
} from '../shared/reader';
import type { Job } from '../shared/types';
import { createApp } from '../server/app';
import { notifications } from '../server/team/notifications';
import { Accounts, scopes } from '../server/connected/accounts';
import { MemorySecrets } from '../server/connected/vault';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((f) => f()));
});
class FixtureReader implements ReaderDriver {
  generation = 1;
  source = 'https://teams.cloud.microsoft/v2/?private-query=not-stored';
  scope = 'Fixture project chat';
  messages = [
    {
      sourceId: 'one',
      text: 'Please review the proposal by 3 PM today.',
      author: 'Fixture colleague',
      sentAt: '',
      preview: false,
    },
  ];
  async open() {}
  epoch() {
    return this.generation;
  }
  async read(_provider: ReaderProvider, mode: CaptureMode): Promise<RenderedView> {
    return {
      sourceUrl: this.source,
      scope: this.scope,
      mode,
      messages: this.messages,
      truncated: false,
    };
  }
  async close() {}
}
class FixtureModel extends CodexAdapter {
  badEvidence = false;
  constructor() {
    super(undefined, '/unused', new Artifacts(mkdtempSync(path.join(os.tmpdir(), 'reader-jobs-'))));
  }
  async health() {
    return {
      available: true,
      executionReady: true,
      version: 'Injected test adapter',
      detail: 'Test only',
    };
  }
  async execute(
    _workspace: string,
    prompt: string,
    _signal: AbortSignal,
    _log: (text: string) => void,
    _id: string,
    readOnly = false,
    _schema?: string,
    skipGit = false,
  ) {
    expect(readOnly).toBe(true);
    expect(skipGit).toBe(true);
    expect(prompt).toContain('Observation time is not message sent time');
    const request = JSON.parse(
      prompt.slice(prompt.indexOf('{"snapshot":')),
    ) as CommunicationRequest;
    const result = {
      summary: 'Review this captured request; wider inbox was not checked.',
      assessments: request.messages.map((m) => ({
        messageId: m.id,
        urgency: 'URGENT',
        reason: 'A deadline is stated in the source.',
        evidence: this.badEvidence ? 'fabricated quote' : m.text.slice(0, 70),
        draftReply: 'I will review the proposal and confirm the next step.',
      })),
    };
    return {
      text: JSON.stringify(result),
      threadId: 'test-only-run',
      completed: true as const,
      exitCode: 0 as const,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
  }
}
function fixture(enabled = false) {
  const store = new Store(':memory:'),
    model = new FixtureModel(),
    queue = new JobQueue(store, () => {}, model, enabled),
    driver = new FixtureReader();
  const readers = new ReaderService(store, driver, queue, () => {});
  cleanups.push(async () => {
    await readers.shutdown();
    await queue.close();
    store.close();
  });
  return { store, model, queue, driver, readers };
}
async function terminal(store: Store, id: string) {
  for (let n = 0; n < 200; n++) {
    const job = store.get<Job>('jobs', id)!;
    if (['FAILED', 'COMPLETED'].includes(job.state)) return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('Fixture review did not finish');
}
describe('Read-only browser boundaries', () => {
  it('accepts only exact provider HTTPS hosts, including the current cloud.microsoft domains', () => {
    expect(allowedReaderUrl('outlook', 'https://outlook.cloud.microsoft/mail/')).toBe(true);
    expect(allowedReaderUrl('teams', 'https://teams.cloud.microsoft/v2/')).toBe(true);
    expect(allowedReaderUrl('teams', 'https://teams.microsoft.com.attacker.invalid')).toBe(false);
    expect(allowedReaderUrl('outlook', 'http://outlook.office.com')).toBe(false);
    expect(allowedReaderUrl('teams', 'https://login.microsoftonline.com')).toBe(false);
  });
  it('captures real driver output without AI sharing by default and strips URL query/fragment data', async () => {
    const { readers, store } = fixture();
    const result = await readers.capture('teams', 'SELECTED', false);
    expect(result.snapshot.complete).toBe(false);
    expect(result.snapshot.messageIds).toHaveLength(1);
    expect(result.snapshot.sourceUrl).toBe('https://teams.cloud.microsoft/v2/');
    expect(store.list('jobs')).toHaveLength(0);
    expect(store.list('communication_reports')).toHaveLength(0);
  });
  it('rejects login/off-provider content rather than saving a fictitious successful capture', async () => {
    const { readers, driver, store } = fixture();
    driver.source = 'https://login.microsoftonline.com/';
    await expect(readers.capture('teams', 'SELECTED', true)).rejects.toThrow('authorized');
    expect(store.list('captured_messages')).toHaveLength(0);
    expect(readers.state('teams').state).toBe('NEEDS_SIGN_IN');
  });
  it('stops watching if navigation or scope changes and never silently expands the capture', async () => {
    const { readers, driver } = fixture();
    await readers.watch('teams', 'SELECTED', false);
    driver.generation++;
    await expect(readers.capture('teams', 'SELECTED', false, true)).rejects.toThrow(
      'changed views',
    );
    expect(readers.state('teams')).toMatchObject({ watching: false, state: 'NEEDS_SELECTION' });
    await readers.watch('teams', 'SELECTED', false);
    driver.scope = 'Different chat';
    await expect(readers.capture('teams', 'SELECTED', false, true)).rejects.toThrow(
      'changed views',
    );
    expect(readers.state('teams').watching).toBe(false);
  });
  it('does not lose arrivals captured while a prior AI review is queued', async () => {
    const { readers, driver, store } = fixture();
    const first = await readers.watch('teams', 'SELECTED', true);
    driver.messages.push({
      sourceId: 'two',
      text: 'An important new message arrived.',
      author: 'Fixture colleague',
      sentAt: '',
      preview: false,
    });
    await readers.capture('teams', 'SELECTED', true, true);
    expect(store.list('jobs')).toHaveLength(1);
    const old = store.get<Job>('jobs', first.jobId!)!;
    store.put('jobs', old.id, { ...old, state: 'CANCELLED' });
    const next = await readers.capture('teams', 'SELECTED', true, true);
    expect(next.jobId).toBeTruthy();
    expect(store.list('jobs')).toHaveLength(2);
  });
  it('reviews changed provider timestamps and locks sharing while watching', async () => {
    const { readers, driver, store } = fixture();
    const first = await readers.watch('teams', 'SELECTED', false);
    await expect(readers.capture('teams', 'SELECTED', true)).rejects.toThrow('Stop watching');
    driver.messages[0].sentAt = '2026-11-05T01:00:00Z';
    const next = await readers.capture('teams', 'SELECTED', false, true);
    expect(next.newMessages).toBe(1);
    expect(
      store.get<{ version: number }>('captured_messages', first.snapshot.messageIds[0])?.version,
    ).toBe(2);
  });
});
describe('Real-review contracts and local drafts', () => {
  it('preserves edited and archived drafts on repeated reviews, and replaces stale urgency alerts', async () => {
    const { readers, store } = fixture(true);
    const first = await readers.capture('teams', 'SELECTED', true);
    expect((await terminal(store, first.jobId!)).state).toBe('COMPLETED');
    const draft = store.list<LocalReplyDraft>('local_reply_drafts')[0];
    readers.editDraft(draft.id, {
      version: draft.version,
      body: 'My edited reply.',
      status: 'DRAFT',
    });
    const second = await readers.capture('teams', 'SELECTED', true);
    expect((await terminal(store, second.jobId!)).state).toBe('COMPLETED');
    expect(store.list<LocalReplyDraft>('local_reply_drafts')).toHaveLength(1);
    const edited = store.get<LocalReplyDraft>('local_reply_drafts', draft.id)!;
    expect(edited.body).toBe('My edited reply.');
    readers.editDraft(draft.id, { version: edited.version, body: edited.body, status: 'ARCHIVED' });
    const third = await readers.capture('teams', 'SELECTED', true);
    expect((await terminal(store, third.jobId!)).state).toBe('COMPLETED');
    expect(store.list<LocalReplyDraft>('local_reply_drafts')).toHaveLength(1);
    expect(store.get<LocalReplyDraft>('local_reply_drafts', draft.id)?.status).toBe('ARCHIVED');
    expect(notifications(store).filter((n) => n.category === 'URGENT')).toHaveLength(1);
    const report = store.list<CommunicationReport>('communication_reports').at(-1)!;
    store.put('communication_reports', report.id, {
      ...report,
      assessments: report.assessments.map((a) => ({ ...a, urgency: 'ROUTINE' })),
    });
    expect(notifications(store).some((n) => n.category === 'URGENT')).toBe(false);
    expect(store.list('communication_reports')).toHaveLength(3);
  });
  it('requires completed model execution and source-matching evidence; creates only local drafts', async () => {
    const { readers, store } = fixture(true);
    const result = await readers.capture('teams', 'SELECTED', true),
      job = await terminal(store, result.jobId!);
    expect(job.state).toBe('COMPLETED');
    const report = store.list<CommunicationReport>('communication_reports')[0];
    expect(report.assessments[0].sourceText).toContain('3 PM');
    expect(report.coverage).toContain('Unloaded history');
    const draft = store.list<LocalReplyDraft>('local_reply_drafts')[0];
    expect(draft).toMatchObject({ status: 'DRAFT', origin: 'AI', provider: 'teams' });
    expect(store.list('external_drafts')).toHaveLength(0);
    expect(notifications(store).some((n) => n.category === 'URGENT')).toBe(true);
    const reviewed = readers.editDraft(draft.id, {
      version: 1,
      body: draft.body,
      status: 'REVIEWED',
    });
    const edited = readers.editDraft(draft.id, {
      version: reviewed.version,
      body: 'A different response.',
      status: 'REVIEWED',
    });
    expect(edited.status).toBe('DRAFT');
    expect(() =>
      readers.editDraft(draft.id, { version: reviewed.version, body: 'stale', status: 'REVIEWED' }),
    ).toThrow('changed');
  });
  it('fails instead of manufacturing a report when the model invents an evidence quote', async () => {
    const { readers, store, model } = fixture(true);
    model.badEvidence = true;
    const result = await readers.capture('teams', 'SELECTED', true),
      job = await terminal(store, result.jobId!);
    expect(job.state).toBe('FAILED');
    expect(job.result).toContain('evidence quote');
    expect(store.list('communication_reports')).toHaveLength(0);
    expect(store.list('local_reply_drafts')).toHaveLength(0);
  });
  it('blocks every Outlook write before HTTP, regardless of an existing OAuth grant', async () => {
    const store = new Store(':memory:'),
      secrets = new MemorySecrets();
    let calls = 0;
    const accounts = new Accounts(store, secrets, (async () => {
      calls++;
      return new Response('{}');
    }) as typeof fetch);
    cleanups.push(async () => store.close());
    expect(scopes.outlook.some((s) => /send|write/i.test(s))).toBe(false);
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT'])
      await expect(accounts.request('outlook', '/v1.0/me/messages', { method })).rejects.toThrow(
        'read-only',
      );
    expect(calls).toBe(0);
  });
  it('protects browser controls with CEO authentication and never accepts send actions', async () => {
    const store = new Store(':memory:'),
      driver = new FixtureReader();
    const app = await createApp(store, {
      skipExternal: true,
      token: 'test-ceo',
      readerDriver: driver,
    });
    cleanups.push(() => app.close());
    expect((await app.inject('/api/readers')).statusCode).toBe(401);
    const headers = { authorization: 'Bearer test-ceo' };
    const response = await app.inject({
      method: 'POST',
      url: '/api/readers/teams/capture',
      headers,
      payload: { mode: 'SELECTED', shareWithAI: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().snapshot.complete).toBe(false);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/readers/teams/send',
          headers,
          payload: { mode: 'SELECTED' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject('/api/readers/teams/messages')).statusCode).toBe(401);
  });
});
describe('DOM extraction in a real browser with explicit QA content', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  it('reads dated Sprout attendance groups and excludes location/IP details and other views', async () => {
    const page = await browser.newPage();
    const script = readFileSync(
      new URL('../server/shifts/sprout-dom.mjs', import.meta.url),
      'utf8',
    ).replace('export const readAttendance', 'const readAttendance');
    try {
      await page.setContent(
        '<h1>My Attendance Logs</h1><div class="my-attendance-mainpanel-collapse"><h3>November 04, 2026WEDNESDAY</h3><table><thead><tr><th>TIME</th><th>IN/OUT</th><th>LOCATION</th></tr></thead><tbody><tr><td>09:11 AM</td><td>IN</td><td>Private location fixture</td></tr><tr><td>06:30 PM</td><td>OUT</td><td>Private IP fixture</td></tr></tbody></table></div>',
      );
      const data = (await page.evaluate('(() => {' + script + ';return readAttendance();})()')) as {
        rows: Record<string, string>[];
      };
      expect(parseSproutRows(data.rows).map((p) => p.type)).toEqual(['IN', 'OUT']);
      expect(data.rows[0].Date).toBe('2026-11-04');
      expect(JSON.stringify(data)).not.toContain('Private');
      await page.setContent(
        '<h1>Manager attendance</h1><table><tr><th>TIME</th></tr><tr><td>09:00 AM</td></tr></table>',
      );
      expect(
        (
          (await page.evaluate('(() => {' + script + ';return readAttendance();})()')) as {
            selfView: boolean;
          }
        ).selfView,
      ).toBe(false);
    } finally {
      await page.close();
    }
  });
  it('reads current Teams message selectors without transpiler globals or compose text', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(
        '<h2 data-tid="chat-title">QA project chat</h2><div data-tid="chat-pane-item"><span data-tid="message-author-name">QA colleague</span><time datetime="2026-11-05T01:00:00Z"></time><div data-tid="chat-pane-message" id="message-one"><div>Review the proposal today.</div></div></div><div role="textbox" contenteditable="true">Never capture this draft</div>',
      );
      const view = await extractRenderedView(page, 'teams', 'SELECTED');
      expect(view.scope).toBe('QA project chat');
      expect(view.messages).toHaveLength(1);
      expect(view.messages[0].text).toContain('proposal');
      expect(view.messages[0].author).toBe('QA colleague');
      expect(view.messages[0].sentAt).toBe('2026-11-05T01:00:00Z');
      expect(JSON.stringify(view)).not.toContain('Never capture');
    } finally {
      await page.close();
    }
  });
  it('does not capture visible credential forms even if message-shaped elements exist', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(
        '<input type="password" value="fixture-password"><h2 data-tid="chat-title">Login</h2><div data-tid="chat-pane-message">Sign in</div>',
      );
      const view = await extractRenderedView(page, 'teams', 'SELECTED');
      expect(view.login).toBe(true);
      expect(view.messages).toHaveLength(0);
    } finally {
      await page.close();
    }
  });
  it('labels Outlook list rows as previews and bounds a large rendered view', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(
        '<div role="listbox">' +
          Array.from(
            { length: 70 },
            (_, i) =>
              '<div role="option" id="mail-' + i + '">' + 'Preview '.repeat(1000) + '</div>',
          ).join('') +
          '</div>',
      );
      const view = await extractRenderedView(page, 'outlook', 'LIST');
      expect(view.messages.length).toBeGreaterThan(0);
      expect(view.messages.length).toBeLessThanOrEqual(50);
      expect(view.messages.every((m) => m.preview)).toBe(true);
      expect(view.truncated).toBe(true);
      expect(view.messages.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(48000);
    } finally {
      await page.close();
    }
  });
});
