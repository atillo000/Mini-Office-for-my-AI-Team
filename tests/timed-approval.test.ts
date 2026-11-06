import { afterEach, describe, it, expect } from 'vitest';
import { Store } from '../server/db';
import { Accounts, type Tokens } from '../server/connected/accounts';
import { MemorySecrets } from '../server/connected/vault';
import { ZohoService } from '../server/connected/zoho';
import { ActionService } from '../server/connected/actions';
import { TimedTimeApprovals, timeApprovalPolicy } from '../server/connected/timed-approval';
import { notifications } from '../server/team/notifications';
import type { ExternalDraft } from '../shared/connected';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const input = {
  portalId: '100',
  projectId: '200',
  category: 'PROJECT',
  projectNumber: '20260109',
  proposalStage: false,
  module: 'task',
  taskId: '300',
  ownerId: '400',
  date: '2026-11-03',
  durationMinutes: 90,
  billing: 'Non Billable',
  description: 'Confirmed QA work',
  workConfirmed: true,
};
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
async function fixture() {
  const store = new Store(':memory:'),
    secrets = new MemorySecrets();
  await secrets.set('zoho:tokens', {
    account: 'qa-account',
    accessToken: 'qa-token',
    refreshToken: 'qa-refresh',
    expiresAt: Date.now() + 3600000,
    scopes: [],
    label: 'QA',
  } satisfies Tokens);
  const data = {
    writes: 0,
    history: [] as Record<string, unknown>[],
    failWrite: false,
    gate: undefined as undefined | Promise<void>,
    entered: () => {},
  };
  const records = new Map<string, Record<string, unknown>>();
  const accounts = new Accounts(store, secrets, (async (url, init) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/projects'))
        return json({
          projects: [{ id: '200', name: '20260109 QA project' }],
          page_info: { has_next_page: false },
        });
      if (u.pathname.endsWith('/users'))
        return json({
          users: [
            { id: '400', full_name: 'QA Worker' },
            { id: '401', full_name: 'Other Worker' },
          ],
          page_info: { has_next_page: false },
        });
      if (u.pathname.endsWith('/tasks'))
        return json({
          tasks: [{ id: '300', name: 'QA research' }],
          page_info: { has_next_page: false },
        });
      if (u.pathname.endsWith('/settings/timelog')) return json({});
      if (u.pathname.endsWith('/timelogs')) {
        data.entered();
        if (data.gate) await data.gate;
        return json({
          time_logs: data.history.length ? [{ log_details: data.history }] : [],
          page_info: { has_next_page: false },
        });
      }
      if (init?.method === 'POST' && u.pathname.endsWith('/log')) {
        data.writes++;
        if (data.failWrite) return json({ error: 'QA-only ambiguous provider failure' }, 500);
        const p = JSON.parse(String(init.body)),
          id = String(500 + data.writes);
        const log = {
          id,
          project: { id: '200', name: '20260109 QA project' },
          owner: { zpuid: p.owner_zpuid },
          date: p.date,
          log_hour: p.hours,
          billing_status: p.bill_status,
          type: p.module.type,
          module_detail: { id: p.module.id },
          notes: p.notes,
        };
        records.set(id, log);
        data.history.push(log);
        return json({ id }, 201);
      }
      const log = records.get(u.pathname.split('/').at(-1)!);
      if (log) return json(log);
      throw new Error('Unexpected QA endpoint: ' + u.pathname);
    }) as typeof fetch),
    zoho = new ZohoService(store, accounts),
    actions = new ActionService(store, accounts, zoho, () => {}),
    timer = new TimedTimeApprovals(store, actions, () => {});
  cleanup.push(async () => {
    await timer.shutdown();
    store.close();
  });
  const draft = await actions.time(input);
  const enable = () =>
    timer.configure({ version: timeApprovalPolicy(store).version, enabled: true });
  const due = (id = draft.id) => {
    const current = store.get<ExternalDraft>('external_drafts', id)!;
    current.autoApproval!.dueAt = Date.now() - 1;
    store.put('external_drafts', id, current);
    return current;
  };
  return { store, secrets, actions, timer, data, draft, enable, due };
}
describe('CEO-authorized 30-minute Zoho approval policy', () => {
  it('pauses while editing, resets on save, and preserves a deliberate manual pause across edits', async () => {
    const f = await fixture();
    await f.enable();
    let d = f.due();
    f.timer.control(d.id, {
      version: d.version,
      scopeHash: d.scopeHash,
      paused: true,
      editing: true,
    });
    await f.timer.runDue();
    expect(f.data.writes).toBe(0);
    d = await f.actions.time(
      { ...input, description: 'Corrected work while editing' },
      f.store.get<ExternalDraft>('external_drafts', d.id),
    );
    expect(d.autoApproval?.status).toBe('SCHEDULED');
    expect(d.autoApproval!.dueAt).toBeGreaterThan(Date.now() + 29 * 60000);
    f.timer.control(d.id, { version: d.version, scopeHash: d.scopeHash, paused: true });
    d = await f.actions.time(
      { ...input, description: 'Keep this change for manual review' },
      f.store.get<ExternalDraft>('external_drafts', d.id),
    );
    expect(d.autoApproval?.status).toBe('PAUSED');
  });
  it('starts existing confirmed drafts at a fresh 30 minutes, then verifies the real provider receipt once due', async () => {
    const f = await fixture();
    expect(f.draft.autoApproval).toBeUndefined();
    await f.enable();
    const scheduled = f.store.get<ExternalDraft>('external_drafts', f.draft.id)!;
    expect(scheduled.autoApproval!.dueAt - Date.now()).toBeGreaterThan(29 * 60000);
    await f.timer.runDue();
    expect(f.data.writes).toBe(0);
    const due = f.due();
    const notice = notifications(f.store).find((n) => n.id === 'external:' + due.id)!;
    f.store.put('notification_reads', notice.id, { revision: notice.revision });
    await f.timer.runDue();
    await f.timer.runDue();
    const result = f.store.get<ExternalDraft>('external_drafts', due.id)!;
    expect(result).toMatchObject({
      state: 'SUBMITTED',
      autoApproval: { status: 'EXECUTED' },
      approval: { mode: 'AUTO_POLICY', policyVersion: 2 },
    });
    expect(result.receipt?.verifiedAt).toBeTypeOf('number');
    expect(result.approval?.policyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(f.store.get('time_approval_policies', '2')).toMatchObject({
      enabled: true,
      delayMinutes: 30,
      account: 'qa-account',
      ownerId: '400',
    });
    expect(f.data.writes).toBe(1);
  });
  it('resets the full window after edits and rejects stale payload approval', async () => {
    const f = await fixture();
    await f.enable();
    const old = f.due();
    const edited = await f.actions.time({ ...input, description: 'Corrected QA work' }, old);
    expect(edited.autoApproval?.dueAt).toBeGreaterThan(Date.now() + 29 * 60000);
    await expect(
      f.actions.approve(
        old.id,
        { version: old.version, scopeHash: old.scopeHash },
        { policyVersion: 2 },
      ),
    ).rejects.toThrow('changed');
    await f.timer.runDue();
    expect(f.data.writes).toBe(0);
  });
  it('honors individual pause, rejection and global disable', async () => {
    const f = await fixture();
    await f.enable();
    let d = f.due();
    f.timer.control(d.id, { version: d.version, scopeHash: d.scopeHash, paused: true });
    await f.timer.runDue();
    expect(f.data.writes).toBe(0);
    f.timer.control(d.id, { version: d.version, scopeHash: d.scopeHash, paused: false });
    f.due();
    await f.timer.configure({ version: 2, enabled: false });
    await f.timer.runDue();
    expect(f.data.writes).toBe(0);
    await f.enable();
    d = f.due();
    f.actions.reject(d.id, d.version);
    await f.timer.runDue();
    expect(f.data.writes).toBe(0);
  });
  it('rechecks pause after awaited provider reads and never submits the paused draft', async () => {
    const f = await fixture();
    await f.enable();
    const d = f.due();
    let release!: () => void, entered!: () => void;
    const arrived = new Promise<void>((r) => {
      entered = r;
    });
    f.data.entered = entered;
    f.data.gate = new Promise<void>((r) => {
      release = r;
    });
    const running = f.timer.runDue();
    await arrived;
    f.timer.control(d.id, { version: d.version, scopeHash: d.scopeHash, paused: true });
    release();
    await running;
    expect(f.data.writes).toBe(0);
    expect(f.store.get<ExternalDraft>('external_drafts', d.id)?.autoApproval?.status).toBe(
      'PAUSED',
    );
  });
  it('counts manually recorded Zoho hours before auto-submitting and notifies on a blocked daily target', async () => {
    const f = await fixture();
    await f.enable();
    f.due();
    f.data.history.push({
      id: '900',
      project: { id: '200' },
      owner: { zpuid: '400' },
      date: input.date,
      log_hour: '07:00',
      notes: 'Earlier manual work',
    });
    await f.timer.runDue();
    expect(f.data.writes).toBe(0);
    expect(f.store.get<ExternalDraft>('external_drafts', f.draft.id)?.autoApproval?.status).toBe(
      'BLOCKED',
    );
    expect(notifications(f.store).find((n) => n.id === 'external:' + f.draft.id)?.category).toBe(
      'ERROR',
    );
  });
  it('does not automatically retry an uncertain provider write', async () => {
    const f = await fixture();
    await f.enable();
    f.due();
    f.data.failWrite = true;
    await f.timer.runDue();
    await f.timer.runDue();
    expect(f.data.writes).toBe(1);
    expect(f.store.get<ExternalDraft>('external_drafts', f.draft.id)?.state).toBe(
      'UNKNOWN_OUTCOME',
    );
  });
  it('serializes manual and automatic submissions for the same worker/date', async () => {
    const f = await fixture();
    await f.enable();
    const first = await f.actions.time(
      { ...input, durationMinutes: 300 },
      f.store.get<ExternalDraft>('external_drafts', f.draft.id),
    );
    const second = await f.actions.time({
      ...input,
      durationMinutes: 300,
      description: 'Another confirmed work item',
    });
    f.due(first.id);
    f.due(second.id);
    await Promise.all([
      f.actions.approve(first.id, { version: first.version, scopeHash: first.scopeHash }),
      f.timer.runDue(),
    ]);
    expect(f.data.writes).toBe(1);
    expect(f.store.get<ExternalDraft>('external_drafts', second.id)?.autoApproval?.status).toBe(
      'BLOCKED',
    );
  });
  it('resumes persisted due timers after restart, but skips other owners and offline execution', async () => {
    const f = await fixture();
    await f.enable();
    f.due();
    const other = await f.actions.time({ ...input, ownerId: '401' });
    expect(other.autoApproval).toBeUndefined();
    await f.timer.shutdown();
    const offline = new TimedTimeApprovals(f.store, f.actions, () => {}, false);
    await offline.runDue();
    await offline.shutdown();
    expect(f.data.writes).toBe(0);
    const restarted = new TimedTimeApprovals(f.store, f.actions, () => {});
    try {
      await restarted.runDue();
      expect(f.data.writes).toBe(1);
    } finally {
      await restarted.shutdown();
    }
  });
});
