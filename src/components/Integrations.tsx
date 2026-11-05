import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';
import {
  integrationModes,
  operations,
  type ConnectionView,
  type IntegrationMode,
  type IntegrationRun,
  type RouteDecision,
  type Operation,
  type WorkSnapshot,
} from '../../shared/work';
import { ErrorText, dateTime } from './common';
import { useResource } from './useResource';
function ConnectionEditor({
  connection,
  refresh,
  work,
}: {
  connection: ConnectionView;
  refresh: () => Promise<void>;
  work: WorkSnapshot | null;
}) {
  const [mode, setMode] = useState<IntegrationMode>(connection.mode);
  const [apiAllowed, setApiAllowed] = useState(connection.apiAllowed);
  const [browserAllowed, setBrowserAllowed] = useState(connection.browserAllowed);
  const [confirmed, setConfirmed] = useState(!!connection.policyConfirmedAt);
  const [operation, setOperation] = useState<Operation>(operations[connection.id][0]);
  const [decision, setDecision] = useState<RouteDecision | null>(null);
  const [result, setResult] = useState<IntegrationRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recordId, setRecordId] = useState('');
  const [projectId, setProjectId] = useState('');
  const dirty =
    mode !== connection.mode ||
    apiAllowed !== connection.apiAllowed ||
    browserAllowed !== connection.browserAllowed ||
    confirmed !== !!connection.policyConfirmedAt;
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="work-section connection-editor">
      <h3>{connection.name}</h3>
      <p className="microcopy">{connection.detail}</p>
      <form
        className="stacked-form"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () => {
            await api(`/integrations/${connection.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                version: connection.version,
                mode,
                apiAllowed,
                browserAllowed,
                policyConfirmed: confirmed,
              }),
            });
            setDecision(null);
            setResult(null);
          });
        }}
      >
        <label>
          Routing mode
          <select
            aria-label="Routing mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as IntegrationMode)}
          >
            {integrationModes.filter((m) => m !== 'SIMULATION_ONLY').map((m) => (
              <option key={m} value={m}>
                {m.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>External access policy</summary>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={apiAllowed}
              onChange={(e) => setApiAllowed(e.target.checked)}
            />
            Permit authorized API access
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={browserAllowed}
              onChange={(e) => setBrowserAllowed(e.target.checked)}
            />
            Permit independently authorized browser access
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I confirm organizational policy permits the selected methods
          </label>
          <p className="microcopy">
            Policy permission does not sign in, grant provider scopes or establish a connection.
          </p>
        </details>
        <button className="button secondary" disabled={busy}>
          Save routing
        </button>
      </form>
      <dl className="connection-facts">
        {(['API', 'BROWSER', 'MANUAL', 'SIMULATION'] as const).map((method) => (
          <div key={method}>
            <dt>{method}</dt>
            <dd>
              {connection.adapters[method]
                ? `${connection.adapters[method]!.health.toLowerCase()} · ${connection.adapters[method]!.authorization.toLowerCase()} · ${connection.adapters[method]!.authentication.toLowerCase().replaceAll('_', ' ')}`
                : 'Not installed'}
            </dd>
          </div>
        ))}
        <div>
          <dt>Last operation</dt>
          <dd>{connection.lastSuccessAt ? dateTime(connection.lastSuccessAt) : 'None verified'}</dd>
        </div>
        <div>
          <dt>Last sync</dt>
          <dd>{connection.lastSyncAt ? dateTime(connection.lastSyncAt) : 'No remote sync'}</dd>
        </div>
      </dl>
      <details>
        <summary>Capabilities and granted scopes</summary>
        {Object.entries(connection.adapters).map(([method, status]) => (
          <p className="microcopy" key={method}>
            {method}: {status?.capabilities.join(', ') || 'None'}
            <br />
            Scopes: {status?.scopes.join(', ') || 'None'}
          </p>
        ))}
      </details>
      <div className="stacked-form">
        {['getMessage', 'classifyMessage'].includes(operation) && (
          <label>
            Supplied message
            <select
              aria-label="Supplied message"
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
            >
              <option value="">Choose a message</option>
              {work?.records
                .filter((r) => r.source === connection.id && ['EMAIL', 'MESSAGE'].includes(r.kind))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.subject || r.body.slice(0, 60)}
                  </option>
                ))}
            </select>
          </label>
        )}
        {['listTasks', 'listIssues'].includes(operation) && (
          <label>
            Registered work project
            <select
              aria-label="Registered work project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Choose a project</option>
              {work?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Operation
          <select
            aria-label="Operation"
            value={operation}
            onChange={(e) => {
              setOperation(e.target.value as Operation);
              setDecision(null);
              setResult(null);
            }}
          >
            {operations[connection.id].map((op) => (
              <option key={op}>{op}</option>
            ))}
          </select>
        </label>
        <div className="work-actions">
          <button
            className="button secondary"
            disabled={busy || dirty}
            onClick={() =>
              perform(async () => {
                setDecision(
                  await api('/integrations/route', {
                    method: 'POST',
                    body: JSON.stringify({ application: connection.id, operation }),
                  }),
                );
              })
            }
          >
            Explain route
          </button>
          <button
            className="button secondary"
            disabled={busy || dirty}
            onClick={() =>
              perform(async () => {
                setResult(
                  await api('/integrations/run', {
                    method: 'POST',
                    body: JSON.stringify({
                      application: connection.id,
                      operation,
                      input: { recordId: recordId || undefined, projectId: projectId || undefined },
                    }),
                  }),
                );
              })
            }
          >
            Run operation
          </button>
        </div>
      </div>
      {dirty && <p className="microcopy">Save routing before checking or running an operation.</p>}
      {decision && (
        <p role="status" className="work-result">
          {decision.method || decision.failure?.code}: {decision.reason}
        </p>
      )}
      {result && (
        <div className="work-result" role="status">
          <strong>
            {result.simulated ? 'SIMULATION · ' : ''}
            {result.method} · {result.state}
          </strong>
          <p>{result.reason}</p>
          {result.failure && (
            <p>
              {result.failure.code}: {result.failure.message}
            </p>
          )}
          {result.result !== undefined && (
            <pre className="report-text">{JSON.stringify(result.result, null, 2)}</pre>
          )}
        </div>
      )}
      <ErrorText error={error} />
      {connection.errors.length > 0 && (
        <details>
          <summary>Recent errors ({connection.errors.length})</summary>
          {connection.errors.toReversed().map((e, i) => (
            <p className="microcopy" key={i}>
              {dateTime(e.at)} · {e.operation}: {e.failure.code} — {e.failure.message}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
export function IntegrationsPanel() {
  const resource = useResource<{ connections: ConnectionView[]; runs: IntegrationRun[] }>(
    '/integrations',
  );
  const [selected, setSelected] = useState('outlook');
  const work = useResource<WorkSnapshot>('/work');
  const connection = resource.data?.connections.find((c) => c.id === selected);
  return (
    <div className="panel-content work-center">
      <div className="section-heading">
        <h2>Connected applications</h2>
        <button aria-label="Refresh connections" onClick={resource.refresh}>
          <RefreshCw size={15} />
        </button>
      </div>
      <ErrorText error={resource.error} />
      <div className="panel-tabs">
        {['outlook', 'teams', 'zoho'].map((id) => (
          <button
            key={id}
            className={selected === id ? 'active' : ''}
            onClick={() => setSelected(id)}
          >
            {id === 'zoho' ? 'Zoho Projects' : id}
          </button>
        ))}
      </div>
      {connection && (
        <ConnectionEditor
          key={`${connection.id}-${connection.version}`}
          connection={connection}
          work={work.data}
          refresh={resource.refresh}
        />
      )}
      {!resource.data && !resource.error && <p role="status">Loading connections…</p>}
      <details className="work-section">
        <summary>Operation history</summary>
        {resource.data?.runs.length ? (
          resource.data.runs.map((run) => (
            <div className="work-row" key={run.id}>
              <strong>
                {run.application} · {run.operation}
              </strong>
              <span>
                {run.simulated ? 'SIMULATION · ' : ''}
                {run.method || 'No route'} · {run.state}
              </span>
              <small>
                {dateTime(run.startedAt)} · {run.attempts} attempt(s)
              </small>
              {run.failure && <p>{run.failure.message}</p>}
            </div>
          ))
        ) : (
          <p>No operation has run.</p>
        )}
      </details>
    </div>
  );
}
