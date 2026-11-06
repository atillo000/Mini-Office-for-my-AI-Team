import { z } from 'zod';
import type { Store } from '../db';
import type { ExternalDraft, MailItem, ReplyPayload, TimeLogPayload } from '../../shared/connected';
import { digest } from '../agents/artifacts';
import { Accounts, ProviderError } from './accounts';
import { ZohoService, providerId } from './zoho';
import { WorkService } from '../work/service';
import { scheduleTimeApproval, assertTimeApproval, timeApprovalPolicy } from './timed-approval';
import { capacity, localDate, shiftSettings } from '../shifts/attendance';
import type { AttendanceShift } from '../../shared/shifts';
const id = z.string().regex(/^\d+$/);
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const timeInput = z
  .object({
    portalId: id,
    projectId: id,
    category: z.enum(['PROJECT', 'GENERAL', 'BUSINESS_DEVELOPMENT']),
    projectNumber: z.string().trim().max(100).default(''),
    proposalStage: z.boolean(),
    module: z.enum(['task', 'issue', 'general']),
    taskId: id.optional(),
    ownerId: id,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    durationMinutes: z.number().int().min(1).max(1440),
    startTime: clock.optional(),
    endTime: clock.optional(),
    billing: z.enum(['Billable', 'Non Billable']),
    description: z.string().trim().min(1).max(4000),
    workConfirmed: z.literal(true),
  })
  .strict();
