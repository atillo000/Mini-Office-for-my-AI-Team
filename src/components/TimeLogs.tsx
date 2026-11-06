import { useEffect, useRef, useState } from 'react';
import type {
  ExternalDraft,
  RemoteTimeLog,
  TimeLogPayload,
  ZohoEntity,
  TimeApprovalPolicy,
} from '../../shared/connected';
import { api } from '../api';
import { useOffice } from '../store';
import { useResource } from './useResource';
import { ErrorText, Submit, useAction, post } from './common';
import { ExternalDraftReview } from './ExternalDraft';
import { ShiftPlanning } from './ShiftPlanning';
import { TimeAudit } from './TimeAudit';
import { TimeApprovalSettings } from './TimeApprovalSettings';
import { InboxGroup } from './InboxGroup';
import { matchesSearch } from './inbox-groups';
type Discovery = { items: ZohoEntity[]; complete: boolean };
export function TimeLogs() {
  const s = useOffice(),
    action = useAction(),
    drafts = useResource<ExternalDraft[]>('/external-drafts');
  const policy = useResource<TimeApprovalPolicy>('/timelogs/approval-policy');
  const [query, setQuery] = useState('');
  const refreshDrafts = drafts.refresh,
    refreshPolicy = policy.refresh;
  useEffect(() => {
    const timer = setInterval(() => {
      void refreshDrafts();
      void refreshPolicy();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshDrafts, refreshPolicy]);
  const [portals, setPortals] = useState<ZohoEntity[]>([]),
    [projects, setProjects] = useState<ZohoEntity[]>([]),
    [tasks, setTasks] = useState<ZohoEntity[]>([]),
    [users, setUsers] = useState<ZohoEntity[]>([]);
  const [portal, setPortal] = useState(''),
    [project, setProject] = useState(''),
    [owner, setOwner] = useState(''),
    [task, setTask] = useState('');
  const [category, setCategory] = useState<TimeLogPayload['category']>('PROJECT'),
    [module, setModule] = useState<TimeLogPayload['module']>('task');
  const [proposal, setProposal] = useState(false),
    [projectNumber, setProjectNumber] = useState('');
  const [date, setDate] = useState(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
  );
  const [duration, setDuration] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [billing, setBilling] = useState<TimeLogPayload['billing']>('Non Billable'),
    [description, setDescription] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const sequence = useRef(0);
  const [editing, setEditing] = useState<ExternalDraft | null>(null);
  const [history, setHistory] = useState<RemoteTimeLog[] | null>(null);
  const target = s.targetId;
  const [tab, setTab] = useState(target ? 'drafts' : 'dates');
  const activeTab =
    target && !drafts.data?.some((d) => d.id === target) && tab === 'drafts' ? 'shift' : tab;
  useEffect(() => {
    if (target && drafts.data)
      document.getElementById('draft-' + target)?.scrollIntoView({ block: 'start' });
  }, [target, drafts.data]);
  async function discover(kind: string, portalId = portal, projectId = '') {
    const query = new URLSearchParams({
      kind,
      ...(portalId ? { portalId } : {}),
      ...(projectId ? { projectId } : {}),
    });
    return (await api<Discovery>('/zoho/discover?' + query)).items;
  }
  const loadProject = async (projectId: string, kind = module) => {
    setProject(projectId);
    setTask('');
    setOwner('');
    setTasks([]);
    setUsers([]);
    const version = ++sequence.current;
    if (!projectId) return;
    await action.execute(async () => {
      const [people, items] = await Promise.all([
        discover('users', portal, projectId),
        kind === 'general'
          ? Promise.resolve([])
          : discover(kind === 'issue' ? 'issues' : 'tasks', portal, projectId),
      ]);
      if (version === sequence.current) {
        setUsers(people);
        setTasks(items);
      }
    });
  };
  const logs = drafts.data
    ?.filter((d) => d.kind === 'TIME_LOG')
    .sort((a, b) =>
      a.id === s.targetId ? -1 : b.id === s.targetId ? 1 : b.createdAt - a.createdAt,
    );
  async function editDraft(draft: ExternalDraft) {
    if (draft.autoApproval?.status === 'SCHEDULED') {
      const paused = await action.execute(() =>
        post<ExternalDraft>('/external-drafts/' + draft.id + '/timer', {
          version: draft.version,
          scopeHash: draft.scopeHash,
          paused: true,
          editing: true,
        }),
      );
      if (!paused) return;
      draft = paused;
      await drafts.refresh();
    }
    setTab('manual');
    const p = draft.payload as TimeLogPayload;
    const version = ++sequence.current;
    await action.execute(async () => {
      const [portalItems, projectItems, userItems, taskItems] = await Promise.all([
        discover('portals', ''),
        discover('projects', p.portalId),
        discover('users', p.portalId, p.projectId),
        p.module === 'general'
          ? Promise.resolve([])
          : discover(p.module === 'issue' ? 'issues' : 'tasks', p.portalId, p.projectId),
      ]);
      if (version !== sequence.current) return;
      setPortals(portalItems);
      setProjects(projectItems);
      setUsers(userItems);
      setTasks(taskItems);
      setPortal(p.portalId);
      setProject(p.projectId);
      setOwner(p.ownerId);
      setTask(p.taskId || '');
      setCategory(p.category);
      setModule(p.module);
      setProposal(p.proposalStage);
      setProjectNumber(p.projectNumber);
      setDate(p.date);
      setDuration(String(p.durationMinutes));
      setStart(p.startTime || '');
      setEnd(p.endTime || '');
      setBilling(p.billing);
      setDescription(p.description);
      setConfirmed(false);
      setEditing(draft);
      document.getElementById('time-log-form')?.scrollIntoView({ block: 'start' });
    });
  }
  return (
    <div className="panel-content">
      <h2>Time logs</h2>
      <nav className="panel-tabs" aria-label="Time log workflow">
        {[
          ['dates', 'Check dates'],
          ['shift', 'After shift'],
          ['manual', 'Manual entry'],
          ['drafts', 'Drafts'],
        ].map(([id, label]) => (
          <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <TimeApprovalSettings
        error={policy.error}
        policy={policy.data || undefined}
        refresh={async () => {
          await Promise.all([drafts.refresh(), policy.refresh()]);
        }}
      />
      {activeTab === 'dates' && <TimeAudit reviewShift={() => setTab('shift')} />}
      {activeTab === 'shift' && <ShiftPlanning refreshDrafts={drafts.refresh} />}
      {activeTab === 'manual' && (
        <>
          <p>
            Record actual work. If automatic approval is on, saved drafts get a 30-minute review
            window.
          </p>
          <div className="work-actions">
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() =>
                action.execute(async () => {
                  setPortals(await discover('portals', ''));
                })
              }
            >
              Load my Zoho portals
            </button>
            <button className="text-button" onClick={() => s.open('connections')}>
              Connect Zoho
            </button>
          </div>
          <form
            id="time-log-form"
            className="stacked-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await action.execute(() => {
                const payload = {
                  portalId: portal,
                  projectId: project,
                  ownerId: owner,
                  category,
                  projectNumber,
                  proposalStage: proposal,
                  module,
                  ...(module !== 'general' && task ? { taskId: task } : {}),
                  date,
                  durationMinutes: Number(duration),
                  ...(start || end ? { startTime: start, endTime: end } : {}),
                  billing,
                  description,
                  workConfirmed: confirmed,
                };
                return editing
                  ? api('/external-drafts/' + editing.id, {
                      method: 'PUT',
                      body: JSON.stringify({ version: editing.version, payload }),
                    })
                  : post('/timelogs/drafts', payload);
              }, 'Time log saved for review');
              if (result) {
                setConfirmed(false);
                setEditing(null);
                await drafts.refresh();
              }
            }}
          >
            <label>
              Portal
              <select
                aria-label="Portal"
                required
                value={portal}
                onChange={async (e) => {
                  const id = e.target.value;
                  ++sequence.current;
                  setPortal(id);
                  setProject('');
                  setProjects([]);
                  setTasks([]);
                  setUsers([]);
                  if (id)
                    await action.execute(async () => {
                      const list = await discover('projects', id);
                      if (id === e.target.value) setProjects(list);
                    });
                }}
              >
                <option value="">Choose a portal</option>
                {portals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Work category
              <select
                aria-label="Work category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as TimeLogPayload['category']);
                  setProject('');
                  setTask('');
                  setUsers([]);
                  setTasks([]);
                }}
              >
                <option value="PROJECT">Approved numbered project</option>
                <option value="GENERAL">SIN_TecSurge_General</option>
                <option value="BUSINESS_DEVELOPMENT">SIN_TecSurge_BusinessDevelopment</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={proposal}
                onChange={(e) => {
                  setProposal(e.target.checked);
                  if (e.target.checked) {
                    setCategory('BUSINESS_DEVELOPMENT');
                    setProject('');
                  }
                }}
              />
              <span>This work is proposal-stage prototyping, before project approval.</span>
            </label>
            <label>
              Project
              <select
                aria-label="Project"
                required
                value={project}
                onChange={(e) => void loadProject(e.target.value)}
              >
                <option value="">Choose a live project</option>
                {projects
                  .filter((p) => {
                    const key = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return category === 'GENERAL'
                      ? key === 'sintecsurgegeneral'
                      : category === 'BUSINESS_DEVELOPMENT'
                        ? key === 'sintecsurgebusinessdevelopment'
                        : key !== 'sintecsurgegeneral' && key !== 'sintecsurgebusinessdevelopment';
                  })
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            {category === 'PROJECT' && (
              <label>
                Approved project number
                <input
                  required
                  value={projectNumber}
                  onChange={(e) => setProjectNumber(e.target.value)}
                  placeholder="e.g. 20260109"
                />
              </label>
            )}
            <label>
              Log type
              <select
                aria-label="Log type"
                value={module}
                onChange={(e) => {
                  const value = e.target.value as TimeLogPayload['module'];
                  setModule(value);
                  void loadProject(project, value);
                }}
              >
                <option value="task">Task</option>
                <option value="issue">Issue</option>
                <option value="general">General entry within selected project</option>
              </select>
            </label>
            {module !== 'general' && (
              <label>
                {module === 'task' ? 'Task' : 'Issue'}
                <select required value={task} onChange={(e) => setTask(e.target.value)}>
                  <option value="">Choose a live {module}</option>
                  {tasks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              My Zoho user
              <select
                aria-label="My Zoho user"
                required
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              >
                <option value="">Choose yourself; no user is assumed</option>
                {users.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.email ? ' · ' + p.email : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-pair">
              <label>
                Work date
                <input
                  required
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Minutes worked
                <input
                  required
                  type="number"
                  min={1}
                  max={1440}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </label>
            </div>
            <div className="form-pair">
              <label>
                Start time (optional)
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label>
                End time (optional)
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <p className="microcopy">
              Dates and times use Asia/Manila. Confirm time actually worked; email timestamps do not
              determine duration.
            </p>
            <label>
              Billing
              <select
                aria-label="Billing"
                value={billing}
                onChange={(e) => setBilling(e.target.value as TimeLogPayload['billing'])}
              >
                <option value="Non Billable">Non Billable</option>
                <option value="Billable">Billable</option>
              </select>
            </label>
            <label>
              Work performed
              <textarea
                required
                rows={4}
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input
                required
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                I confirm this work occurred and these hours, project stage, billing and user are
                correct.
              </span>
            </label>
            <ErrorText error={action.error || drafts.error} />
            <Submit busy={action.busy} disabled={!confirmed || !project || !owner}>
              {editing ? 'Save revised time log for approval' : 'Save time log for approval'}
            </Submit>
          </form>
          <button
            className="text-button"
            disabled={action.busy || !portal || !owner || !date}
            onClick={() =>
              action.execute(async () => {
                const value = await api<{ items: RemoteTimeLog[] }>(
                  '/zoho/timelogs?' +
                    new URLSearchParams({ portalId: portal, ownerId: owner, date }),
                );
                setHistory(value.items);
              })
            }
          >
            Check my existing Zoho logs for this date
          </button>
          {history && (
            <section>
              <h3>Existing Zoho entries</h3>
              {history.length ? (
                history.map((log) => (
                  <p key={log.id}>
                    {log.date} · {log.projectName} · {log.minutes ?? 'Unrecognized duration'} min ·{' '}
                    {log.description}
                  </p>
                ))
              ) : (
                <p>No entries were returned for that user and date.</p>
              )}
            </section>
          )}
        </>
      )}
      {(activeTab === 'drafts' || activeTab === 'shift') && (
        <>
          <h3>Saved drafts and receipts</h3>
          <label className="search-box">
            <input
              type="search"
              aria-label="Search time logs"
              placeholder="Search date, project, description or status"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {!logs?.length && <p>No local time-log drafts yet.</p>}
          {logs
            ?.filter((d) => {
              const p = d.payload as TimeLogPayload;
              return matchesSearch(query, p.date, p.projectName, p.description, d.state);
            })
            .map((draft, index) => (
              <InboxGroup
                key={draft.id}
                title={
                  (draft.payload as TimeLogPayload).date +
                  ' · ' +
                  (draft.payload as TimeLogPayload).projectName
                }
                description={
                  draft.state === 'DRAFT'
                    ? draft.autoApproval?.status === 'SCHEDULED' && policy.data?.enabled
                      ? '30-minute approval window'
                      : 'Waiting for review'
                    : draft.state.replaceAll('_', ' ').toLowerCase()
                }
                count={
                  ((draft.payload as TimeLogPayload).durationMinutes / 60).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 },
                  ) + ' h'
                }
                initiallyOpen={index === 0}
                forceOpen={draft.id === target || !!query.trim()}
              >
                <div key={draft.id + ':' + draft.version + ':' + draft.state}>
                  {['DRAFT', 'FAILED'].includes(draft.state) && (
                    <button
                      className="text-button"
                      disabled={action.busy}
                      onClick={() => void editDraft(draft)}
                    >
                      Edit time-log details
                    </button>
                  )}
                  <ExternalDraftReview
                    draft={draft}
                    timePolicy={policy.data || undefined}
                    refresh={drafts.refresh}
                  />
                </div>
              </InboxGroup>
            ))}
        </>
      )}
    </div>
  );
}
