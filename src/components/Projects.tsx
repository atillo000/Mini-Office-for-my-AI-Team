import { useState } from 'react';
import {
  Plus,
  GitBranch,
  ArrowDown,
  Play,
  Square,
  Check,
  RotateCcw,
  FileCode,
  Terminal,
  FolderOpen,
  ExternalLink,
} from 'lucide-react';
import { api, token } from '../api';
import { useOffice } from '../store';
import type { Job, Project } from '../../shared/types';
import { Empty, ErrorText, Submit, useAction, post, Status, dateTime } from './common';
import { MemoryChoice } from './StartHere';
export function Assignment({ employeeId }: { employeeId?: string }) {
  const s = useOffice();
  const [agentId, setAgentId] = useState(employeeId || 'sarah');
  const [projectId, setProjectId] = useState(s.snapshot?.projects[0]?.id || '');
  const [instruction, setInstruction] = useState('');
  const [useWorkMemory, setUseWorkMemory] = useState(false);
  const action = useAction();
  return (
    <form
      className="stacked-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await action.execute(
          () => post('/jobs', { agentId, projectId, instruction, useWorkMemory }),
          'Task saved. Review and approve it in Projects.',
        );
        if (result) {
          setInstruction('');
          s.open('projects');
        }
      }}
    >
      <label>
        Who should lead?
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {s.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.role}
            </option>
          ))}
        </select>
      </label>
      <label>
        Project workspace
        <select required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Choose a connected project</option>
          {s.snapshot?.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {!s.snapshot?.projects.length && (
        <button type="button" className="text-button" onClick={() => s.open('projects')}>
          Connect your first project
          <ExternalLink size={12} />
        </button>
      )}
      <label>
        What would you like to build?
        <textarea
          required
          rows={5}
          placeholder="Alex, build the authentication API for our inventory system…"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={12000}
        />
      </label>
      <p className="microcopy">
        Saving creates a draft. Execution requires your approval and an available isolated Codex
        runner.
      </p>
      <MemoryChoice checked={useWorkMemory} onChange={setUseWorkMemory} />
      <ErrorText error={action.error} />
      <Submit busy={action.busy} disabled={!projectId}>
        Create task for review
      </Submit>
    </form>
  );
}
function ConnectProject({ done }: { done: () => void }) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [tests, setTests] = useState<Project['testCommand']>('auto');
  const [approved, setApproved] = useState(false);
  const action = useAction();
  return (
    <form
      className="stacked-form connect-project"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await action.execute(
          () => post('/projects', { name, path, approved, testCommand: tests }),
          'Project connected',
        );
        if (result) done();
      }}
    >
      <h3>Connect project</h3>
      <label>
        Project name
        <input
          placeholder="Inventory system"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Absolute path to an existing Git repository
        <input
          placeholder="D:\Projects\inventory"
          required
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </label>
      <label>
        Approved test command
        <select value={tests} onChange={(e) => setTests(e.target.value as Project['testCommand'])}>
          <option value="auto">Detect project tests</option>
          <option value="none">Tests disabled (completion blocked)</option>
          <option value="npm-test">npm test</option>
          <option value="node-test">node --test</option>
        </select>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={approved}
          onChange={(e) => setApproved(e.target.checked)}
          required
        />
        <span>
          I approve this repository as a source. Each execution stage requires my approval.
        </span>
      </label>
      <p className="microcopy">
        Only committed files are exported. Uncommitted changes are excluded. Tests execute project
        code in a separate container.
      </p>
      <ErrorText error={action.error} />
      <Submit busy={action.busy} disabled={!approved}>
        Connect approved workspace
      </Submit>
    </form>
  );
}
function JobDetail({ job }: { job: Job }) {
  const s = useOffice();
  const action = useAction();
  const [tab, setTab] = useState(
    ['REVIEW', 'COMPLETED', 'UNVERIFIED', 'FAILED'].includes(job.state) ? 'report' : 'plan',
  );
  const [diff, setDiff] = useState('');
  const [allowInstall, setAllowInstall] = useState(false);
  const ready = s.snapshot?.codex.executionReady;
  const download = (file: string) =>
    action.execute(async () => {
      const response = await fetch(`/api/jobs/${job.id}/artifacts/${file}`, {
        headers: token() ? { Authorization: `Bearer ${token()}` } : {},
      });
      if (!response.ok) throw new Error('Artifact download failed');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = file;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const act = (name: string) =>
    action.execute(
      () =>
        post(`/jobs/${job.id}/${name}`, {
          requestId: job.approvalRequest?.id,
          scopeHash: job.approvalRequest?.scopeHash,
          allowDependencyInstall: allowInstall,
        }),
      name === 'accept'
        ? 'Report accepted. Changes remain in the isolated workspace.'
        : 'Task updated',
    );
  return (
    <div className="job-detail">
      <div className="job-heading">
        <span className="section-label">
          {job.id.slice(0, 8)} · {dateTime(job.createdAt)}
        </span>
        <Status state={job.state} />
      </div>
      <h3>{job.title}</h3>
      <p className="job-instruction">{job.instruction}</p>
      {job.memory && (
        <details>
          <summary>Shared work context · profile v{job.memory.profile?.version}</summary>
          <p>{job.memory.profile?.about}</p>
          <p>{job.memory.profile?.goals}</p>
          <p>{job.memory.projects.map((p) => p.name).join(', ') || 'No linked work projects'}</p>
        </details>
      )}
      {job.state === 'AWAITING_APPROVAL' && job.approvalRequest && (
        <section className="approval-review" aria-label="CEO approval">
          <h4>
            {job.approvalRequest.kind === 'implementation'
              ? 'Review plan'
              : 'Review test execution'}
          </h4>
          <p>{job.approvalRequest.kind === 'implementation' ? job.result : job.testPlan?.label}</p>
          {job.testPlan && (
            <pre className="report-text">
              {Object.entries(job.testPlan.scripts)
                .map(([key, script]) => `${key}: ${script}`)
                .join('\n')}
            </pre>
          )}
          <p className="microcopy">{job.approvalRequest.summary}</p>
          {job.approvalRequest.kind === 'tests' && job.testPlan?.needsInstall && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={allowInstall}
                onChange={(e) => setAllowInstall(e.target.checked)}
              />
              Allow locked npm dependency downloads without install scripts
            </label>
          )}
          <button
            className="button primary"
            disabled={
              action.busy ||
              !ready ||
              (job.approvalRequest.kind === 'tests' && job.testPlan?.needsInstall && !allowInstall)
            }
            onClick={() =>
              act(job.approvalRequest?.kind === 'implementation' ? 'approve-plan' : 'approve-tests')
            }
          >
            Approve {job.approvalRequest.kind === 'implementation' ? 'implementation' : 'tests'}
          </button>
        </section>
      )}
      <div className="job-actions">
        {job.state === 'DRAFT' && (
          <button
            className="button primary"
            disabled={action.busy || !ready}
            onClick={() => act('approve')}
          >
            <Play size={13} />
            Approve planning
          </button>
        )}
        {['FAILED', 'CANCELLED', 'INTERRUPTED', 'UNVERIFIED'].includes(job.state) && (
          <button
            className="button secondary"
            disabled={action.busy || !ready || job.attempts >= 3}
            onClick={() => act('retry')}
          >
            <RotateCcw size={13} />
            Approve retry ({job.attempts}/3)
          </button>
        )}
        {[
          'DRAFT',
          'QUEUED',
          'PLANNING',
          'RUNNING',
          'TESTING',
          'VERIFYING',
          'AWAITING_APPROVAL',
        ].includes(job.state) && (
          <button className="button secondary" disabled={action.busy} onClick={() => act('cancel')}>
            <Square size={12} />
            Cancel
          </button>
        )}
        {job.state === 'REVIEW' && (
          <button className="button primary" disabled={action.busy} onClick={() => act('accept')}>
            <Check size={14} />
            Accept verified result
          </button>
        )}
      </div>
      {!ready && ['DRAFT', 'FAILED', 'INTERRUPTED'].includes(job.state) && (
        <p className="microcopy">
          {s.snapshot?.codex.detail} See Settings and README for execution setup.
        </p>
      )}
      <ErrorText error={action.error} />
      <div className="panel-tabs">
        {['plan', 'report', 'logs', 'diff'].map((t) => (
          <button
            className={tab === t ? 'active' : ''}
            key={t}
            onClick={async () => {
              setTab(t);
              if (t === 'diff')
                await action.execute(async () => {
                  const data = await api<{ diff: string; status?: string }>(`/jobs/${job.id}/diff`);
                  setDiff(`${data.status || ''}\n${data.diff}`);
                });
            }}
          >
            {t === 'diff' ? <FileCode size={12} /> : t === 'logs' ? <Terminal size={12} /> : null}
            {t}
          </button>
        ))}
      </div>
      {tab === 'plan' &&
        (!job.subtasks.length ? (
          <Empty title={job.state === 'DRAFT' ? 'Ready when you are' : 'No plan saved yet'}>
            Sarah’s real analysis will appear after an approved execution starts.
          </Empty>
        ) : (
          <div className="dependency-flow">
            {job.subtasks.map((t, i) => (
              <div key={t.id}>
                {i > 0 && <ArrowDown className="flow-arrow" size={15} />}
                <article className={`subtask ${t.status}`}>
                  <div>
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    <strong>
                      {s.employees.find((e) => e.id === t.agentId)?.name || t.agentId}
                    </strong>
                    <Status state={t.status} />
                  </div>
                  <p>{t.title}</p>
                  {t.dependsOn.length > 0 && <small>Depends on: {t.dependsOn.join(', ')}</small>}
                </article>
              </div>
            ))}
          </div>
        ))}
      {tab === 'report' && (
        <>
          <pre className="report-text">{job.result}</pre>
          {job.evidence && (
            <div className="evidence-summary">
              <strong>{job.evidence.verified ? 'Verified artifacts' : 'Unverified result'}</strong>
              <p>
                {job.evidence.changes.length} changed files · {job.evidence.tests.count} tests ·{' '}
                {job.evidence.tests.status}
              </p>
              <code title={job.evidence.sourceDigest}>
                Source SHA-256: {job.evidence.sourceDigest.slice(0, 16)}…
              </code>
              <ul>
                {job.evidence.changes.map((file) => (
                  <li key={file.path}>
                    <code>
                      {file.change}: {file.path}
                    </code>
                  </li>
                ))}
              </ul>
              {[
                'tested.patch',
                'tested.json',
                'tested.tar.gz',
                'tests.json',
                'approvals.json',
                'logs.jsonl',
                'execution-policy.json',
                'planning-run.json',
                ...job.subtasks.map((_, index) => `run-${index}.json`),
              ].map((file) => (
                <button className="text-button" key={file} onClick={() => download(file)}>
                  {file}
                </button>
              ))}
            </div>
          )}
          {job.subtasks
            .filter((t) => t.result)
            .map((t) => (
              <details key={t.id}>
                <summary>
                  {s.employees.find((e) => e.id === t.agentId)?.name || t.agentId} · employee report
                </summary>
                <pre className="report-text">{t.result}</pre>
              </details>
            ))}
          <span className="section-label">SAVED TEST RESULT</span>
          <pre className="log-view">{job.testResult}</pre>
          {job.workspace && (
            <div className="workspace-path">
              <FolderOpen size={13} />
              <code>{job.workspace}</code>
            </div>
          )}
        </>
      )}
      {tab === 'logs' && (
        <>
          {job.attempts > 0 && (
            <button className="text-button" onClick={() => download('logs.jsonl')}>
              Download full log
            </button>
          )}
          <pre className="log-view">
            {job.logs.length
              ? job.logs.map((l) => `[${new Date(l.at).toLocaleTimeString()}] ${l.text}`).join('\n')
              : 'No execution logs. This job has not started.'}
          </pre>
        </>
      )}
      {tab === 'diff' && <pre className="log-view">{diff || 'Loading workspace diff…'}</pre>}
    </div>
  );
}
export function ProjectsPanel() {
  const s = useOffice();
  const [connecting, setConnecting] = useState(false);
  const [selected, setSelected] = useState<string | null>(s.targetId);
  const [filter, setFilter] = useState('all');
  const action = useAction();
  const projects = s.snapshot?.projects || [];
  const jobs = (s.snapshot?.jobs || []).filter((j) => j.kind !== 'content-ideas' && j.kind !== 'assistant-chat' && j.kind !== 'communication-review');
  const selectedJob = jobs.find((j) => j.id === selected);
  return (
    <div className="panel-content">
      <h2>Projects</h2>
      <div className="project-list">
        {projects.map((p) => (
          <div className="project-row" key={p.id}>
            <span className="project-symbol">
              <GitBranch size={18} />
            </span>
            <button
              className="project-info"
              onClick={() => setFilter(filter === p.id ? 'all' : p.id)}
            >
              <strong>{p.name}</strong>
              <small title={p.path}>{p.path}</small>
            </button>
            <span className="approved-pill">Approved</span>
            <button
              className="disconnect"
              title="Disconnect project"
              aria-label={`Disconnect ${p.name}`}
              onClick={() =>
                action.execute(
                  () => api(`/projects/${p.id}`, { method: 'DELETE' }),
                  'Project disconnected',
                )
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <ErrorText error={action.error} />
      <button className="button secondary full" onClick={() => setConnecting(!connecting)}>
        <Plus size={14} />
        {connecting ? 'Close connection form' : 'Connect a project'}
      </button>
      {connecting && <ConnectProject done={() => setConnecting(false)} />}
      {!projects.length && !connecting && (
        <Empty title="No projects">
          Connect a local Git repository, then give your team their first task.
        </Empty>
      )}
      {projects.length > 0 && (
        <>
          <div className="section-heading inner">
            <h3>
              Development tasks <span>{jobs.length}</span>
            </h3>
            <button onClick={() => s.open('assign')}>
              <Plus size={12} />
              New task
            </button>
          </div>
          {filter !== 'all' && (
            <button className="text-button" onClick={() => setFilter('all')}>
              Show all projects
            </button>
          )}
          {!jobs.length && (
            <Empty title="No tasks">Your tasks and real execution results will live here.</Empty>
          )}
          <div className="job-list">
            {jobs
              .filter((j) => filter === 'all' || j.projectId === filter)
              .toReversed()
              .map((j) => (
                <button
                  className={selected === j.id ? 'selected' : ''}
                  key={j.id}
                  onClick={() => setSelected(selected === j.id ? null : j.id)}
                >
                  <div>
                    <strong>{j.title}</strong>
                    <small>
                      {projects.find((p) => p.id === j.projectId)?.name} ·{' '}
                      {s.employees.find((e) => e.id === j.agentId)?.name}
                    </small>
                  </div>
                  <Status state={j.state} />
                </button>
              ))}
          </div>
        </>
      )}
      {selectedJob && (
        <JobDetail
          key={`${selectedJob.id}-${selectedJob.approvalRequest?.id || ''}`}
          job={selectedJob}
        />
      )}
    </div>
  );
}
