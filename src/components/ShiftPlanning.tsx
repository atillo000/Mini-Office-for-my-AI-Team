import { useEffect, useRef, useState } from 'react';
import type { ShiftSnapshot, ShiftPlan, ShiftPlanRow, ShiftSettings } from '../../shared/shifts';
import type { ZohoEntity } from '../../shared/connected';
import { api } from '../api';
import { useOffice } from '../store';
import { useResource } from './useResource';
import { ErrorText, Status, useAction, post, dateTime } from './common';
export function ShiftPlanning({ refreshDrafts }: { refreshDrafts: () => Promise<void> }) {
  const { data, error, refresh } = useResource<ShiftSnapshot>('/shifts');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const focused = useRef<string | null>(null);
  const action = useAction(),
    target = useOffice((s) => s.targetId);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (target && data && focused.current !== target) {
      const element = document.getElementById('shift-plan-' + target);
      if (element) {
        element.scrollIntoView({ block: 'start' });
        focused.current = target;
      }
    }
  }, [target, data]);
  if (!data) return <ErrorText error={error} />;
  const act = async (name: string) => {
    await action.execute(() => post('/shifts/browser/' + name, {}));
    await refresh();
  };
  return (
    <section className="shift-planning">
      <div className="studio-title">
        <h3>After-shift planning</h3>
        <button className="text-button" onClick={() => setSettingsOpen(!settingsOpen)}>
          Shift settings
        </button>
      </div>
      <p>
        Sprout clock-out → proposed meetings and project allocations → your review → Zoho drafts.
      </p>
      <p className="microcopy">
        {data.settings.targetMinutes / 60} work hours, {data.settings.unpaidBreakMinutes} unpaid
        break minutes. Only captured attendance and shared work context are used.
      </p>
      {settingsOpen && (
        <ShiftSettingsEditor
          key={data.settings.version}
          settings={data.settings}
          refresh={refresh}
        />
      )}
      <div className="job-actions">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={() => void act('open')}
        >
          Open Sprout browser
        </button>
        <button
          className="button secondary"
          disabled={action.busy || !data.reader.open}
          onClick={() => void act('check')}
        >
          Check attendance now
        </button>
        {data.reader.open && (
          <button className="text-button" disabled={action.busy} onClick={() => void act('close')}>
            Close Sprout reader
          </button>
        )}
      </div>
      <p className="microcopy">
        Sign in yourself and open My Biologs.{' '}
        {data.settings.enabled && data.reader.open
          ? 'Attendance checks run every minute while this backend and reader remain open.'
          : 'Enable automatic planning in Shift settings, then open the Sprout reader.'}{' '}
        Keep Teams capture/watch enabled for relevant conversations; unseen chats are not included.
      </p>
      <ErrorText error={error || action.error || data.reader.error || ''} />
      {data.reader.lastCheckedAt && (
        <small>
          Attendance checked {dateTime(data.reader.lastCheckedAt)} · {data.reader.rowsSeen || 0}{' '}
          rendered rows
        </small>
      )}
      {data.jobs[0] && (
        <p>
          <Status state={data.jobs[0].state} /> {data.jobs[0].result}
        </p>
      )}
      {data.shifts.slice(0, 5).map((shift) => (
        <div className="chat-job" key={shift.id}>
          <small>
            {dateTime(shift.clockIn)} → {dateTime(shift.clockOut)}
          </small>
          <button
            className="text-button"
            disabled={action.busy || !data.settings.enabled || !data.settings.shareWithAI}
            onClick={async () => {
              await action.execute(() => post('/shifts/' + shift.id + '/plan', {}));
              await refresh();
            }}
          >
            Review this shift with AI
          </button>
        </div>
      ))}
      {data.plans.map((plan) => (
        <PlanEditor
          key={plan.id + ':' + plan.version}
          plan={plan}
          data={data}
          refresh={async () => {
            await Promise.all([refresh(), refreshDrafts()]);
          }}
        />
      ))}
    </section>
  );
}
function ShiftSettingsEditor({
  settings,
  refresh,
}: {
  settings: ShiftSettings;
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState(settings),
    action = useAction();
  return (
    <form
      className="stacked-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await action.execute(() =>
          api('/shifts/settings', { method: 'PUT', body: JSON.stringify(form) }),
        );
        await refresh();
      }}
    >
      <label>
        Sprout sign-in URL
        <input
          type="url"
          required
          value={form.sproutUrl}
          onChange={(e) => setForm({ ...form, sproutUrl: e.target.value })}
        />
      </label>
      <div className="form-pair">
        <label>
          Work target (minutes)
          <input
            type="number"
            min={1}
            max={720}
            required
            value={form.targetMinutes}
            onChange={(e) => setForm({ ...form, targetMinutes: Number(e.target.value) })}
          />
        </label>
        <label>
          Unpaid break (minutes)
          <input
            type="number"
            min={0}
            max={180}
            required
            value={form.unpaidBreakMinutes}
            onChange={(e) => setForm({ ...form, unpaidBreakMinutes: Number(e.target.value) })}
          />
        </label>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        Automatically plan after Sprout clock-out
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={form.shareWithAI}
          onChange={(e) => setForm({ ...form, shareWithAI: e.target.checked })}
        />
        Share shift attendance, relevant saved Teams captures, work records and Zoho mappings with
        my AI analyst. Real model usage consumes quota. This does not authorize submitting time
        logs.
      </label>
      <button className="button primary" disabled={action.busy}>
        Save shift settings
      </button>
      <ErrorText error={action.error} />
    </form>
  );
}
function PlanEditor({
  plan,
  data,
  refresh,
}: {
  plan: ShiftPlan;
  data: ShiftSnapshot;
  refresh: () => Promise<void>;
}) {
  const [rows, setRows] = useState(plan.rows),
    [owner, setOwner] = useState(''),
    [users, setUsers] = useState<ZohoEntity[]>([]),
    [confirmed, setConfirmed] = useState(false);
  const action = useAction(),
    editing = ['DRAFT', 'NEEDS_REVIEW'].includes(plan.status),
    allocated = rows.reduce((n, r) => n + r.durationMinutes, 0);
  const update = (id: string, patch: Partial<ShiftPlanRow>) => {
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setConfirmed(false);
  };
  return (
    <article id={'shift-plan-' + plan.id} className="external-review">
      <div className="studio-title">
        <h4>{dateTime(plan.clockIn)} shift</h4>
        <Status state={plan.status} />
      </div>
      <p>{plan.summary}</p>
      {plan.alreadyLoggedMinutes !== undefined && (
        <p className="microcopy">
          Already in Zoho when reviewed: {plan.alreadyLoggedMinutes} minutes. Work target:{' '}
          {plan.workTargetMinutes} minutes. Proposed time below covers only the remaining budget.
        </p>
      )}
      <p className="microcopy">{plan.coverage}</p>
      <p>
        <strong>
          {allocated} / {plan.capacityMinutes} minutes proposed
        </strong>{' '}
        · {Math.max(0, plan.capacityMinutes - allocated)} unallocated
      </p>
      <form
        className="stacked-form"
        onSubmit={async (e) => {
          e.preventDefault();
          await action.execute(() =>
            post('/shift-plans/' + plan.id + '/prepare', {
              version: plan.version,
              confirmed,
              ownerId: owner,
              rows,
            }),
          );
          await refresh();
        }}
      >
        {rows.map((row) => (
          <fieldset className="studio-scene-edit" key={row.id} disabled={!editing || action.busy}>
            <legend>{row.kind} · proposed, requires confirmation</legend>
            <div className="form-pair">
              <label>
                Work date
                <input
                  type="date"
                  value={row.date}
                  required
                  onChange={(e) => update(row.id, { date: e.target.value })}
                />
              </label>
              <label>
                Minutes
                <input
                  type="number"
                  min={1}
                  max={plan.capacityMinutes}
                  required
                  value={row.durationMinutes}
                  onChange={(e) => update(row.id, { durationMinutes: Number(e.target.value) })}
                />
              </label>
            </div>
            <label>
              Zoho mapping
              <select
                value={row.mappingId || ''}
                required
                onChange={(e) => update(row.id, { mappingId: e.target.value || null })}
              >
                <option value="">Choose a confirmed mapping</option>
                {data.mappings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.activityName} · {m.routingCategory || 'Needs category review'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description
              <textarea
                rows={3}
                maxLength={2000}
                required
                value={row.description}
                onChange={(e) => update(row.id, { description: e.target.value })}
              />
            </label>
            {row.evidence.map((e, i) => (
              <blockquote key={i}>{e.quote}</blockquote>
            ))}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setRows(rows.filter((r) => r.id !== row.id));
                setConfirmed(false);
              }}
            >
              Remove allocation
            </button>
          </fieldset>
        ))}
        {editing && rows.length > 0 && (
          <>
            <button
              type="button"
              className="text-button"
              disabled={action.busy}
              onClick={() =>
                void action.execute(async () => {
                  const mapping = data.mappings.find((m) => m.id === rows[0].mappingId);
                  if (!mapping?.portalId || !mapping.projectId)
                    throw new Error('Choose a complete Zoho mapping first.');
                  const query = new URLSearchParams({
                    kind: 'users',
                    portalId: mapping.portalId,
                    projectId: mapping.projectId,
                  });
                  setUsers((await api<{ items: ZohoEntity[] }>('/zoho/discover?' + query)).items);
                })
              }
            >
              Load my Zoho user
            </button>
            <label>
              Log time for
              <select
                required
                value={owner}
                onChange={(e) => {
                  setOwner(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="">Select yourself</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I confirm my actual participation, work dates, durations, project approval/category
              and break exclusion. These rows do not overlap each other or time I already logged.
            </label>
            <button
              className="button primary"
              disabled={action.busy || !confirmed || !owner || allocated > plan.capacityMinutes}
            >
              Confirm allocation and prepare Zoho drafts
            </button>
          </>
        )}
        <ErrorText error={action.error || plan.error || ''} />
      </form>
      {plan.status === 'PREPARED' && (
        <p>
          Zoho drafts are ready below for exact review and submission. Nothing has been posted
          automatically.
        </p>
      )}
      {!rows.length && (
        <p>
          No supported allocation was found. Add confirmed activities in Work knowledge, capture
          relevant Teams conversations, then request another review.
        </p>
      )}
    </article>
  );
}
