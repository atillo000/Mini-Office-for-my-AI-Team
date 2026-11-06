import type { Store } from '../db';
import type { JobQueue } from '../agents/queue';
import type { Job } from '../../shared/types';
import type { CapturedMessage } from '../../shared/reader';
import type { KnowledgeProject, WorkRecord, ZohoMapping } from '../../shared/work';
import type { AttendanceShift, ShiftPlan, ShiftRequest, ShiftSnapshot } from '../../shared/shifts';
import type { ActionService } from '../connected/actions';
import { digest } from '../agents/artifacts';
import {
  capacity,
  localDate,
  saveAttendance,
  shiftSettings,
  shiftSettingsInput,
} from './attendance';
import { SproutBrowser, type SproutDriver } from './browser';
import { assertShiftRequest, planRowInput, validateRows } from './review';
import { z } from 'zod';
import { messageRelevance } from '../connected/focus';
import type { ExternalDraft, TimeLogPayload } from '../../shared/connected';
export class ShiftService {
  private busy = false;
  private stopped = false;
  private pending?: Promise<unknown>;
  private timer: ReturnType<typeof setInterval>;
  reader: ShiftSnapshot['reader'] = { open: false };
  constructor(
    public store: Store,
    public queue: JobQueue,
    public actions: ActionService,
    public changed: () => void,
    public driver: SproutDriver = new SproutBrowser(store.file + '.sprout-browser'),
    enabled = true,
  ) {
    for (const plan of store.list<ShiftPlan>('shift_plans'))
      if (plan.status === 'PREPARING')
        store.put('shift_plans', plan.id, {
          ...plan,
          status: 'NEEDS_REVIEW',
          error:
            'Draft preparation was interrupted. Existing local drafts are retained; review before continuing.',
        });
    this.timer = setInterval(() => {
      if (enabled && shiftSettings(store).enabled && this.reader.open && !this.busy) {
        this.pending = this.check().catch(() => undefined);
      }
    }, 60000);
  }
  snapshot(): ShiftSnapshot {
    return {
      settings: shiftSettings(this.store),
      reader: this.reader,
      shifts: this.store.list<AttendanceShift>('attendance_shifts').toReversed().slice(0, 30),
      plans: this.store.list<ShiftPlan>('shift_plans').toReversed().slice(0, 30),
      jobs: this.store
        .list<Job>('jobs')
        .filter((j) => j.kind === 'shift-review')
        .slice(-15)
        .reverse(),
      mappings: this.store.list<ZohoMapping>('work_mappings'),
    };
  }
  async configure(raw: unknown) {
    const next = shiftSettingsInput.parse(raw),
      old = shiftSettings(this.store);
    if (next.version !== old.version)
      throw new Error('Shift settings changed. Reload before saving.');
    if (next.sproutUrl !== old.sproutUrl) {
      await this.driver.close();
      this.reader = { open: false };
    }
    this.store.put('settings', 'shift_planning', { ...next, version: old.version + 1 });
    this.changed();
    return this.snapshot();
  }
  async open() {
    if (this.busy || this.stopped) throw new Error('Attendance reader is busy or closed.');
    this.busy = true;
    try {
      await this.driver.open(shiftSettings(this.store).sproutUrl);
      this.reader = { open: true };
      this.changed();
      return this.snapshot();
    } finally {
      this.busy = false;
    }
  }
  async check() {
    if (this.busy || this.stopped) throw new Error('Attendance reader is busy or closed.');
    this.busy = true;
    try {
      const settings = shiftSettings(this.store),
        result = await this.driver.read(settings.sproutUrl);
      if (shiftSettings(this.store).version !== settings.version)
        throw new Error('Shift settings changed during attendance capture. Check again.');
      const shifts = saveAttendance(this.store, result.punches, result.sourceUrl);
      this.reader = { open: true, lastCheckedAt: Date.now(), rowsSeen: result.rowsSeen };
      if (settings.enabled && settings.shareWithAI)
        for (const shift of shifts) {
          // Automatic planning covers recent clock-outs only, never a whole historical table on first connection.
          if (Date.now() - shift.clockOut <= 36 * 3600000 && capacity(shift, settings) > 0)
            await this.plan(shift);
        }
      this.changed();
      return this.snapshot();
    } catch (error) {
      this.reader = { ...this.reader, lastCheckedAt: Date.now(), error: (error as Error).message };
      this.changed();
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async plan(shift: AttendanceShift, retry = false) {
    const settings = shiftSettings(this.store);
    if (!settings.enabled || !settings.shareWithAI)
      throw new Error('Enable shift planning and AI sharing first.');
    const key = digest({
      shiftId: shift.id,
      version: shift.version,
      settingsVersion: settings.version,
    });
    const previous = this.store.get<{ jobId: string }>('shift_requests', key);
    if (previous && !retry) return this.store.get<Job>('jobs', previous.jobId)!;
    let history: ShiftRequest['zohoHistory'] = {
      state: 'UNKNOWN',
      reason: 'No confirmed Zoho user/portal context is available.',
    };
    try {
      const account = (await this.actions.accounts.tokens('zoho')).account;
      const draft = this.store
        .list<ExternalDraft>('external_drafts')
        .filter((d) => d.kind === 'TIME_LOG' && d.payload.account === account)
        .at(-1);
      if (draft) {
        const p = draft.payload as TimeLogPayload;
        const result = await this.actions.zoho.timeLogsRange(
          p.portalId,
          localDate(shift.clockIn),
          localDate(shift.clockOut),
          p.ownerId,
        );
        history = result.items.some((log) => log.minutes === null)
          ? { state: 'UNKNOWN', reason: 'An existing Zoho duration is unrecognized.' }
          : {
              state: 'CHECKED',
              checkedAt: result.checkedAt,
              entries: result.items,
              loggedMinutes: result.items.reduce((n, log) => n + (log.minutes || 0), 0),
            };
      }
    } catch (error) {
      history = { state: 'UNKNOWN', reason: (error as Error).message };
    }
    return this.enqueue(shift, retry, history);
  }
  enqueue(shift: AttendanceShift, retry = false, history?: ShiftRequest['zohoHistory']) {
    const settings = shiftSettings(this.store);
    if (!settings.enabled || !settings.shareWithAI)
      throw new Error('Enable shift planning and explicit AI sharing first.');
    const key = digest({
      shiftId: shift.id,
      version: shift.version,
      settingsVersion: settings.version,
    });
    const previous = this.store.get<{ jobId: string }>('shift_requests', key);
    if (previous) {
      const job = this.store.get<Job>('jobs', previous.jobId)!;
      if (!retry || ['QUEUED', 'RUNNING'].includes(job.state)) return job;
    }
    const records = this.store
      .list<WorkRecord>('work_records')
      .filter(
        (r) => r.date && r.date >= localDate(shift.clockIn) && r.date <= localDate(shift.clockOut),
      )
      .slice(-100);
    const messages = this.store
      .list<CapturedMessage>('captured_messages')
      .filter(
        (m) =>
          m.provider === 'teams' &&
          messageRelevance(this.store, m).relevant &&
          ((m.observedAt >= shift.clockIn && m.observedAt <= shift.clockOut + 3600000) ||
            (m.sentAt &&
              /\d{4}-\d{2}-\d{2}T/.test(m.sentAt) &&
              Date.parse(m.sentAt) >= shift.clockIn &&
              Date.parse(m.sentAt) <= shift.clockOut)),
      )
      .slice(-100);
    let characters = 0;
    const evidence: ShiftRequest['evidence'] = [
      ...records.map((r) => ({
        id: 'work:' + r.id,
        text: r.subject + '\n' + r.body,
        source: 'WORK_RECORD' as const,
      })),
      ...messages.map((m) => ({
        id: 'teams:' + m.id,
        text: m.text,
        source: 'TEAMS' as const,
        sentAt: m.sentAt,
      })),
    ].filter((e) => {
      characters += e.text.length;
      return characters <= 60000;
    });
    const request: ShiftRequest = {
      shift,
      settings,
      capacityMinutes: capacity(shift, settings),
      zohoHistory: history,
      allocatableMinutes:
        history?.state === 'CHECKED'
          ? Math.max(0, capacity(shift, settings) - (history.loggedMinutes || 0))
          : capacity(shift, settings),
      evidence,
      mappings: this.store.list<ZohoMapping>('work_mappings'),
      projects: this.store.list<KnowledgeProject>('knowledge_projects'),
      records: records.filter((r) => evidence.some((e) => e.id === 'work:' + r.id)),
      coverage:
        'Only saved work records and captured Teams text relevant to this clocked shift were considered. Other chats, unloaded history and unobserved work were not checked. Meeting attendance and durations require CEO confirmation.',
    };
    if (previous) {
      const old = this.store.get<Job>('jobs', previous.jobId)!;
      const context = (r: ShiftRequest) => digest({ ...r, shift: { ...r.shift, observedAt: 0 } });
      if (
        retry &&
        old.state === 'COMPLETED' &&
        old.shiftRequest &&
        context(old.shiftRequest) === context(request)
      )
        throw new Error(
          'No new work evidence or mappings. Add confirmed work context before requesting another completed review.',
        );
    }
    const job: Job = {
      id: crypto.randomUUID(),
      title: 'Plan Zoho time: ' + localDate(shift.clockIn),
      instruction: 'Prepare a shift allocation draft for CEO review.',
      kind: 'shift-review',
      shiftRequest: request,
      agentId: 'olivia',
      projectId: 'office-shifts',
      relatedId: shift.id,
      state: 'QUEUED',
      stage: 'plan',
      attempts: 1,
      workspace: '',
      result: 'Sprout clock-out captured; real AI allocation review queued.',
      testResult: 'Not applicable: proposed time allocation',
      subtasks: [],
      logs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      policyHash: digest(this.queue.adapter.policy()),
      approvals: [
        {
          id: crypto.randomUUID(),
          kind: 'planning',
          approvedBy: 'ceo',
          at: Date.now(),
          attempt: 1,
          scopeHash: digest(request),
        },
      ],
    };
    this.queue.adapter.artifacts.init(job);
    this.queue.adapter.artifacts.write(job, 'shift-request.json', request);
    this.queue.adapter.artifacts.write(job, 'execution-policy.json', this.queue.adapter.policy());
    this.queue.adapter.artifacts.write(job, 'approvals.json', job.approvals);
    this.store.transaction(() => {
      this.store.put('jobs', job.id, job);
      this.store.put('shift_requests', key, { jobId: job.id });
    });
    this.changed();
    void this.queue.drain();
    return job;
  }
  async prepare(id: string, raw: unknown) {
    const input = z
      .object({
        version: z.number().int(),
        confirmed: z.literal(true),
        ownerId: z.string().regex(/^\d+$/),
        rows: z.array(planRowInput).min(1).max(30),
      })
      .strict()
      .parse(raw);
    const plan = this.store.get<ShiftPlan>('shift_plans', id);
    if (!plan || plan.version !== input.version || !['DRAFT', 'NEEDS_REVIEW'].includes(plan.status))
      throw new Error('Allocation changed or was already prepared.');
    if (
      this.store
        .list<ShiftPlan>('shift_plans')
        .some(
          (p) => p.id !== id && p.shiftId === plan.shiftId && Object.keys(p.draftIds).length > 0,
        )
    )
      throw new Error(
        'Another allocation for this shift already has Zoho drafts. Review those before preparing another plan.',
      );
    const request = this.store.get<Job>('jobs', plan.jobId)?.shiftRequest;
    if (!request) throw new Error('Original shift request is missing.');
    assertShiftRequest(this.store, request);
    validateRows(input.rows, request);
    if (Object.keys(plan.draftIds).length && digest(plan.rows) !== digest(input.rows))
      throw new Error(
        'Some local drafts already exist. Review those before changing this allocation.',
      );
    for (const row of input.rows) {
      const mapping = this.store.get<ZohoMapping>('work_mappings', row.mappingId || '');
      const original = request.mappings.find((m) => m.id === row.mappingId);
      if (
        !mapping ||
        !original ||
        digest(mapping) !== digest(original) ||
        !mapping.portalId ||
        !mapping.projectId ||
        mapping.billing === 'UNKNOWN' ||
        !mapping.routingCategory ||
        mapping.routingCategory === 'NEEDS_REVIEW'
      )
        throw new Error(
          'Confirm a complete current Zoho mapping, billing rule and time-log category in Work knowledge. Then request a new shift review.',
        );
    }
    plan.rows = input.rows;
    // Recheck manual provider additions made after the AI proposed this allocation.
    if (this.actions.zoho) {
      const portals = [
        ...new Set(
          input.rows.map(
            (row) => this.store.get<ZohoMapping>('work_mappings', row.mappingId!)!.portalId!,
          ),
        ),
      ];
      if (portals.length !== 1)
        throw new Error('Prepare allocations for one Zoho portal at a time.');
      const current = await this.actions.zoho.timeLogsRange(
        portals[0],
        localDate(request.shift.clockIn),
        localDate(request.shift.clockOut),
        input.ownerId,
      );
      if (current.items.some((log) => log.minutes === null))
        throw new Error('Existing Zoho durations need review before preparing drafts.');
      const recorded = current.items.reduce((n, log) => n + (log.minutes || 0), 0);
      if (
        recorded + input.rows.reduce((n, row) => n + row.durationMinutes, 0) >
        request.capacityMinutes
      )
        throw new Error(
          'Zoho already contains time for this shift. Check dates and request an updated allocation before preparing more drafts.',
        );
    }
    plan.status = 'PREPARING';
    plan.version++;
    this.store.put('shift_plans', id, plan);
    this.changed();
    try {
      for (const row of plan.rows) {
        if (plan.draftIds[row.id]) continue;
        assertShiftRequest(this.store, request);
        const mapping = this.store.get<ZohoMapping>('work_mappings', row.mappingId!)!;
        const draft = await this.actions.time({
          portalId: mapping.portalId,
          projectId: mapping.projectId,
          category: mapping.routingCategory,
          projectNumber: mapping.projectNumber || '',
          proposalStage: mapping.routingCategory === 'BUSINESS_DEVELOPMENT',
          module: mapping.module.toLowerCase(),
          taskId:
            mapping.module === 'TASK'
              ? mapping.taskId
              : mapping.module === 'ISSUE'
                ? mapping.issueId
                : undefined,
          ownerId: input.ownerId,
          date: row.date,
          durationMinutes: row.durationMinutes,
          billing: mapping.billing === 'BILLABLE' ? 'Billable' : 'Non Billable',
          description: row.description,
          workConfirmed: true,
        });
        plan.draftIds[row.id] = draft.id;
        this.store.put('shift_plans', id, plan);
      }
      plan.status = 'PREPARED';
      plan.unallocatedMinutes =
        plan.capacityMinutes - plan.rows.reduce((n, r) => n + r.durationMinutes, 0);
      plan.error = undefined;
    } catch (error) {
      plan.status = 'NEEDS_REVIEW';
      plan.error = (error as Error).message;
      throw error;
    } finally {
      plan.version++;
      this.store.put('shift_plans', id, plan);
      this.changed();
    }
    return plan;
  }
  async close() {
    await this.driver.close();
    this.reader = { open: false };
    this.changed();
  }
  async shutdown() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.driver.close();
    await this.pending;
  }
}
