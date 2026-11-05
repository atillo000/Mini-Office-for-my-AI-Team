import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../server/db';
import { Artifacts, digest } from '../server/agents/artifacts';
import { CodexAdapter } from '../server/agents/codex';
import { JobQueue } from '../server/agents/queue';
import { ShiftService } from '../server/shifts/service';
import {
  capacity,
  localDate,
  saveAttendance,
  shiftSettings,
  validSproutUrl,
} from '../server/shifts/attendance';
import {
  parseSproutRows,
  sameSproutTenant,
  sproutDate,
  type SproutDriver,
} from '../server/shifts/browser';
import { validateRows } from '../server/shifts/review';
import type { AttendancePunch, AttendanceShift, ShiftPlan, ShiftRequest } from '../shared/shifts';
import type { Job } from '../shared/types';
import type { ZohoMapping } from '../shared/work';
import type { ActionService } from '../server/connected/actions';
import {
  productionInstructions,
  productionPolicy,
  saveProductionPolicy,
} from '../server/studio/production';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const out = Date.parse('2026-11-04T18:00:00+08:00'),
  start = out - 9 * 3600000;
class FixtureSprout implements SproutDriver {
  punches: AttendancePunch[] = [
    { at: start, type: 'IN', source: 'QA My Biologs' },
    { at: out, type: 'OUT', source: 'QA My Biologs' },
  ];
  async open() {}
  async close() {}
  async read() {
    return {
      sourceUrl: 'https://tecsurge.hrhub.ph/MyBiologs.aspx',
      punches: this.punches,
      rowsSeen: this.punches.length,
    };
  }
}
class FixtureModel extends CodexAdapter {
  badQuote = false;
  constructor() {
    super(undefined, '/unused', new Artifacts(mkdtempSync(path.join(os.tmpdir(), 'shift-jobs-'))));
  }
  async health() {
    return { available: true, executionReady: true, version: 'QA fixture', detail: 'Test only' };
  }
  async execute(
    _workspace: string,
    prompt: string,
    _signal: AbortSignal,
    _log: (s: string) => void,
    _id: string,
    readOnly = false,
    _schema?: string,
    skipGit = false,
  ) {
    expect(readOnly && skipGit).toBe(true);
    const request = JSON.parse(prompt.slice(prompt.indexOf('{"shift":'))) as ShiftRequest;
    return {
      completed: true as const,
      exitCode: 0 as const,
      threadId: 'fixture',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      text: JSON.stringify({
        summary: 'Proposed project review; duration needs CEO confirmation.',
        rows: request.evidence.length
          ? [
              {
                id: 'row-one',
                date: localDate(request.shift.clockIn),
                durationMinutes: 60,
                description: 'Project orientation review',
                mappingId: request.mappings[0]?.id || null,
                kind: 'PROJECT',
                evidence: [
                  {
                    id: request.evidence[0].id,
                    quote: this.badQuote
                      ? 'invented evidence'
                      : request.evidence[0].text.slice(0, 50),
                  },
                ],
              },
            ]
          : [],
      }),
    };
  }
}
async function fixture(execution = false) {
  const store = new Store(':memory:'),
    model = new FixtureModel(),
    queue = new JobQueue(store, () => {}, model, execution),
    driver = new FixtureSprout();
  const prepared: unknown[] = [];
  const actions = {
    time: async (payload: unknown) => {
      prepared.push(payload);
      return { id: 'local-' + prepared.length };
    },
  } as unknown as ActionService;
  const service = new ShiftService(store, queue, actions, () => {}, driver, false);
  cleanup.push(async () => {
    await service.shutdown();
    await queue.close();
    store.close();
  });
  await service.configure({ ...shiftSettings(store), enabled: true, shareWithAI: true });
  const mapping: ZohoMapping = {
    id: 'map',
    knowledgeProjectId: 'project',
    activityName: 'Project orientation',
    module: 'TASK',
    billing: 'BILLABLE',
    source: 'USER_CONFIRMED',
    verifiedAt: null,
    note: '',
    version: 1,
    updatedAt: 1,
    portalId: '1',
    projectId: '2',
    taskId: '3',
    routingCategory: 'PROJECT',
    projectNumber: '20260109',
    approvedDescriptions: [],
  };
  store.put('work_mappings', mapping.id, mapping);
  store.put('work_records', 'work', {
    id: 'work',
    date: '2026-11-04',
    subject: 'Project orientation',
    body: 'Reviewed project orientation materials.',
    kind: 'ACTIVITY',
    source: 'manual',
    durationMinutes: 60,
    activityConfirmed: true,
    attendanceConfirmed: false,
    version: 1,
  });
  return { store, model, queue, driver, service, prepared, mapping };
}
async function finished(store: Store) {
  for (let i = 0; i < 200; i++) {
    const job = store.list<Job>('jobs').at(-1)!;
    if (['COMPLETED', 'FAILED'].includes(job.state)) return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('Fixture shift job did not finish.');
}
describe('Sprout attendance and shift boundaries', () => {
  it('accepts only company Sprout sites, validates complete dates and normalizes real IN/OUT rows', () => {
    expect(validSproutUrl('https://tecsurge.hrhub.ph/LogIn.aspx')).toBe(true);
    expect(validSproutUrl('https://tecsurge.hrhub.ph.attacker.invalid')).toBe(false);
    expect(validSproutUrl('https://tecsurge.hrhub.ph/?token=secret')).toBe(false);
    expect(
      sameSproutTenant(
        'https://tecsurge.hrhub.ph/LogIn.aspx',
        'https://tecsurge.sprout.ph/MyBiologs.aspx',
      ),
    ).toBe(true);
    expect(
      sameSproutTenant(
        'https://tecsurge.hrhub.ph/LogIn.aspx',
        'https://another.hrhub.ph/MyBiologs.aspx',
      ),
    ).toBe(false);
    const punches = parseSproutRows([
      { 'Log Date': '11/04/2026', 'Log Time': '9:00 AM', 'Log Type': 'IN' },
      { 'Log Date': '2026-11-04', 'Log Time': '6:00 PM', 'Log Type': 'OUT' },
    ]);
    expect(punches.map((p) => p.at)).toEqual([start, out]);
    expect(() => sproutDate('2026-02-30', '9:00 AM')).toThrow('date');
    expect(() => parseSproutRows([{ Date: 'Today', Time: '9:00', Type: 'IN' }])).toThrow('format');
  });
  it('waits for clock-out, subtracts the unpaid hour and never invents a full eight-hour day', () => {
    const store = new Store(':memory:');
    cleanup.push(async () => store.close());
    const url = 'https://tecsurge.hrhub.ph/MyBiologs.aspx';
    expect(saveAttendance(store, [{ at: start, type: 'IN', source: 'QA' }], url)).toHaveLength(0);
    const shift = saveAttendance(
      store,
      [
        { at: start, type: 'IN', source: 'QA' },
        { at: out, type: 'OUT', source: 'QA' },
      ],
      url,
    )[0];
    expect(capacity(shift, shiftSettings(store))).toBe(480);
    expect(capacity({ ...shift, clockOut: start + 5 * 3600000 }, shiftSettings(store))).toBe(240);
    expect(
      saveAttendance(
        store,
        [
          { at: start, type: 'IN', source: 'QA' },
          { at: out, type: 'OUT', source: 'QA' },
        ],
        url,
      )[0].version,
    ).toBe(1);
    expect(() =>
      saveAttendance(
        store,
        [
          { at: start, type: 'IN', source: 'QA' },
          { at: start + 1, type: 'IN', source: 'QA' },
        ],
        url,
      ),
    ).toThrow('Multiple');
  });
  it('deduplicates automatic clock-out jobs, preserves durable consent and does not submit Zoho logs', async () => {
    const { service, driver, store, prepared } = await fixture();
    const now = Date.now();
    driver.punches = [
      { at: now - 9 * 3600000, type: 'IN', source: 'QA' },
      { at: now - 1000, type: 'OUT', source: 'QA' },
    ];
    await service.check();
    await service.check();
    const jobs = store.list<Job>('jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe('shift-review');
    expect(jobs[0].approvals![0].scopeHash).toBe(digest(jobs[0].shiftRequest));
    expect(prepared).toHaveLength(0);
    expect(store.list('external_drafts')).toHaveLength(0);
  });
  it('supports overnight shifts with local work dates and enforces per-day and total minute capacity', async () => {
    const { store, service } = await fixture();
    const shift: AttendanceShift = {
      id: 'night',
      clockIn: sproutDate('2026-11-03', '10:00 PM'),
      clockOut: sproutDate('2026-11-04', '7:00 AM'),
      observedAt: out,
      version: 1,
      sourceUrl: 'https://tecsurge.hrhub.ph/MyBiologs.aspx',
    };
    store.put('attendance_shifts', shift.id, shift);
    const request = service.enqueue(shift).shiftRequest!;
    const row = {
      id: 'one',
      date: '2026-11-03',
      durationMinutes: 120,
      description: 'Review',
      mappingId: 'map',
      kind: 'PROJECT' as const,
      evidence: [{ id: request.evidence[0].id, quote: 'Project orientation' }],
    };
    expect(() =>
      validateRows([row, { ...row, id: 'two', date: '2026-11-04', durationMinutes: 360 }], request),
    ).not.toThrow();
    expect(() => validateRows([{ ...row, durationMinutes: 121 }], request)).toThrow('outside');
    expect(() =>
      validateRows([{ ...row, date: '2026-11-04', durationMinutes: 481 }], request),
    ).toThrow('exceed');
  });
});
describe('Evidence-backed allocation review and local Zoho drafts', () => {
  it('saves actual adapter receipts and proposals, requires explicit confirmation, and prepares exactly once', async () => {
    const { store, service, prepared } = await fixture(true);
    const shift = saveAttendance(
      store,
      [
        { at: start, type: 'IN', source: 'QA' },
        { at: out, type: 'OUT', source: 'QA' },
      ],
      'https://tecsurge.hrhub.ph/MyBiologs.aspx',
    )[0];
    service.enqueue(shift);
    const resultJob = await finished(store);
    expect(resultJob.state, resultJob.result).toBe('COMPLETED');
    const plan = store.list<ShiftPlan>('shift_plans')[0];
    expect(plan.unallocatedMinutes).toBe(420);
    expect(prepared).toHaveLength(0);
    await expect(
      service.prepare(plan.id, { version: 1, confirmed: false, ownerId: '4', rows: plan.rows }),
    ).rejects.toThrow();
    const result = await service.prepare(plan.id, {
      version: 1,
      confirmed: true,
      ownerId: '4',
      rows: plan.rows,
    });
    expect(result.status).toBe('PREPARED');
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      durationMinutes: 60,
      workConfirmed: true,
      proposalStage: false,
      category: 'PROJECT',
    });
    await expect(
      service.prepare(plan.id, { version: 1, confirmed: true, ownerId: '4', rows: plan.rows }),
    ).rejects.toThrow('changed');
    expect(prepared).toHaveLength(1);
  });
  it('fails invented evidence and blocks stale attendance/sharing settings', async () => {
    const { store, service, model } = await fixture(true);
    model.badQuote = true;
    const shift = saveAttendance(
      store,
      [
        { at: start, type: 'IN', source: 'QA' },
        { at: out, type: 'OUT', source: 'QA' },
      ],
      'https://tecsurge.hrhub.ph/MyBiologs.aspx',
    )[0];
    service.enqueue(shift);
    expect((await finished(store)).state).toBe('FAILED');
    expect(store.list('shift_plans')).toHaveLength(0);
    await service.configure({ ...shiftSettings(store), shareWithAI: false });
    expect(() => service.enqueue(shift)).toThrow('sharing');
  });
});
describe('Free video production policy', () => {
  it('keeps daily limits and paid purchases fixed, calculates four or five outputs and invalidates old settings', () => {
    const store = new Store(':memory:');
    cleanup.push(async () => store.close());
    const policy = productionPolicy(store);
    expect(policy).toMatchObject({
      sceneCount: 5,
      freeOnly: true,
      dailyCreditLimit: 50,
      allowPaidTopUps: false,
    });
    expect(productionInstructions(policy)).toContain('Three ideas are alternatives');
    expect(productionInstructions(policy)).toContain('Check the actual account balance');
    const four = saveProductionPolicy(store, { version: 1, sceneCount: 4 });
    expect(four.sceneCount * four.creditsPerGeneration).toBe(40);
    expect(() => saveProductionPolicy(store, { version: 2, sceneCount: 6 })).toThrow();
    expect(() => saveProductionPolicy(store, { version: 1, sceneCount: 5 })).toThrow('changed');
  });
});
