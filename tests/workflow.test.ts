import { afterEach, describe, it, expect } from 'vitest';
import { Store } from '../server/db';
import { Accounts, ProviderError } from '../server/connected/accounts';
import { MemorySecrets } from '../server/connected/vault';
import { ZohoService } from '../server/connected/zoho';
import { auditTimeLogs } from '../server/connected/audit';
import { messageRelevance, workFocus } from '../server/connected/focus';
import { ReaderService } from '../server/readers/service';
import { JobQueue } from '../server/agents/queue';
import { CodexAdapter } from '../server/agents/codex';
import { Artifacts } from '../server/agents/artifacts';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AttendanceShift } from '../shared/shifts';
import { ShiftService } from '../server/shifts/service';
import { validateRows } from '../server/shifts/review';
import { shiftSettings } from '../server/shifts/attendance';
import type { ActionService } from '../server/connected/actions';
const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function storeFixture() {
  const store = new Store(':memory:');
  stores.push(store);
  store.put('connected_account', 'zoho', { account: 'qa' });
  return store;
}
function rawLog(date: string, minutes: number, owner = '400') {
  return {
    id: date.replaceAll('-', ''),
    date,
    owner: { zpuid: owner },
    project: { id: '200', name: '20260109 project' },
    log_hour:
      String(Math.floor(minutes / 60)).padStart(2, '0') +
      ':' +
      String(minutes % 60).padStart(2, '0'),
    notes: 'Actual manual entry',
    type: 'task',
    billing_status: 'Non Billable',
  };
}
async function zohoFixture(store: Store, entries: unknown[], fail = false) {
  const secrets = new MemorySecrets();
  await secrets.set('zoho:tokens', {
    account: 'qa',
    accessToken: 'fixture',
    refreshToken: '',
    expiresAt: Date.now() + 3600000,
  });
  const accounts = new Accounts(store, secrets, (async (url, init) => {
    expect(init?.method || 'GET').toBe('GET');
    const query = new URL(String(url)).searchParams;
    const filter = JSON.parse(query.get('filter')!);
    // The real provider returned 500 for the old partial assignee-only shape.
    expect(filter).toMatchObject({
      assignee: ['400'],
      project: [],
      billtype: [],
      approvaltype: [],
      tsheetperiod: [],
      clientcompany: [],
      content: [],
      invoicestatus: [],
      usergroups: [],
      criteria: [],
    });
    expect(query.get('start_date')).toBe('2026-11-02');
    expect(query.get('end_date')).toBe('2026-11-06');
    if (fail)
      return new Response(
        JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'History could not be read' } }),
        { status: 500 },
      );
    const type = JSON.parse(query.get('module')!).type;
    return new Response(
      JSON.stringify({
        time_logs: type === 'task' ? [{ log_details: entries }] : [],
        page_info: { has_next_page: false },
      }),
    );
  }) as typeof fetch);
  return new ZohoService(store, accounts);
}
describe('Existing and missing Zoho work dates', () => {
  it('includes manually logged hours in a shift request and leaves no allocation budget for an already completed day', async () => {
    const store = storeFixture(),
      queue = new JobQueue(
        store,
        () => {},
        new CodexAdapter(
          undefined,
          '/unused',
          new Artifacts(mkdtempSync(path.join(os.tmpdir(), 'logged-shift-'))),
        ),
        false,
      );
    const shift: AttendanceShift = {
      id: 'done',
      clockIn: Date.parse('2026-11-02T09:00:00+08:00'),
      clockOut: Date.parse('2026-11-02T18:00:00+08:00'),
      sourceUrl: 'https://tecsurge.hrhub.ph',
      version: 1,
      observedAt: 1,
    };
    const entry = {
      id: 'manual',
      projectId: '200',
      projectName: '20260109',
      ownerId: '400',
      date: '2026-11-02',
      minutes: 480,
      description: 'Manually logged',
      billing: 'Non Billable',
      module: 'task',
    };
    const actions = {
      accounts: { tokens: async () => ({ account: 'qa' }) },
      zoho: {
        timeLogsRange: async () => ({ items: [entry], complete: true, checkedAt: Date.now() }),
      },
    } as unknown as ActionService;
    const service = new ShiftService(
      store,
      queue,
      actions,
      () => {},
      {
        async open() {},
        async read() {
          throw new Error('Not used');
        },
        async close() {},
      },
      false,
    );
    store.put('attendance_shifts', shift.id, shift);
    store.put('external_drafts', 'manual-context', {
      kind: 'TIME_LOG',
      payload: { account: 'qa', portalId: '100', ownerId: '400' },
    });
    try {
      await service.configure({ ...shiftSettings(store), enabled: true, shareWithAI: true });
      const job = await service.plan(shift);
      expect(job.shiftRequest?.zohoHistory?.loggedMinutes).toBe(480);
      expect(job.shiftRequest?.allocatableMinutes).toBe(0);
      expect(() =>
        validateRows(
          [
            {
              id: 'extra',
              date: '2026-11-02',
              durationMinutes: 1,
              description: 'Extra',
              mappingId: null,
              kind: 'PROJECT',
              evidence: [],
            },
          ],
          job.shiftRequest!,
        ),
      ).toThrow('exceed');
    } finally {
      await service.shutdown();
      await queue.close();
    }
  });
  it('recognizes manual provider entries, partial days and real missing shifts while keeping drafts separate', async () => {
    const store = storeFixture();
    for (const date of ['2026-11-02', '2026-11-03', '2026-11-04']) {
      const shift: AttendanceShift = {
        id: date,
        clockIn: Date.parse(date + 'T09:00:00+08:00'),
        clockOut: Date.parse(date + 'T18:00:00+08:00'),
        sourceUrl: 'https://tecsurge.hrhub.ph',
        version: 1,
        observedAt: 0,
      };
      store.put('attendance_shifts', date, shift);
    }
    store.put('external_drafts', 'draft', {
      id: 'draft',
      kind: 'TIME_LOG',
      state: 'DRAFT',
      payload: {
        account: 'qa',
        portalId: '100',
        ownerId: '400',
        date: '2026-11-03',
        durationMinutes: 480,
        projectId: '200',
        description: 'Local draft',
      },
    });
    const result = await auditTimeLogs(
      store,
      await zohoFixture(store, [
        rawLog('2026-11-02', 480),
        rawLog('2026-11-04', 120),
        rawLog('2026-11-03', 480, '999'),
      ]),
      '100',
      '400',
      '2026-11-02',
      '2026-11-06',
    );
    expect(result.days.map((d) => d.state)).toEqual([
      'COMPLETE',
      'MISSING',
      'PARTIAL',
      'NO_SHIFT_EVIDENCE',
      'NO_SHIFT_EVIDENCE',
    ]);
    expect(result.days[1]).toMatchObject({
      loggedMinutes: 0,
      missingMinutes: 480,
      localDrafts: [{ id: 'draft', state: 'DRAFT', minutes: 480 }],
    });
    expect(result.days[2].missingMinutes).toBe(360);
  });
  it('does not turn a failed provider check into a missing-work claim and identifies the affected request', async () => {
    const store = storeFixture();
    await expect(
      auditTimeLogs(
        store,
        await zohoFixture(store, [], true),
        '100',
        '400',
        '2026-11-02',
        '2026-11-06',
      ),
    ).rejects.toThrow('GET /api/v3/portal/100/timelogs returned HTTP 500');
    expect(store.list('time_audits')).toHaveLength(0);
    expect(store.get('provider_failures', 'zoho')).toMatchObject({
      status: 500,
      method: 'GET',
      code: 'SERVER_ERROR',
    });
    expect(new ProviderError(500).message).not.toContain('consent');
  });
});
describe('Verified project and meeting focus', () => {
  function focused() {
    const store = storeFixture();
    store.put('settings', 'work_focus', {
      ...workFocus(store),
      enabled: true,
      portalId: '100',
      selectedNumbers: ['20260109'],
      selfNames: ['QA Worker'],
    });
    store.put('focus_catalogs', '100', {
      account: 'qa',
      portalId: '100',
      complete: true,
      checkedAt: 1,
      projects: [
        { id: '200', name: '20260109 project', numbers: ['20260109'] },
        { id: '201', name: '20260001 other project', numbers: ['20260001'] },
      ],
    });
    return store;
  }
  it('matches only selected accessible projects, with whole project numbers and account-bound verification', () => {
    const store = focused();
    const relevance = (text: string) =>
      messageRelevance(store, { provider: 'outlook', scope: 'Inbox', text });
    expect(relevance('20260109 replacement update').relevant).toBe(true);
    expect(relevance('20260001 unrelated update').relevant).toBe(false);
    expect(relevance('202601099 is another number').relevant).toBe(false);
    expect(relevance('SIN_TecSurge_General announcement').relevant).toBe(false);
    store.put('connected_account', 'zoho', { account: 'another' });
    expect(relevance('20260109').relevant).toBe(false);
  });
  it('flags personal or selected-project meeting candidates without claiming attendance', () => {
    const store = focused();
    const relevance = (text: string) =>
      messageRelevance(store, { provider: 'teams', scope: 'Chat', text });
    expect(relevance('QA Worker, please join the call').kind).toBe('MEETING_CANDIDATE');
    expect(relevance('20260109 meeting tomorrow').relevant).toBe(true);
    expect(relevance('Someone else had a meeting').relevant).toBe(false);
    expect(relevance('General announcement for QA Worker').relevant).toBe(false);
    expect(relevance('QA Worker, please join the call').reason).toContain('confirmation');
  });
  it('keeps unrelated captures out of the actual model request and does not repeatedly review excluded messages', async () => {
    const store = focused(),
      adapter = new CodexAdapter(
        undefined,
        '/unused',
        new Artifacts(mkdtempSync(path.join(os.tmpdir(), 'focus-jobs-'))),
      ),
      queue = new JobQueue(store, () => {}, adapter, false);
    const readers = new ReaderService(
      store,
      {
        async open() {},
        epoch() {
          return 1;
        },
        async close() {},
        async read() {
          return {
            sourceUrl: 'https://outlook.office.com/mail/',
            scope: 'Inbox',
            mode: 'LIST' as const,
            truncated: false,
            messages: ['20260109 review', '20260001 unrelated'].map((text, i) => ({
              text,
              sourceId: String(i),
              author: 'QA',
              sentAt: '',
              preview: true,
            })),
          };
        },
      },
      queue,
      () => {},
    );
    try {
      const result = await readers.watch('outlook', 'LIST', true);
      const job = store.list<import('../shared/types').Job>('jobs')[0];
      expect(job.communicationRequest?.messages.map((m) => m.text)).toEqual(['20260109 review']);
      store.put('jobs', job.id, { ...job, state: 'COMPLETED' });
      const next = await readers.capture('outlook', 'LIST', true, true);
      expect(next.jobId).toBeUndefined();
      expect(result.snapshot.messageIds).toHaveLength(2);
    } finally {
      await readers.shutdown();
      await queue.close();
    }
  });
});
