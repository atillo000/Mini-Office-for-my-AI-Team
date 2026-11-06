import { z } from 'zod';
import type { Store } from '../db';
import type { ExternalDraft, TimeApprovalPolicy, TimeLogPayload } from '../../shared/connected';
import type { ActionService } from './actions';
import { digest } from '../agents/artifacts';
import { WorkService } from '../work/service';

export function timeApprovalPolicy(store: Store): TimeApprovalPolicy {
  return (
    store.get<TimeApprovalPolicy>('settings', 'time_approval') || {
      enabled: false,
      version: 1,
      delayMinutes: 30,
    }
  );
}
export function policyMatches(draft: ExternalDraft, policy: TimeApprovalPolicy) {
  if (draft.kind !== 'TIME_LOG') return false;
  const p = draft.payload as TimeLogPayload;
  return (
    policy.enabled &&
    p.workConfirmed === true &&
    p.account === policy.account &&
    p.portalId === policy.portalId &&
    p.ownerId === policy.ownerId
  );
}
export function scheduleTimeApproval(store: Store, draft: ExternalDraft, now = Date.now()) {
  const policy = timeApprovalPolicy(store);
  if (
    draft.state === 'DRAFT' &&
    policyMatches(draft, policy) &&
    draft.autoApproval?.status !== 'PAUSED'
  ) {
    draft.autoApproval = {
      status: 'SCHEDULED',
      dueAt: now + policy.delayMinutes * 60000,
      version: draft.version,
      scopeHash: draft.scopeHash,
      policyVersion: policy.version,
    };
    draft.error = undefined;
  }
}
export function assertTimeApproval(store: Store, draft: ExternalDraft, policyVersion: number) {
  const policy = timeApprovalPolicy(store),
    schedule = draft.autoApproval;
  if (
    !policyMatches(draft, policy) ||
    policy.version !== policyVersion ||
    schedule?.status !== 'SCHEDULED' ||
    schedule.policyVersion !== policyVersion ||
    schedule.version !== draft.version ||
    schedule.scopeHash !== draft.scopeHash ||
    !Number.isFinite(schedule.dueAt) ||
    draft.scopeHash !== digest({ kind: draft.kind, payload: draft.payload }) ||
    schedule.dueAt > Date.now()
  )
    throw new Error('Automatic time approval was paused, changed or is not due.');
}
export class TimedTimeApprovals {
  private timer: ReturnType<typeof setInterval>;
  private startup: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private stopped = false;
  constructor(
    public store: Store,
    public actions: ActionService,
    public changed: () => void,
    private enabled = true,
  ) {
    this.timer = setInterval(() => void this.runDue(), 15000);
    this.startup = setTimeout(() => void this.runDue(), 1000);
  }
  async configure(raw: unknown) {
    const input = z
        .object({ version: z.number().int().min(1), enabled: z.boolean() })
        .strict()
        .parse(raw),
      old = timeApprovalPolicy(this.store);
    if (input.version !== old.version)
      throw new Error('Time approval settings changed. Reload before saving.');
    let next: TimeApprovalPolicy = {
      ...old,
      ...input,
      version: old.version + 1,
      delayMinutes: 30,
      updatedAt: Date.now(),
    };
    if (input.enabled) {
      const account = (await this.actions.accounts.tokens('zoho')).account;
      const draft = this.store
        .list<ExternalDraft>('external_drafts')
        .filter((d) => d.kind === 'TIME_LOG' && d.payload.account === account)
        .at(-1);
      if (!draft)
        throw new Error(
          'Save one confirmed time-log draft for your Zoho user before enabling automatic approval.',
        );
      const p = draft.payload as TimeLogPayload;
      next = { ...next, account, portalId: p.portalId, ownerId: p.ownerId, ownerName: p.ownerName };
      if (timeApprovalPolicy(this.store).version !== old.version)
        throw new Error('Time approval settings changed while connecting. Reload.');
    }
    this.store.transaction(() => {
      this.store.put('settings', 'time_approval', next);
      this.store.put('time_approval_policies', String(next.version), next);
      for (const draft of this.store.list<ExternalDraft>('external_drafts')) {
        if (draft.state !== 'DRAFT') continue;
        scheduleTimeApproval(this.store, draft);
        this.store.put('external_drafts', draft.id, draft);
      }
      new WorkService(this.store).audit(
        next.enabled ? 'TIME_AUTO_APPROVAL_ENABLED' : 'TIME_AUTO_APPROVAL_DISABLED',
        'settings',
        'time_approval',
        next.version,
      );
    });
    this.changed();
    return next;
  }
  control(id: string, raw: unknown) {
    const input = z
      .object({
        version: z.number().int(),
        scopeHash: z.string().length(64),
        paused: z.boolean(),
        editing: z.boolean().optional(),
      })
      .strict()
      .parse(raw);
    const draft = this.store.get<ExternalDraft>('external_drafts', id);
    if (
      !draft ||
      draft.kind !== 'TIME_LOG' ||
      draft.state !== 'DRAFT' ||
      draft.version !== input.version ||
      draft.scopeHash !== input.scopeHash
    )
      throw new Error('Time-log draft changed. Reload before changing its timer.');
    if (input.paused) {
      draft.autoApproval = {
        status: 'PAUSED',
        dueAt: draft.autoApproval?.dueAt || Date.now() + 1800000,
        version: draft.version,
        scopeHash: draft.scopeHash,
        policyVersion: timeApprovalPolicy(this.store).version,
        resumeOnSave: input.editing || false,
      };
    } else {
      if (!policyMatches(draft, timeApprovalPolicy(this.store)))
        throw new Error('Enable automatic approval for this Zoho account and user first.');
      draft.autoApproval = undefined;
      scheduleTimeApproval(this.store, draft);
    }
    this.store.put('external_drafts', id, draft);
    new WorkService(this.store).audit(
      input.paused ? 'TIME_AUTO_APPROVAL_PAUSED' : 'TIME_AUTO_APPROVAL_RESUMED',
      'external_drafts',
      id,
      draft.version,
    );
    this.changed();
    return draft;
  }
  async runDue() {
    if (this.stopped || !this.enabled) return;
    if (this.pending) return this.pending;
    this.pending = this.process().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async process() {
    for (const draft of this.store.list<ExternalDraft>('external_drafts')) {
      if (this.stopped) break;
      const auto = draft.autoApproval,
        policy = timeApprovalPolicy(this.store);
      if (
        draft.state !== 'DRAFT' ||
        auto?.status !== 'SCHEDULED' ||
        auto.dueAt > Date.now() ||
        !policyMatches(draft, policy) ||
        auto.policyVersion !== policy.version
      )
        continue;
      try {
        assertTimeApproval(this.store, draft, policy.version);
        await this.actions.approve(
          draft.id,
          { version: draft.version, scopeHash: draft.scopeHash },
          { policyVersion: policy.version },
        );
      } catch (error) {
        const current = this.store.get<ExternalDraft>('external_drafts', draft.id);
        const latest = timeApprovalPolicy(this.store);
        if (
          latest.enabled &&
          latest.version === auto.policyVersion &&
          current?.state === 'DRAFT' &&
          current.version === draft.version &&
          current.autoApproval?.status === 'SCHEDULED' &&
          current.autoApproval.policyVersion === auto.policyVersion
        ) {
          current.autoApproval.status = 'BLOCKED';
          current.autoApproval.reason = (error as Error).message;
          current.error = 'Automatic submission stopped: ' + (error as Error).message;
          this.store.put('external_drafts', current.id, current);
          this.changed();
        }
      }
    }
  }
  async shutdown() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.startup);
    await this.pending;
  }
}
