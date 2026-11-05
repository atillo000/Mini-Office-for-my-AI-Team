import { useState, type ReactNode } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useOffice } from '../store';
import {
  classifications,
  projectRoles,
  type KnowledgeProject,
  type WorkRecord,
  type WorkRule,
  type ZohoMapping,
  type WorkSnapshot,
  type LearningRecord,
  type WorkClassification,
} from '../../shared/work';
import { Empty, ErrorText, dateTime } from './common';
import { useResource } from './useResource';
const words = (value: FormDataEntryValue | null) =>
  String(value || '')
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
const optional = (value: FormDataEntryValue | null) => String(value || '').trim() || undefined;
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');
type Save = (url: string, data: unknown, method?: string) => Promise<boolean>;
function Field({
  title,
  name,
  value = '',
  multiline = false,
  required = false,
  type = 'text',
}: {
  title: string;
  name: string;
  value?: string | number;
  multiline?: boolean;
  required?: boolean;
  type?: string;
}) {
  return (
    <label>
      {title}
      {multiline ? (
        <textarea name={name} rows={3} defaultValue={value} required={required} maxLength={12000} />
      ) : (
        <input name={name} defaultValue={value} required={required} type={type} maxLength={4000} />
      )}
    </label>
  );
}
function ProjectSelect({
  projects,
  name = 'projectId',
  title = 'Work project',
  value = '',
  required = false,
}: {
  projects: KnowledgeProject[];
  name?: string;
  title?: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <label>
      {title}
      <select aria-label={title} name={name} defaultValue={value} required={required}>
        <option value="">Not assigned</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function FormButtons({
  busy,
  cancel,
  children = 'Save',
}: {
  busy: boolean;
  cancel: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="work-actions">
      <button className="button primary" disabled={busy}>
        {children}
      </button>
      <button type="button" className="button secondary" onClick={cancel} disabled={busy}>
        Cancel
      </button>
    </div>
  );
}
function editPayload(value: { id: string; version: number } | null, data: unknown) {
  return value ? { version: value.version, data } : data;
}
function ProjectEditor({
  project,
  save,
  busy,
  done,
}: {
  project: KnowledgeProject | null;
  save: Save;
  busy: boolean;
  done: () => void;
}) {
  const repositories = useOffice((s) => s.snapshot?.projects) || [];
  return (
    <form
      className="stacked-form work-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget);
        const data = {
          name: f.get('name'),
          aliases: words(f.get('aliases')),
          department: f.get('department'),
          description: f.get('description'),
          role: f.get('role'),
          stakeholders: words(f.get('stakeholders')),
          applications: words(f.get('applications')),
          technologies: words(f.get('technologies')),
          status: f.get('status'),
          responsibilities: words(f.get('responsibilities')),
          repositoryId: optional(f.get('repositoryId')),
        };
        if (
          await save(
            `/work/projects${project ? '/' + project.id : ''}`,
            editPayload(project, data),
            project ? 'PUT' : 'POST',
          )
        )
          done();
      }}
    >
      <h3>{project ? 'Edit work project' : 'New work project'}</h3>
      <Field title="Project name" name="name" value={project?.name} required />
      <Field title="Aliases (comma-separated)" name="aliases" value={project?.aliases.join(', ')} />
      <label>
        My role
        <select aria-label="My role" name="role" defaultValue={project?.role || 'OBSERVER'}>
          {projectRoles.map((role) => (
            <option key={role} value={role}>
              {label(role)}
            </option>
          ))}
        </select>
      </label>
      <Field title="Client or department" name="department" value={project?.department} />
      <Field title="Description" name="description" value={project?.description} multiline />
      <details>
        <summary>Responsibilities and context</summary>
        <Field
          title="Stakeholders (comma-separated)"
          name="stakeholders"
          value={project?.stakeholders.join(', ')}
        />
        <Field
          title="Applications (comma-separated)"
          name="applications"
          value={project?.applications.join(', ')}
        />
        <Field
          title="Technologies (comma-separated)"
          name="technologies"
          value={project?.technologies.join(', ')}
        />
        <Field
          title="Responsibilities (one per line)"
          name="responsibilities"
          value={project?.responsibilities.join('\n')}
          multiline
        />
        <label>
          Linked coding repository
          <select
            aria-label="Linked coding repository"
            name="repositoryId"
            defaultValue={project?.repositoryId || ''}
          >
            <option value="">None</option>
            {repositories.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </details>
      <label>
        Project status
        <select
          aria-label="Project status"
          name="status"
          defaultValue={project?.status || 'ACTIVE'}
        >
          {['ACTIVE', 'PAUSED', 'COMPLETE', 'ARCHIVED'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <FormButtons busy={busy} cancel={done}>
        Save project
      </FormButtons>
    </form>
  );
}
function MappingEditor({
  mapping,
  projects,
  save,
  busy,
  done,
}: {
  mapping: ZohoMapping | null;
  projects: KnowledgeProject[];
  save: Save;
  busy: boolean;
  done: () => void;
}) {
  return (
    <form
      className="stacked-form work-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget);
        const data = {
          knowledgeProjectId: f.get('knowledgeProjectId'),
          activityName: f.get('activityName'),
          routingCategory: f.get('routingCategory'),
          projectNumber: f.get('projectNumber'),
          portalId: optional(f.get('portalId')),
          projectId: optional(f.get('projectId')),
          taskId: optional(f.get('taskId')),
          issueId: optional(f.get('issueId')),
          module: f.get('module'),
          billing: f.get('billing'),
          approvedDescriptions: words(f.get('approvedDescriptions')),
          note: f.get('note'),
          confirmed: f.get('confirmed') === 'on',
        };
        if (
          await save(
            `/work/mappings${mapping ? '/' + mapping.id : ''}`,
            editPayload(mapping, data),
            mapping ? 'PUT' : 'POST',
          )
        )
          done();
      }}
    >
      <h3>{mapping ? 'Edit Zoho mapping' : 'New Zoho mapping'}</h3>
      <ProjectSelect
        projects={projects}
        name="knowledgeProjectId"
        value={mapping?.knowledgeProjectId}
        required
      />
      <Field title="Activity name" name="activityName" value={mapping?.activityName} required />
      <Field title="Portal ID" name="portalId" value={mapping?.portalId} />
      <Field title="Zoho project ID" name="projectId" value={mapping?.projectId} />
      <label>
        Time-log category
        <select
          name="routingCategory"
          aria-label="Time-log category"
          defaultValue={mapping?.routingCategory || 'NEEDS_REVIEW'}
        >
          <option value="NEEDS_REVIEW">Needs review</option>
          <option value="PROJECT">Approved numbered project</option>
          <option value="GENERAL">SIN_TecSurge_General</option>
          <option value="BUSINESS_DEVELOPMENT">SIN_TecSurge_BusinessDevelopment (proposal)</option>
        </select>
      </label>
      <Field title="Approved project number" name="projectNumber" value={mapping?.projectNumber} />
      <label>
        Module
        <select aria-label="Module" name="module" defaultValue={mapping?.module || 'TASK'}>
          {['TASK', 'ISSUE', 'GENERAL'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <Field title="Task ID (task module only)" name="taskId" value={mapping?.taskId} />
      <Field title="Issue ID (issue module only)" name="issueId" value={mapping?.issueId} />
      <label>
        Billing rule
        <select
          aria-label="Billing rule"
          name="billing"
          defaultValue={mapping?.billing || 'UNKNOWN'}
        >
          {['UNKNOWN', 'BILLABLE', 'NON_BILLABLE'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <Field
        title="Approved descriptions (one per line)"
        name="approvedDescriptions"
        value={mapping?.approvedDescriptions.join('\n')}
        multiline
      />
      <Field title="Mapping source and notes" name="note" value={mapping?.note} multiline />
      <label className="checkbox-label">
        <input type="checkbox" name="confirmed" required />I confirm the supplied mapping. Blank IDs
        remain unknown; this does not verify Zoho access.
      </label>
      <FormButtons busy={busy} cancel={done}>
        Save mapping
      </FormButtons>
    </form>
  );
}
function Labels({
  selected = [],
  title = 'Classification labels',
}: {
  selected?: string[];
  title?: string;
}) {
  return (
    <fieldset className="work-labels">
      <legend>{title}</legend>
      {classifications.map((c) => (
        <label className="checkbox-label" key={c}>
          <input type="checkbox" name="labels" value={c} defaultChecked={selected.includes(c)} />
          {label(c)}
        </label>
      ))}
    </fieldset>
  );
}
function RuleEditor({
  rule,
  learning,
  data,
  save,
  busy,
  done,
}: {
  rule: WorkRule | null;
  learning?: LearningRecord;
  data: WorkSnapshot;
  save: Save;
  busy: boolean;
  done: () => void;
}) {
  const [projectId, setProjectId] = useState(
    rule?.knowledgeProjectId || learning?.corrected.projectId || '',
  );
  return (
    <form
      className="stacked-form work-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget);
        const value = {
          name: f.get('name'),
          source: f.get('source'),
          terms: words(f.get('terms')),
          match: f.get('match'),
          sender: optional(f.get('sender')),
          knowledgeProjectId: projectId || undefined,
          mappingId: optional(f.get('mappingId')),
          labels: f.getAll('labels'),
          requiredFields: f.getAll('requiredFields'),
          enabled: f.get('enabled') === 'on',
          confidence: Number(f.get('confidence')),
          explanation: f.get('explanation'),
          confirmed: f.get('confirmed') === 'on',
        };
        const url = learning
          ? `/work/learning/${learning.id}/rule`
          : `/work/rules${rule ? '/' + rule.id : ''}`;
        if (await save(url, editPayload(rule, value), rule ? 'PUT' : 'POST')) done();
      }}
    >
      <h3>{learning ? 'Teach a reusable rule' : rule ? 'Edit rule' : 'New classification rule'}</h3>
      <Field title="Rule name" name="name" value={rule?.name} required />
      <label>
        Input source
        <select
          aria-label="Input source"
          name="source"
          defaultValue={rule?.source || learning?.originalInput.source || 'any'}
        >
          {['any', 'manual', 'teams', 'outlook'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <Field
        title="Matching phrases (comma-separated)"
        name="terms"
        value={rule?.terms.join(', ')}
        required
      />
      <label>
        Match
        <select aria-label="Match" name="match" defaultValue={rule?.match || 'ALL'}>
          <option value="ALL">All phrases</option>
          <option value="ANY">Any phrase</option>
        </select>
      </label>
      <Field
        title="Exact sender (optional)"
        name="sender"
        value={rule?.sender || learning?.originalInput.sender}
      />
      <label>
        Work project
        <select
          aria-label="Work project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">Not assigned</option>
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Confirmed Zoho mapping
        <select
          key={projectId}
          name="mappingId"
          defaultValue={rule?.mappingId || learning?.corrected.mappingId || ''}
        >
          <option value="">None</option>
          {data.mappings
            .filter((m) => m.knowledgeProjectId === projectId)
            .map((m) => (
              <option value={m.id} key={m.id}>
                {m.activityName}
              </option>
            ))}
        </select>
      </label>
      <Labels selected={rule?.labels || learning?.corrected.labels} />
      <fieldset className="work-labels">
        <legend>Required information</legend>
        {['date', 'duration', 'project', 'attendance'].map((f) => (
          <label key={f} className="checkbox-label">
            <input
              name="requiredFields"
              type="checkbox"
              value={f}
              defaultChecked={rule?.requiredFields.includes(f as never)}
            />
            {f}
          </label>
        ))}
      </fieldset>
      <label>
        Confidence (rule weight, 0–1)
        <input
          name="confidence"
          type="number"
          min="0"
          max="1"
          step="0.05"
          defaultValue={rule?.confidence ?? 1}
          required
        />
      </label>
      <Field
        title="Rule explanation"
        name="explanation"
        value={rule?.explanation || learning?.explanation}
        multiline
      />
      <label className="checkbox-label">
        <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} />
        Enabled
      </label>
      <label className="checkbox-label">
        <input type="checkbox" name="confirmed" required />
        Apply this explicit rule to future matching input
      </label>
      <FormButtons busy={busy} cancel={done}>
        Save rule
      </FormButtons>
    </form>
  );
}
function Classification({
  value,
  projects,
}: {
  value: WorkClassification;
  projects: KnowledgeProject[];
}) {
  return (
    <div className="classification-result">
      <p>
        <strong>{value.labels.map(label).join(' · ')}</strong>
      </p>
      <p>
        {projects.find((p) => p.id === value.projectId)?.name || 'Project not confirmed'} ·{' '}
        {Math.round(value.confidence * 100)}% classification confidence
      </p>
      {value.missing.length > 0 && (
        <p className="work-warning">Missing: {value.missing.join(', ')}</p>
      )}
      {value.conflict && <p className="work-warning">Conflicting rules — review required</p>}
      <details>
        <summary>Why this classification?</summary>
        {value.explanation.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </details>
    </div>
  );
}
function RecordEditor({ save, busy, done }: { save: Save; busy: boolean; done: () => void }) {
  const [kind, setKind] = useState('ACTIVITY');
  const work = ['ACTIVITY', 'MEETING'].includes(kind);
  return (
    <form
      className="stacked-form work-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget);
        const data = {
          source: f.get('source'),
          kind,
          subject: f.get('subject'),
          body: f.get('body'),
          sender: String(f.get('sender') || ''),
          date: optional(f.get('date')),
          startTime: optional(f.get('startTime')),
          endTime: optional(f.get('endTime')),
          durationMinutes: f.get('durationMinutes') ? Number(f.get('durationMinutes')) : undefined,
          activityConfirmed: f.get('activityConfirmed') === 'on',
          attendanceConfirmed: f.get('attendanceConfirmed') === 'on',
        };
        if (await save('/work/records', data)) done();
      }}
    >
      <h3>Add manual input</h3>
      <label>
        Record type
        <select aria-label="Record type" value={kind} onChange={(e) => setKind(e.target.value)}>
          {['ACTIVITY', 'MEETING', 'EMAIL', 'MESSAGE'].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label>
        Input source
        <select aria-label="Input source" name="source">
          <option value="manual">Manual work entry</option>
          <option value="outlook">Manually supplied Outlook content</option>
          <option value="teams">Manually supplied Teams content</option>
        </select>
      </label>
      <Field title="Title or subject" name="subject" />
      <Field title="Work description or supplied content" name="body" required multiline />
      {!work && <Field title="Sender" name="sender" />}
      <Field
        title={work ? 'Activity date (leave blank if unknown)' : 'Message date (optional)'}
        name="date"
        type="date"
      />
      {work && (
        <>
          <div className="form-columns">
            <Field title="Start time (optional)" name="startTime" type="time" />
            <Field title="End time (optional)" name="endTime" type="time" />
          </div>
          <Field
            title="Confirmed duration in minutes (optional)"
            name="durationMinutes"
            type="number"
          />
          <label className="checkbox-label">
            <input name="activityConfirmed" type="checkbox" />I confirm this work actually happened
          </label>
          {kind === 'MEETING' && (
            <label className="checkbox-label">
              <input name="attendanceConfirmed" type="checkbox" />I confirm I attended this meeting
            </label>
          )}
        </>
      )}
      <p className="microcopy">
        Missing facts stay unknown. Saving does not create a coding job or submit a timesheet.
      </p>
      <FormButtons busy={busy} cancel={done}>
        Save and classify
      </FormButtons>
    </form>
  );
}
function Correction({
  record,
  data,
  save,
  busy,
  done,
}: {
  record: WorkRecord;
  data: WorkSnapshot;
  save: Save;
  busy: boolean;
  done: () => void;
}) {
  const [projectId, setProjectId] = useState(record.classification.projectId || '');
  return (
    <form
      className="stacked-form work-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (
          await save(`/work/records/${record.id}/correct`, {
            version: record.version,
            labels: f.getAll('labels'),
            projectId: projectId || null,
            mappingId: optional(f.get('mappingId')) || null,
            explanation: f.get('explanation'),
            confirmed: f.get('confirmed') === 'on',
          })
        )
          done();
      }}
    >
      <h3>Correct this record</h3>
      <Labels selected={record.classification.labels} />
      <label>
        Work project
        <select
          aria-label="Work project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">Not assigned</option>
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Zoho mapping
        <select
          key={projectId}
          name="mappingId"
          defaultValue={record.classification.mappingId || ''}
        >
          <option value="">None</option>
          {data.mappings
            .filter((m) => m.knowledgeProjectId === projectId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.activityName}
              </option>
            ))}
        </select>
      </label>
      <Field title="Correction explanation" name="explanation" required multiline />
      <label className="checkbox-label">
        <input name="confirmed" type="checkbox" required />
        Confirm for this record only
      </label>
      <FormButtons busy={busy} cancel={done}>
        Save correction
      </FormButtons>
    </form>
  );
}
type ExtendedSnapshot = WorkSnapshot & {
  issues: { recordId: string; duplicates: string[]; overlaps: string[]; missing: string[] }[];
};
export function WorkKnowledgePanel() {
  const resource = useResource<ExtendedSnapshot>('/work');
  const [tab, setTab] = useState('activities');
  const [project, setProject] = useState<KnowledgeProject | null | undefined>();
  const [mapping, setMapping] = useState<ZohoMapping | null | undefined>();
  const [rule, setRule] = useState<WorkRule | null | undefined>();
  const [learning, setLearning] = useState<LearningRecord | undefined>();
  const [adding, setAdding] = useState(false);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('all');
  const [day, setDay] = useState('');
  const data = resource.data;
  const save: Save = async (url, input, method = 'POST') => {
    setBusy(true);
    setError('');
    try {
      await api(url, { method, body: JSON.stringify(input) });
      await resource.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const selectTab = (next: string) => {
    setTab(next);
    setError('');
    setProject(undefined);
    setMapping(undefined);
    setRule(undefined);
    setLearning(undefined);
    setAdding(false);
    setCorrecting(null);
  };
  const records =
    data?.records
      .filter(
        (r) =>
          period === 'all' ||
          (day &&
            r.date &&
            (period === 'day'
              ? r.date === day
              : r.date >= day &&
                r.date <
                  new Date(new Date(day + 'T00:00:00Z').getTime() + 7 * 86400000)
                    .toISOString()
                    .slice(0, 10))),
      )
      .toReversed() || [];
  return (
    <div className="panel-content work-center">
      <div className="section-heading">
        <h2>Work knowledge</h2>
        <button aria-label="Refresh work knowledge" onClick={resource.refresh}>
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="panel-tabs work-tabs">
        {['activities', 'projects', 'mappings', 'rules', 'learning'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => selectTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <ErrorText error={error || resource.error} />
      {!data && !resource.error && <p role="status">Loading work records…</p>}
      {data && (
        <>
          {tab === 'projects' && (
            <>
              {project === undefined ? (
                <button className="button secondary" onClick={() => setProject(null)}>
                  <Plus size={14} />
                  New work project
                </button>
              ) : (
                <ProjectEditor
                  key={project ? `${project.id}-${project.version}` : 'new'}
                  project={project}
                  save={save}
                  busy={busy}
                  done={() => setProject(undefined)}
                />
              )}
              {!data.projects.length && (
                <Empty title="No work projects">
                  Register your role and aliases without connecting a coding repository.
                </Empty>
              )}
              {data.projects.map((p) => (
                <article className="work-row" key={p.id}>
                  <div className="work-row-heading">
                    <strong>{p.name}</strong>
                    <button className="text-button" onClick={() => setProject(p)}>
                      Edit project
                    </button>
                  </div>
                  <span>
                    {label(p.role)} · {p.status.toLowerCase()}
                    {p.department ? ` · ${p.department}` : ''}
                  </span>
                  <p>{p.description}</p>
                  {p.aliases.length > 0 && <small>Aliases: {p.aliases.join(', ')}</small>}
                </article>
              ))}
            </>
          )}
          {tab === 'mappings' && (
            <>
              {mapping === undefined ? (
                <button
                  className="button secondary"
                  disabled={!data.projects.length}
                  onClick={() => setMapping(null)}
                >
                  <Plus size={14} />
                  New mapping
                </button>
              ) : (
                <MappingEditor
                  key={mapping ? `${mapping.id}-${mapping.version}` : 'new'}
                  mapping={mapping}
                  projects={data.projects}
                  save={save}
                  busy={busy}
                  done={() => setMapping(undefined)}
                />
              )}
              {!data.mappings.length && (
                <Empty title="No Zoho mappings">
                  Register a work project, then confirm its IDs and billing rules. No remote lookup
                  has run.
                </Empty>
              )}
              {data.mappings.map((m) => (
                <article className="work-row" key={m.id}>
                  <div className="work-row-heading">
                    <strong>{m.activityName}</strong>
                    <button className="text-button" onClick={() => setMapping(m)}>
                      Edit mapping
                    </button>
                  </div>
                  <span>
                    {data.projects.find((p) => p.id === m.knowledgeProjectId)?.name} · {m.module} ·{' '}
                    {m.billing}
                  </span>
                  <small>
                    Portal: {m.portalId || 'unknown'} · Project: {m.projectId || 'unknown'} ·{' '}
                    {m.module === 'TASK'
                      ? `Task: ${m.taskId || 'unknown'}`
                      : m.module === 'ISSUE'
                        ? `Issue: ${m.issueId || 'unknown'}`
                        : 'General activity'}
                  </small>
                  <small>User confirmed · Remote verification pending</small>
                </article>
              ))}
            </>
          )}
          {tab === 'rules' && (
            <>
              {rule === undefined ? (
                <button className="button secondary" onClick={() => setRule(null)}>
                  <Plus size={14} />
                  New rule
                </button>
              ) : (
                <RuleEditor
                  key={rule ? `${rule.id}-${rule.version}` : 'new'}
                  rule={rule}
                  data={data}
                  save={save}
                  busy={busy}
                  done={() => setRule(undefined)}
                />
              )}
              {!data.rules.length && (
                <Empty title="No confirmed rules">
                  Add a scoped phrase rule or promote a correction from Learning.
                </Empty>
              )}
              {data.rules.map((r) => (
                <article className="work-row" key={r.id}>
                  <div className="work-row-heading">
                    <strong>{r.name}</strong>
                    <button className="text-button" onClick={() => setRule(r)}>
                      Edit rule
                    </button>
                  </div>
                  <span>
                    {r.enabled ? 'Enabled' : 'Disabled'} · {r.source} · {r.match.toLowerCase()}:{' '}
                    {r.terms.join(', ')}
                  </span>
                  <p>{r.labels.map(label).join(' · ')}</p>
                  <small>
                    {r.origin === 'CONFIRMED_CORRECTION'
                      ? 'From a confirmed correction'
                      : 'CEO-confirmed rule'}{' '}
                    · weight {r.confidence}
                  </small>
                </article>
              ))}
            </>
          )}
          {tab === 'activities' && (
            <>
              {!adding ? (
                <button className="button secondary" onClick={() => setAdding(true)}>
                  <Plus size={14} />
                  Add activity or input
                </button>
              ) : (
                <RecordEditor save={save} busy={busy} done={() => setAdding(false)} />
              )}
              <div className="work-filter stacked-form">
                <label>
                  Period
                  <select
                    aria-label="Period"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                  >
                    <option value="all">All records</option>
                    <option value="day">Selected day</option>
                    <option value="week">7 days from date</option>
                  </select>
                </label>
                {period !== 'all' && (
                  <label>
                    From date
                    <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
                  </label>
                )}
              </div>
              {!records.length && (
                <Empty title="No matching work records">
                  Add actual work or manually supplied content. Unknown time stays blank.
                </Empty>
              )}
              {records.map((record) => {
                const issues = data.issues.find((i) => i.recordId === record.id);
                return (
                  <article className="work-row work-record" key={record.id}>
                    <div className="work-row-heading">
                      <strong>{record.subject || label(record.kind)}</strong>
                      <span className="work-provenance">MANUAL · {record.source}</span>
                    </div>
                    <p className="work-record-body">{record.body}</p>
                    <small>
                      {record.date || 'Date unknown'}
                      {record.durationMinutes ? ` · ${record.durationMinutes} min` : ''}
                      {['ACTIVITY', 'MEETING'].includes(record.kind)
                        ? ` · ${record.activityConfirmed ? 'Work confirmed' : 'Work unconfirmed'}`
                        : ''}
                    </small>
                    {issues && (issues.duplicates.length > 0 || issues.overlaps.length > 0) && (
                      <p className="work-warning">
                        {issues.duplicates.length > 0 ? 'Possible duplicate. ' : ''}
                        {issues.overlaps.length > 0 ? 'Overlapping activity times.' : ''}
                      </p>
                    )}
                    <Classification value={record.classification} projects={data.projects} />
                    {correcting === record.id ? (
                      <Correction
                        record={record}
                        data={data}
                        save={save}
                        busy={busy}
                        done={() => setCorrecting(null)}
                      />
                    ) : (
                      <div className="work-actions">
                        <button className="text-button" onClick={() => setCorrecting(record.id)}>
                          Correct classification
                        </button>
                        <button
                          className="text-button"
                          disabled={busy || data.learning.some((l) => l.recordId === record.id)}
                          onClick={() =>
                            save(`/work/records/${record.id}/reclassify`, {
                              version: record.version,
                            })
                          }
                        >
                          Apply current rules
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </>
          )}
          {tab === 'learning' && (
            <>
              {learning && (
                <RuleEditor
                  key={learning.id}
                  rule={null}
                  learning={learning}
                  data={data}
                  save={save}
                  busy={busy}
                  done={() => setLearning(undefined)}
                />
              )}
              {!data.learning.length && (
                <Empty title="No corrections yet">
                  Corrections affect one record. A reusable rule requires a separate confirmation.
                </Empty>
              )}
              {data.learning.toReversed().map((l) => (
                <article key={l.id} className="work-row">
                  <strong>{l.originalInput.subject || 'Classification correction'}</strong>
                  <p>
                    {l.previous.labels.map(label).join(', ')} →{' '}
                    {l.corrected.labels.map(label).join(', ')}
                  </p>
                  <p>{l.explanation}</p>
                  <small>{dateTime(l.createdAt)} · this record only</small>
                  {l.ruleId ? (
                    <span>Reusable rule confirmed</span>
                  ) : (
                    <button className="text-button" onClick={() => setLearning(l)}>
                      Create reusable rule
                    </button>
                  )}
                </article>
              ))}
            </>
          )}
          <details className="work-section">
            <summary>Local audit history</summary>
            {data.audit
              .toReversed()
              .slice(0, 30)
              .map((a) => (
                <p className="microcopy" key={a.id}>
                  {dateTime(a.at)} · {a.action.toLowerCase().replaceAll('_', ' ')} · {a.entityType}{' '}
                  · {a.entityId.slice(0, 8)}
                </p>
              ))}
          </details>
        </>
      )}
    </div>
  );
}
