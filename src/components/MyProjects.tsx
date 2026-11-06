import { useState } from 'react';
import type { WorkFocus, FocusCatalog } from '../../shared/focus';
import type { ZohoEntity } from '../../shared/connected';
import { useResource } from './useResource';
import { useAction, ErrorText, post, dateTime } from './common';
import { api } from '../api';
import { useOffice } from '../store';
type FocusView = {
  settings: WorkFocus;
  catalog: FocusCatalog | null;
  numbers: string[];
  notice: string;
};
export function MyProjects() {
  const resource = useResource<FocusView>('/work-focus'),
    action = useAction();
  const [portals, setPortals] = useState<ZohoEntity[]>([]),
    [portal, setPortal] = useState('');
  return (
    <div className="panel-content">
      <h2>My projects</h2>
      <p>
        Use projects available in your Zoho account to focus Outlook and identify relevant Teams
        meeting candidates.
      </p>
      <div className="work-actions">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={() =>
            void action.execute(async () =>
              setPortals((await api<{ items: ZohoEntity[] }>('/zoho/discover?kind=portals')).items),
            )
          }
        >
          Load my Zoho portals
        </button>
        <button className="text-button" onClick={() => useOffice.getState().open('connections')}>
          Connection setup
        </button>
      </div>
      <label className="studio-feedback">
        Zoho portal
        <select
          aria-label="Project focus portal"
          value={portal || resource.data?.settings.portalId || ''}
          onChange={(e) => setPortal(e.target.value)}
        >
          <option value="">Choose your portal</option>
          {portals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {!portals.length && resource.data?.settings.portalId && (
            <option value={resource.data.settings.portalId}>Saved portal</option>
          )}
        </select>
      </label>
      <button
        className="button primary"
        disabled={action.busy || !(portal || resource.data?.settings.portalId)}
        onClick={async () => {
          await action.execute(() =>
            post('/work-focus/sync', { portalId: portal || resource.data?.settings.portalId }),
          );
          await resource.refresh();
        }}
      >
        Sync accessible projects
      </button>
      <ErrorText error={resource.error || action.error} />
      {resource.data && (
        <FocusEditor
          key={resource.data.settings.version}
          data={resource.data}
          refresh={resource.refresh}
        />
      )}
    </div>
  );
}
function FocusEditor({ data, refresh }: { data: FocusView; refresh: () => Promise<void> }) {
  const [form, setForm] = useState(data.settings),
    action = useAction();
  const [names, setNames] = useState(data.settings.selfNames.join('\n'));
  return (
    <form
      className="stacked-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await action.execute(() =>
          api('/work-focus', {
            method: 'PUT',
            body: JSON.stringify({
              ...form,
              selfNames: names
                .split('\n')
                .map((name) => name.trim())
                .filter(Boolean),
            }),
          }),
        );
        await refresh();
      }}
    >
      <h3>What the team should read</h3>
      <p className="microcopy">
        {data.notice} Access does not establish project approval or hours worked.
      </p>
      {data.catalog && (
        <small>
          Live project list checked {dateTime(data.catalog.checkedAt)}. General and Business
          Development are time-log categories, not numbered project matches.
        </small>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        Focus AI reviews on my projects and meeting mentions
      </label>
      <label>
        Project matching
        <select
          value={form.mode}
          onChange={(e) => setForm({ ...form, mode: e.target.value as WorkFocus['mode'] })}
        >
          <option value="SELECTED">Only projects I select</option>
          <option value="ACCESSIBLE">All accessible numbered projects</option>
        </select>
      </label>
      {(data.catalog?.projects || []).map((project) => (
        <label className="checkbox-label" key={project.id}>
          <input
            type="checkbox"
            disabled={form.mode === 'ACCESSIBLE'}
            checked={project.numbers.some((n) => form.selectedNumbers.includes(n))}
            onChange={(e) =>
              setForm({
                ...form,
                selectedNumbers: e.target.checked
                  ? [...new Set([...form.selectedNumbers, ...project.numbers])]
                  : form.selectedNumbers.filter((n) => !project.numbers.includes(n)),
              })
            }
          />
          {project.name}
        </label>
      ))}
      <label>
        My name as shown in Teams (one full name per line)
        <textarea rows={3} value={names} onChange={(e) => setNames(e.target.value)} />
      </label>
      <p className="microcopy">
        A named invitation or call mention is a candidate for review. It does not prove attendance.
        Registered project numbers alone do not supply work durations.
      </p>
      <button className="button primary" disabled={action.busy || !form.portalId}>
        Save my work focus
      </button>
      <ErrorText error={action.error} />
    </form>
  );
}