export function validateTime(
  input: z.infer<typeof timeInput>,
  projectName: string,
  now = Date.now(),
) {
  const date = new Date(input.date + 'T00:00:00Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.date)
    throw new Error('Choose a real work date.');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  if (input.date > today) throw new Error('Future work dates cannot be logged.');
  const key = projectName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const general = key === 'sintecsurgegeneral',
    business = key === 'sintecsurgebusinessdevelopment';
  if (
    (input.category === 'GENERAL' && !general) ||
    (input.category === 'BUSINESS_DEVELOPMENT' && !business) ||
    (input.category === 'PROJECT' && (general || business))
  )
    throw new Error(
      'The selected project does not match the General / Business Development / numbered-project category.',
    );
  if (input.proposalStage && input.category !== 'BUSINESS_DEVELOPMENT')
    throw new Error('Proposal-stage prototyping belongs in SIN_TecSurge_BusinessDevelopment.');
  if (
    input.category === 'PROJECT' &&
    (!input.projectNumber || !projectName.includes(input.projectNumber))
  )
    throw new Error('Confirm the approved project number shown in the selected live project.');
  if (input.module !== 'general' && !input.taskId) throw new Error('Choose a live task or issue.');
  if (input.module === 'general' && input.taskId)
    throw new Error('General logs cannot include a task or issue ID.');
  if (!!input.startTime !== !!input.endTime)
    throw new Error('Supply both start and end time, or neither.');
  if (input.startTime && input.endTime) {
    const start = Date.parse(input.date + 'T' + input.startTime + ':00+08:00'),
      end = Date.parse(input.date + 'T' + input.endTime + ':00+08:00');
    if (end <= start || (end - start) / 60000 !== input.durationMinutes)
      throw new Error('Start/end time must match the duration on the same work date.');
    if (end > now) throw new Error('Future work times cannot be logged.');
  }
}
export function zohoPayload(p: TimeLogPayload) {
  return {
    date: p.date,
    bill_status: p.billing,
    owner_zpuid: p.ownerId,
    notes: p.description,
    for_timer: false,
    module: { type: p.module, ...(p.taskId ? { id: p.taskId } : {}) },
    ...(p.module === 'general' ? { log_name: p.description.slice(0, 200) } : {}),
    ...(p.startTime && p.endTime
      ? { start_time: p.startTime, end_time: p.endTime }
      : {
          hours:
            String(Math.floor(p.durationMinutes / 60)).padStart(2, '0') +
            ':' +
            String(p.durationMinutes % 60).padStart(2, '0'),
        }),
  };
}
function clock24(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):([0-5]\d)(?:\s*(AM|PM))?$/i.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  }
  if (hour > 23) return null;
  return String(hour).padStart(2, '0') + ':' + match[2];
}
export class ActionService {
  private submissions = new Map<string, Promise<ExternalDraft>>();
  constructor(
    public store: Store,
    public accounts: Accounts,
    public zoho: ZohoService,
    public changed: () => void,
  ) {
    for (const draft of store.list<ExternalDraft>('external_drafts'))
      if (draft.state === 'SUBMITTING') {
        draft.state = 'UNKNOWN_OUTCOME';
        draft.error =
          'Service stopped during submission. Check the provider before taking further action; automatic retry is disabled.';
        store.put('external_drafts', draft.id, draft);
      }
  }
  private save(
    kind: ExternalDraft['kind'],
    payload: ExternalDraft['payload'],
    previous?: ExternalDraft,
  ) {
    return this.store.transaction(() => {
      if (
        previous &&
        this.store.get<ExternalDraft>('external_drafts', previous.id)?.version !== previous.version
      )
        throw new Error('Draft changed. Reload before editing.');
      const draft: ExternalDraft = {
        id: previous?.id || crypto.randomUUID(),
        kind,
        payload,
        version: (previous?.version || 0) + 1,
        state: 'DRAFT',
        scopeHash: digest({ kind, payload }),
        createdAt: previous?.createdAt || Date.now(),
        updatedAt: Date.now(),
        ...(previous?.autoApproval?.status === 'PAUSED' && !previous.autoApproval.resumeOnSave
          ? { autoApproval: previous.autoApproval }
          : {}),
      };
      scheduleTimeApproval(this.store, draft);
      this.store.put('external_drafts', draft.id, draft);
      new WorkService(this.store).audit(
        'EXTERNAL_DRAFT_SAVED',
        'external_drafts',
        draft.id,
        draft.version,
      );
      this.changed();
      return draft;
    });
  }
  async reply(mailId: string, body: string, previous?: ExternalDraft) {
    const mail = this.store.get<MailItem>('mail_items', mailId);
    if (!mail || mail.removed || mail.account !== (await this.accounts.tokens('outlook')).account)
      throw new Error('Message is not available in the connected Outlook account.');
    const content = z.string().trim().min(1).max(12000).parse(body);
    return this.save(
      'EMAIL_REPLY',
      {
        account: mail.account,
        mailId,
        providerId: mail.providerId,
        changeKey: mail.changeKey,
        to: (mail.replyTo?.length ? mail.replyTo : [mail.from]).join(', '),
        subject: mail.subject,
        body: content,
      },
      previous,
    );
  }
  async time(raw: unknown, previous?: ExternalDraft) {
    const input = timeInput.parse(raw),
      account = (await this.accounts.tokens('zoho')).account;
    const project = await this.zoho.entity('projects', input.portalId, undefined, input.projectId);
    const owner = await this.zoho.entity('users', input.portalId, input.projectId, input.ownerId);
    const task = input.taskId
      ? await this.zoho.entity(
          input.module === 'issue' ? 'issues' : 'tasks',
          input.portalId,
          input.projectId,
          input.taskId,
        )
      : undefined;
    validateTime(input, project.name);
    return this.save(
      'TIME_LOG',
      { ...input, account, projectName: project.name, ownerName: owner.name, taskName: task?.name },
      previous,
    );
  }
  private duplicate(draft: ExternalDraft, limit = 1440, automatic = false) {
    let total = draft.kind === 'TIME_LOG' ? (draft.payload as TimeLogPayload).durationMinutes : 0;
    for (const other of this.store.list<ExternalDraft>('external_drafts')) {
      if (
        other.id === draft.id ||
        !['SUBMITTING', 'SUBMITTED', 'ACCEPTED', 'UNKNOWN_OUTCOME'].includes(other.state)
      )
        continue;
      if (other.kind === draft.kind && other.scopeHash === draft.scopeHash)
        throw new Error(
          'An identical submission already exists or has an unknown outcome. Check it before submitting again.',
        );
      if (draft.kind === 'TIME_LOG' && other.kind === 'TIME_LOG') {
        const a = draft.payload as TimeLogPayload,
          b = other.payload as TimeLogPayload;
        if (a.account !== b.account || a.ownerId !== b.ownerId || a.date !== b.date) continue;
        if (automatic && ['SUBMITTING', 'UNKNOWN_OUTCOME'].includes(other.state))
          throw new Error(
            'Another time log for this day has an unfinished or unknown submission. Verify Zoho before continuing.',
          );
        total += b.durationMinutes;
        if (
          a.startTime &&
          a.endTime &&
          b.startTime &&
          b.endTime &&
          a.startTime < b.endTime &&
          b.startTime < a.endTime
        )
          throw new Error('This time range overlaps a submitted or uncertain local log.');
      }
    }
    if (total > limit)
      throw new Error(
        limit === 1440
          ? 'Saved time logs exceed the hours available that day.'
          : 'Saved time logs exceed the allowed work minutes for that day.',
      );
  }
  private dayLimit(draft: ExternalDraft) {
    const settings = shiftSettings(this.store),
      p = draft.payload as TimeLogPayload;
    const shifts = this.store
      .list<AttendanceShift>('attendance_shifts')
      .filter((s) => localDate(s.clockIn) === p.date);
    return shifts.length
      ? Math.min(
          settings.targetMinutes,
          shifts.reduce((n, s) => n + capacity(s, settings), 0),
        )
      : settings.targetMinutes;
  }
  private async preflight(draft: ExternalDraft, automatic = false) {
    const provider = draft.kind === 'EMAIL_REPLY' ? 'outlook' : 'zoho';
    if ((await this.accounts.tokens(provider)).account !== draft.payload.account)
      throw new Error('Connected account changed. Create a fresh draft.');
    if (draft.kind === 'EMAIL_REPLY') {
      const p = draft.payload as ReplyPayload;
      const response = await this.accounts.request(
        'outlook',
        '/v1.0/me/messages/' +
          encodeURIComponent(p.providerId) +
          '?$select=id,changeKey,from,replyTo,subject',
      );
      const mail = (await response.json()) as {
        changeKey: string;
        from: { emailAddress: { address: string } };
        replyTo?: { emailAddress: { address: string } }[];
        subject: string;
      };
      const to = mail.replyTo?.length
        ? mail.replyTo.map((e) => e.emailAddress.address).join(', ')
        : mail.from.emailAddress.address;
      if (mail.changeKey !== p.changeKey || to !== p.to || mail.subject !== p.subject)
        throw new Error(
          'Email changed or reply recipients changed. Sync and review a fresh reply draft.',
        );
    } else {
      const p = draft.payload as TimeLogPayload;
      const { account: _a, projectName: _p, ownerName: _o, taskName: _t, ...input } = p;
      void _a;
      void _p;
      void _o;
      void _t;
      validateTime(timeInput.parse(input), p.projectName);
      const project = await this.zoho.entity('projects', p.portalId, undefined, p.projectId);
      if (project.name !== p.projectName)
        throw new Error('Project details changed. Review a fresh time-log draft.');
      await this.zoho.entity('users', p.portalId, p.projectId, p.ownerId);
      if (p.taskId)
        await this.zoho.entity(
          p.module === 'issue' ? 'issues' : 'tasks',
          p.portalId,
          p.projectId,
          p.taskId,
        );
      // Fetch current portal restrictions. Never override overlap, approval or future-date policy.
      const settingsResponse = await this.accounts.request(
        'zoho',
        '/api/v3/portal/' + p.portalId + '/settings/timelog',
      );
      const rawSettings = (await settingsResponse.json()) as Record<string, unknown>;
      const settings = (rawSettings.timelog_settings_response || rawSettings) as {
        timelog_configuration?: Record<string, unknown>;
        period_settings?: { past_log?: string };
      };
      const enabled =
        settings.timelog_configuration?.[
          'is_' +
            (p.module === 'general'
              ? 'generallog'
              : p.module === 'issue'
                ? 'issuelog'
                : 'tasklog') +
            '_enabled'
        ];
      if (enabled === false || enabled === 'false')
        throw new Error('Your Zoho portal does not allow this log type.');
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      if (settings.period_settings?.past_log === 'not_allow' && p.date < today)
        throw new Error('Your Zoho portal does not allow past-date time logs.');
      const history = await this.zoho.timeLogs(p.portalId, p.date, p.ownerId);
      if (history.items.some((log) => log.minutes === null))
        throw new Error(
          'A Zoho log has an unrecognized duration. Check existing time logs before submitting.',
        );
      if (history.items.reduce((sum, log) => sum + (log.minutes || 0), p.durationMinutes) > 1440)
        throw new Error('Existing Zoho logs plus this draft exceed 24 hours for the selected day.');
      if (
        automatic &&
        history.items.reduce((sum, log) => sum + (log.minutes || 0), p.durationMinutes) >
          this.dayLimit(draft)
      )
        throw new Error(
          'Existing Zoho time plus this draft exceeds the confirmed daily work target.',
        );
      if (
        history.items.some(
          (log) =>
            log.projectId === p.projectId &&
            log.minutes === p.durationMinutes &&
            log.description.trim() === p.description.trim(),
        )
      )
        throw new Error(
          'A matching time log already exists in Zoho. Review it instead of submitting a duplicate.',
        );
    }
  }
  async check(id: string) {
    const draft = this.store.get<ExternalDraft>('external_drafts', id);
    if (!draft || draft.kind !== 'TIME_LOG' || draft.state !== 'DRAFT')
      throw new Error('Choose a current time-log draft for a read-only check.');
    await this.preflight(draft);
    const current = this.store.get<ExternalDraft>('external_drafts', id);
    if (current?.state === 'DRAFT' && current.version === draft.version && current.error) {
      current.error = undefined;
      this.store.put('external_drafts', id, current);
      this.changed();
    }
    return { ready: true, checkedAt: Date.now(), submitted: false };
  }
  async approve(
    id: string,
    raw: unknown,
    automatic?: { policyVersion: number },
  ): Promise<ExternalDraft> {
    const draft = this.store.get<ExternalDraft>('external_drafts', id),
      p = draft?.payload as TimeLogPayload | undefined;
    const key = draft?.kind === 'TIME_LOG' ? [p?.account, p?.ownerId, p?.date].join(':') : id;
    const prior = this.submissions.get(key);
    const pending = (prior ? prior.catch(() => undefined) : Promise.resolve()).then(() =>
      this.submit(id, raw, automatic),
    );
    this.submissions.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.submissions.get(key) === pending) this.submissions.delete(key);
    }
  }
  private async submit(id: string, raw: unknown, automatic?: { policyVersion: number }) {
    const input = z
      .object({ version: z.number().int(), scopeHash: z.string().length(64) })
      .strict()
      .parse(raw);
    let draft = this.store.get<ExternalDraft>('external_drafts', id);
    if (draft?.kind === 'EMAIL_REPLY')
      throw new Error(
        'Outlook sending is disabled. Review and copy the local reply, then send it yourself.',
      );
    if (
      !draft ||
      draft.state !== 'DRAFT' ||
      draft.version !== input.version ||
      draft.scopeHash !== input.scopeHash ||
      digest({ kind: draft.kind, payload: draft.payload }) !== input.scopeHash
    )
      throw new Error('Draft changed or was already submitted. Review the current draft.');
    try {
      if (automatic) assertTimeApproval(this.store, draft, automatic.policyVersion);
      await this.preflight(draft, !!automatic);
    } catch (error) {
      const current = this.store.get<ExternalDraft>('external_drafts', id);
      if (current?.state === 'DRAFT' && current.version === input.version) {
        current.error = 'Submission stopped before sending: ' + (error as Error).message;
        if (current.autoApproval?.status === 'SCHEDULED') {
          current.autoApproval.status = 'BLOCKED';
          current.autoApproval.reason = (error as Error).message;
        }
        this.store.put('external_drafts', id, current);
        this.changed();
      }
      throw error;
    }
    // Recheck after awaited provider reads: repeated clicks cannot send twice.
    draft = this.store.transaction(() => {
      const current = this.store.get<ExternalDraft>('external_drafts', id)!;
      if (
        current.state !== 'DRAFT' ||
        current.version !== input.version ||
        current.scopeHash !== input.scopeHash
      )
        throw new Error('This draft was already changed or submitted.');
      if (automatic) assertTimeApproval(this.store, current, automatic.policyVersion);
      this.duplicate(current, automatic ? this.dayLimit(current) : 1440, !!automatic);
      current.state = 'SUBMITTING';
      current.error = undefined;
      current.approval = {
        at: Date.now(),
        approvedBy: 'ceo',
        version: current.version,
        scopeHash: current.scopeHash,
        mode: automatic ? 'AUTO_POLICY' : 'MANUAL',
        ...(automatic
          ? {
              policyVersion: automatic.policyVersion,
              policyHash: digest(timeApprovalPolicy(this.store)),
            }
          : {}),
      };
      current.updatedAt = Date.now();
      this.store.put('external_drafts', id, current);
      new WorkService(this.store).audit(
        automatic ? 'EXTERNAL_PAYLOAD_APPROVED_BY_TIME_POLICY' : 'EXACT_EXTERNAL_PAYLOAD_APPROVED',
        'external_drafts',
        id,
        current.version,
      );
      return current;
    });
    this.changed();
    let writeAccepted = false;
    try {
      {
        const p = draft.payload as TimeLogPayload;
        const endpoint = '/api/v3/portal/' + p.portalId + '/projects/' + p.projectId;
        const response = await this.accounts.request(
          'zoho',
          endpoint + '/log',
          {
            method: 'POST',
            body: JSON.stringify(zohoPayload(p)),
          },
          p.account,
        );
        writeAccepted = true;
        const result = (await response.json()) as { id: unknown };
        const logId = providerId(result.id);
        draft.receipt = { status: response.status, providerId: logId };
        const verified = await this.accounts.request(
          'zoho',
          endpoint + '/logs/' + logId + '?type=' + p.module,
          {},
          p.account,
        );
        const log = (await verified.json()) as {
          id: unknown;
          project: { id: unknown };
          owner: { zpuid: unknown };
          date: string;
          log_hour: string;
          billing_status: string;
          type: string;
          notes?: string;
          log_notes?: string;
          module_detail?: { id: unknown };
          start_time?: string;
          end_time?: string;
        };
        const duration = /^(\d{1,2}):([0-5]\d)$/.exec(log.log_hour || '');
        if (
          providerId(log.id) !== logId ||
          providerId(log.project?.id) !== p.projectId ||
          providerId(log.owner?.zpuid) !== p.ownerId ||
          log.date !== p.date ||
          !duration ||
          Number(duration[1]) * 60 + Number(duration[2]) !== p.durationMinutes ||
          log.billing_status !== p.billing ||
          log.type !== p.module ||
          (p.taskId && providerId(log.module_detail?.id) !== p.taskId) ||
          (p.startTime && clock24(log.start_time) !== p.startTime) ||
          (p.endTime && clock24(log.end_time) !== p.endTime) ||
          (log.notes !== p.description && log.log_notes !== p.description)
        )
          throw new Error(
            'Zoho readback did not match the approved time log. Verify the provider entry before further action.',
          );
        draft.state = 'SUBMITTED';
        if (draft.autoApproval) draft.autoApproval.status = 'EXECUTED';
        draft.receipt.verifiedAt = Date.now();
      }
    } catch (error) {
      draft.state =
        !writeAccepted &&
        error instanceof ProviderError &&
        error.status >= 400 &&
        error.status < 500
          ? 'FAILED'
          : 'UNKNOWN_OUTCOME';
      draft.error =
        (error as Error).message +
        (draft.state === 'UNKNOWN_OUTCOME'
          ? ' Do not retry automatically; check the provider first.'
          : '');
    }
    draft.updatedAt = Date.now();
    this.store.put('external_drafts', id, draft);
    this.changed();
    return draft;
  }
  reject(id: string, version: number) {
    const draft = this.store.get<ExternalDraft>('external_drafts', id);
    if (!draft || draft.state !== 'DRAFT' || draft.version !== version)
      throw new Error('Draft changed or cannot be rejected after submission.');
    draft.state = 'REJECTED';
    draft.version++;
    draft.updatedAt = Date.now();
    this.store.put('external_drafts', id, draft);
    this.changed();
    return draft;
  }
}
