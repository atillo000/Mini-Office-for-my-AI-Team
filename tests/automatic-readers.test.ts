import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/db';
import { JobQueue } from '../server/agents/queue';
import { CodexAdapter } from '../server/agents/codex';
import { Artifacts } from '../server/agents/artifacts';
import { ReaderService } from '../server/readers/service';
import { AutomaticReaders, automationSettings } from '../server/readers/automatic';
import { ReaderError, type ReaderDriver } from '../server/readers/browser';
import { notifications } from '../server/team/notifications';
import type { ReaderProvider, RenderedView } from '../shared/reader';
import type { Job } from '../shared/types';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
class NavigationFixture implements ReaderDriver {
  opens = 0;
  selected: string[] = [];
  active = 'one';
  generation = 0;
  login = false;
  failSecond = false;
  unstableIds = false;
  suffix = '';
  async open() {
    this.opens++;
  }
  async close() {}
  epoch() {
    return this.generation;
  }
  async targets() {
    if (this.login) throw new ReaderError('NEEDS_SIGN_IN', 'Microsoft needs MFA.');
    return [
      { id: 'one', label: 'Project chat one' },
      { id: 'two', label: 'Project chat two' },
    ];
  }
  async select(_provider: ReaderProvider, id: string) {
    if (this.failSecond && id === 'two')
      throw new ReaderError('NEEDS_SELECTION', 'Second view did not load.');
    this.active = id;
    this.selected.push(id);
    this.generation++;
  }
  async read(provider: ReaderProvider): Promise<RenderedView> {
    return {
      sourceUrl:
        provider === 'teams'
          ? 'https://teams.cloud.microsoft/v2/'
          : 'https://outlook.office.com/mail/',
      scope: 'Project chat ' + this.active,
      mode: provider === 'teams' ? 'SELECTED' : 'LIST',
      truncated: false,
      messages: [
        {
          sourceId: this.active + (this.unstableIds ? ':' + this.generation : ''),
          text: 'QA Worker joined the 20260109 meeting ' + this.active + this.suffix,
          author: 'QA colleague',
          sentAt: '',
          preview: provider === 'outlook',
        },
      ],
    };
  }
}
function fixture(enabled = true) {
  const store = new Store(':memory:'),
    driver = new NavigationFixture(),
    queue = new JobQueue(
      store,
      () => {},
      new CodexAdapter(
        undefined,
        '/unused',
        new Artifacts(mkdtempSync(path.join(os.tmpdir(), 'auto-readers-'))),
      ),
      false,
    );
  store.put('settings', 'work_focus', {
    enabled: true,
    portalId: '100',
    mode: 'SELECTED',
    selectedNumbers: ['20260109'],
    selfNames: ['QA Worker'],
    version: 1,
  });
  store.put('connected_account', 'zoho', { account: 'qa' });
  store.put('focus_catalogs', '100', {
    account: 'qa',
    portalId: '100',
    projects: [{ id: '200', name: '20260109', numbers: ['20260109'] }],
    complete: true,
    checkedAt: 1,
  });
  const readers = new ReaderService(store, driver, queue, () => {}),
    automatic = new AutomaticReaders(store, readers, queue, () => {}, enabled);
  cleanup.push(async () => {
    await automatic.shutdown();
    await readers.shutdown();
    await queue.close();
    store.close();
  });
  return { store, driver, queue, readers, automatic };
}
describe('Automatic signed-in browser readers', () => {
  it('does not spend quota again when a provider replaces row IDs, but reviews changed content', async () => {
    const { store, driver, automatic } = fixture();
    driver.unstableIds = true;
    await automatic.configure('outlook', {
      version: 1,
      enabled: true,
      shareWithAI: true,
      intervalMinutes: 3,
    });
    await automatic.runNow('outlook');
    const first = store.list<Job>('jobs')[0];
    store.put('jobs', first.id, { ...first, state: 'COMPLETED' });
    await automatic.runNow('outlook');
    expect(store.list('captured_messages')).toHaveLength(4);
    expect(store.list('jobs')).toHaveLength(1);
    driver.suffix = ' with a new work update';
    await automatic.runNow('outlook');
    expect(store.list('jobs')).toHaveLength(2);
  });
  it('opens and navigates without manual reader/capture clicks and batches exact real captures into one durable review', async () => {
    const { store, driver, automatic } = fixture();
    await automatic.configure('teams', {
      version: 1,
      enabled: true,
      shareWithAI: true,
      intervalMinutes: 3,
    });
    await automatic.runNow('teams');
    expect(driver.opens).toBe(1);
    expect(driver.selected).toEqual(['one', 'two']);
    expect(automatic.state('teams')).toMatchObject({
      status: 'MONITORING',
      visitedViews: 2,
      capturedMessages: 2,
    });
    const jobs = store.list<Job>('jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].communicationRequest).toMatchObject({
      automation: { provider: 'teams', version: 2 },
      snapshot: { complete: false },
      messages: [{ scope: 'Project chat one' }, { scope: 'Project chat two' }],
    });
    expect(jobs[0].state).toBe('QUEUED');
    await automatic.runNow('teams');
    expect(store.list('jobs')).toHaveLength(1);
  });
  it('restarts saved automation without a person pressing Open browser', async () => {
    const { store, driver, automatic, readers, queue } = fixture();
    await automatic.shutdown();
    store.put('reader_automation', 'teams', {
      provider: 'teams',
      version: 1,
      enabled: true,
      shareWithAI: false,
      intervalMinutes: 3,
    });
    const restarted = new AutomaticReaders(store, readers, queue, () => {}, true);
    try {
      for (let n = 0; n < 100 && restarted.state('teams').status !== 'MONITORING'; n++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect(driver.opens).toBe(1);
      expect(restarted.state('teams').status).toBe('MONITORING');
      expect(store.list('jobs')).toHaveLength(0);
    } finally {
      await restarted.shutdown();
    }
  });
  it('notifies about MFA without inventing message captures or completion', async () => {
    const { store, driver, automatic } = fixture();
    driver.login = true;
    await automatic.configure('outlook', {
      version: 1,
      enabled: true,
      shareWithAI: true,
      intervalMinutes: 3,
    });
    await automatic.runNow('outlook');
    expect(automatic.state('outlook')).toMatchObject({ status: 'NEEDS_SIGN_IN', visitedViews: 0 });
    expect(store.list('captured_messages')).toHaveLength(0);
    expect(store.list('jobs')).toHaveLength(0);
    expect(notifications(store).some((n) => n.id === 'reader-attention:outlook')).toBe(true);
  });
  it('keeps partial coverage explicit and pauses queued AI work without reopening after pause', async () => {
    const { store, driver, automatic } = fixture();
    driver.failSecond = true;
    await automatic.configure('teams', {
      version: 1,
      enabled: true,
      shareWithAI: true,
      intervalMinutes: 3,
    });
    await automatic.runNow('teams');
    expect(automatic.state('teams').coverage).toContain('1 view(s) were unavailable');
    automatic.pause('teams');
    expect(automationSettings(store, 'teams').enabled).toBe(false);
    expect(store.list<Job>('jobs')[0].state).toBe('CANCELLED');
    await expect(automatic.runNow('teams')).rejects.toThrow('Enable');
    expect(driver.opens).toBe(1);
  });
  it('does not launch a browser in offline QA even when a saved preference is enabled', async () => {
    const { store, driver, automatic } = fixture(false);
    await automatic.configure('teams', {
      version: 1,
      enabled: true,
      shareWithAI: false,
      intervalMinutes: 3,
    });
    automatic.tick(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(driver.opens).toBe(0);
    expect(store.list('captured_messages')).toHaveLength(0);
  });
});
