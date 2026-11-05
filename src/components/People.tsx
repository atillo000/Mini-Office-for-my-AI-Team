import { useState } from 'react';
import { Search, Plus, ArrowRight, MapPin, Pencil, Trash2 } from 'lucide-react';
import { useOffice } from '../store';
import { api } from '../api';
import { rooms } from '../../shared/seed';
import { Portrait, Status, Empty, ErrorText, Submit, useAction, post } from './common';
import { Chat } from './Chat';
import { Assignment } from './Projects';
import { ModelDiscussion } from './ModelDiscussion';
import OfficeActivity from './OfficeActivity';

export function EmployeePanel({ id }: { id: string }) {
  const e = useOffice((s) => s.employees.find((e) => e.id === id));
  const runtime = useOffice((s) => s.runtime[id]);
  const jobs = (useOffice((s) => s.snapshot?.jobs) || []).filter(
    (j) => j.kind !== 'content-ideas' && j.kind !== 'assistant-chat' && j.kind !== 'communication-review' && j.kind !== 'shift-review',
  );
  const s = useOffice();
  const [tab, setTab] = useState('chat');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(e?.name || '');
  const action = useAction();
  if (!e) return <Empty title="Teammate not found" />;
  const assigned = jobs.filter((j) => j.agentId === e.id);
  const executing = jobs.filter(
    (j) =>
      ['QUEUED', 'PLANNING', 'RUNNING', 'TESTING', 'VERIFYING'].includes(j.state) &&
      (j.agentId === id ||
        j.subtasks.some((t) => t.agentId === id && t.status === 'running') ||
        (id === 'sarah' && j.state === 'PLANNING')),
  );
  const colleagues = [
    ...new Set(
      jobs
        .filter((j) => j.subtasks.some((t) => t.agentId === id))
        .flatMap((j) => j.subtasks.map((t) => t.agentId)),
    ),
  ].filter((other) => other !== id);
  return (
    <div className="panel-content">
      <span className="eyebrow">A FACE BEHIND THE IDEAS</span>
      <div className="employee-header">
        <Portrait id={id} />
        <div>
          <h2>{e.name}</h2>
          <p>{e.role}</p>
          <OfficeActivity runtime={runtime} />
        </div>
        <button
          title="Edit teammate"
          aria-label="Edit teammate"
          onClick={() => setEditing(!editing)}
        >
          <Pencil size={14} />
        </button>
      </div>
      <div className="execution-separation" data-testid="execution-status">
        <span>REAL CODING JOBS</span>
        {executing.length ? (
          executing.map((j) => (
            <div key={j.id}>
              <strong>{j.title}</strong>
              <Status state={j.state} />
            </div>
          ))
        ) : (
          <p>No coding job running</p>
        )}
        <small>Activity is based on real jobs; actions wait for your approval.</small>
      </div>
      {editing && (
        <form
          className="inline-edit"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.execute(
              () =>
                api(`/employees/${id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ name }),
                }),
              'Teammate updated',
            );
            setEditing(false);
          }}
        >
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
            />
          </label>
          <Submit busy={action.busy}>Save name</Submit>
          <button
            className="text-danger"
            type="button"
            onClick={async () => {
              const result = await action.execute(
                () => api(`/employees/${id}`, { method: 'DELETE' }),
                'Teammate removed',
              );
              if (result) s.select(null);
            }}
          >
            <Trash2 size={12} />
            Remove teammate
          </button>
          <ErrorText error={action.error} />
        </form>
      )}
      <div className="employee-location">
        <MapPin size={12} />
        {rooms.find((r) => r.id === (runtime?.room || e.room))?.name}
        <span>·</span>
        {e.department}
        <button onClick={() => s.focus(runtime?.room || e.room)}>
          Visit
          <ArrowRight size={11} />
        </button>
      </div>
      <div className="panel-tabs">
        {['chat', 'task', 'about'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'task'
              ? 'Assign a task'
              : t === 'day'
                ? 'Their day'
                : t === 'about'
                  ? 'Profile'
                  : 'Say hello'}
          </button>
        ))}
      </div>
      {tab === 'chat' && (
        <>
          <Chat channel={id} />
          <ModelDiscussion employeeId={id} />
        </>
      )}
      {tab === 'task' && <Assignment employeeId={id} />}
      {tab === 'about' && (
        <div className="profile-details">
          <div className="detail-block">
            <span className="eyebrow">PERSONALITY</span>
            <p>{e.personality}</p>
          </div>
          <div className="detail-block">
            <span className="eyebrow">COMMUNICATION STYLE</span>
            <p>{e.style}</p>
          </div>
          <div className="profile-stats">
            <div>
              <strong>{assigned.length}</strong>
              <span>Assigned tasks</span>
            </div>
            <div>
              <strong>{assigned.filter((j) => j.state === 'COMPLETED').length}</strong>
              <span>Accepted results</span>
            </div>
            <div>
              <strong>{assigned.filter((j) => j.state === 'REVIEW').length}</strong>
              <span>For your review</span>
            </div>
          </div>
          <div className="detail-block">
            <span className="eyebrow">PROJECTS</span>
            <p>
              {[
                ...new Set(
                  assigned
                    .map((j) => s.snapshot?.projects.find((p) => p.id === j.projectId)?.name)
                    .filter(Boolean),
                ),
              ].join(', ') || 'No project assignments yet'}
            </p>
          </div>
          <div className="detail-block">
            <span className="eyebrow">COLLABORATORS FROM SAVED JOBS</span>
            <p>
              {colleagues.map((id) => s.employees.find((e) => e.id === id)?.name).join(', ') ||
                'Collaboration grows as the team works together.'}
            </p>
          </div>
          <p className="microcopy">Performance is based on actual saved jobs.</p>
        </div>
      )}
    </div>
  );
}
export function TeamPanel() {
  const employees = useOffice((s) => s.employees);
  const runtime = useOffice((s) => s.runtime);
  const select = useOffice((s) => s.select);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const action = useAction();
  return (
    <div className="panel-content">
      <span className="eyebrow">THE HEART OF THE COMPANY</span>
      <h2>Your people</h2>
      <p>Nine perspectives to start. One shared possibility.</p>
      <label className="search-box">
        <Search size={14} />
        <input
          placeholder="Find a teammate or a role"
          aria-label="Find teammate"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="directory">
        {employees
          .filter((e) => `${e.name} ${e.role}`.toLowerCase().includes(search.toLowerCase()))
          .map((e) => (
            <button key={e.id} onClick={() => select(e.id)}>
              <Portrait id={e.id} />
              <div>
                <strong>{e.name}</strong>
                <small>{e.role}</small>
                <OfficeActivity runtime={runtime[e.id]} />
              </div>
              <ArrowRight size={15} />
            </button>
          ))}
      </div>
      <button className="button secondary full" onClick={() => setAdding(!adding)}>
        <Plus size={14} />
        Welcome a new teammate
      </button>
      {adding && (
        <form
          className="stacked-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await action.execute(
              () =>
                post('/employees', {
                  name,
                  role,
                  department: 'Engineering',
                  personality: 'Curious, thoughtful, collaborative',
                  style: 'Clear and helpful',
                }),
              'A new teammate joined the office',
            );
            if (result) {
              setAdding(false);
              setName('');
              setRole('');
            }
          }}
        >
          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Role
            <input required value={role} onChange={(e) => setRole(e.target.value)} />
          </label>
          <ErrorText error={action.error} />
          <Submit busy={action.busy}>Add teammate</Submit>
        </form>
      )}
    </div>
  );
}
