import { useEffect, useState } from 'react';
import type {
  CapturedMessage,
  CommunicationReport,
  LocalReplyDraft,
  ReaderProvider,
  ReaderSnapshot,
  ReaderState,
} from '../../shared/reader';
import type { Job } from '../../shared/types';
import { api } from '../api';
import { useOffice } from '../store';
import { useResource } from './useResource';
import { ErrorText, Status, useAction, post, dateTime } from './common';
interface ReaderData {
  state: ReaderState;
  messages: CapturedMessage[];
  snapshots: ReaderSnapshot[];
  reports: CommunicationReport[];
  drafts: LocalReplyDraft[];
  jobs: Job[];
}
export function BrowserControls({
  provider,
  after,
}: {
  provider: ReaderProvider;
  after?: () => Promise<void>;
}) {
  const { data, refresh, error } = useResource<{ readers: ReaderState[] }>('/readers');
  const [mode, setMode] = useState<'LIST' | 'SELECTED'>(provider === 'teams' ? 'SELECTED' : 'LIST'),
    [share, setShare] = useState(false);
  const action = useAction(),
    state = data?.readers.find((r) => r.provider === provider);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const act = async (name: string) => {
    const result = await action.execute(() =>
      post('/readers/' + provider + '/' + name, {
        mode: state?.watching ? state.mode : mode,
        shareWithAI: state?.watching ? state.shareWithAI : share,
      }),
    );
    await refresh();
    if (result) await after?.();
  };
  return (
    <section className="browser-controls">
      <div className="studio-title">
        <h3>{provider === 'outlook' ? 'Outlook browser reader' : 'Teams browser reader'}</h3>
        {state && <Status state={state.watching ? 'WATCHING' : state.state} />}
      </div>
      <p>
        Open the dedicated Edge window and sign in normally. Select the inbox, message or chat you
        want the team to review.
      </p>
      <div className="work-actions">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={() => void act('open')}
        >
          Open {provider === 'outlook' ? 'Outlook' : 'Teams'} browser
        </button>
        <button
          className="text-button"
          disabled={action.busy || state?.state === 'CLOSED'}
          onClick={() => void act('close')}
        >
          Close reader
        </button>
      </div>
      {provider === 'outlook' && (
        <label className="studio-feedback">
          Capture mode
          <select
            aria-label="Capture mode"
            value={state?.watching ? state.mode : mode}
            disabled={state?.watching}
            onChange={(e) => setMode(e.target.value as 'LIST' | 'SELECTED')}
          >
            <option value="LIST">Rendered mail-list previews</option>
            <option value="SELECTED">Opened email body</option>
          </select>
        </label>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={state?.watching ? state.shareWithAI : share}
          disabled={state?.watching}
          onChange={(e) => setShare(e.target.checked)}
        />
        <span>
          Share captured text with my AI analyst for urgency reports and local reply drafts. Model
          usage may incur charges.
        </span>
      </label>
      <div className="job-actions">
        <button
          className="button primary"
          disabled={action.busy || !state || state.state === 'CLOSED'}
          onClick={() => void act('capture')}
        >
          {share ? 'Read and ask my AI team' : 'Capture rendered messages'}
        </button>
        {state?.watching ? (
          <button
            className="button secondary"
            disabled={action.busy}
            onClick={() => void act('stop')}
          >
            Stop watching
          </button>
        ) : (
          <button
            className="button secondary"
            disabled={action.busy || !state || state.state === 'CLOSED'}
            onClick={() => void act('watch')}
          >
            Watch this view every minute
          </button>
        )}
      </div>
      {state?.scope && (
        <p className="microcopy">
          Selected view: {state.scope}
          {state.lastReadAt ? ' · Captured ' + dateTime(state.lastReadAt) : ''}
        </p>
      )}
      <ErrorText error={action.error || error || state?.lastError || ''} />
      <p className="microcopy">
        Reads rendered text only. It does not read every chat or unloaded history, enter
        credentials, create provider drafts, or send anything. Watching stops if the page reloads or
        changes views. Complete MFA yourself; provider access restrictions remain in effect.
      </p>
    </section>
  );
}
export function BrowserInbox({ provider }: { provider: ReaderProvider }) {
  const resource = useResource<ReaderData>('/readers/' + provider + '/messages');
  const [selected, setSelected] = useState<string | null>(null),
    [manual, setManual] = useState('');
  const target = useOffice((s) => s.targetId),
    action = useAction();
  const refresh = resource.refresh;
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const data = resource.data;
  const targetDraft = data?.drafts.find((d) => d.id === target);
  const chosen = selected || targetDraft?.sourceMessageId || target;
  const message = data?.messages.find((m) => m.id === chosen);
  const focusedReport = data?.reports.find((r) => r.id === target || r.jobId === target);
  const reports = focusedReport
    ? [focusedReport, ...(data?.reports.filter((r) => r.id !== focusedReport.id) || [])]
    : data?.reports || [];
  return (
    <div className="browser-inbox">
      <BrowserControls provider={provider} after={refresh} />
      <ErrorText error={resource.error || action.error} />
      {data?.jobs[0] && (
        <div className="chat-job">
          <Status state={data.jobs[0].state} />
          <p>{data.jobs[0].result}</p>
          {['QUEUED', 'RUNNING'].includes(data.jobs[0].state) && (
            <button
              className="text-button"
              disabled={action.busy}
              onClick={async () => {
                await action.execute(() => post('/jobs/' + data.jobs[0].id + '/cancel', {}));
                await refresh();
              }}
            >
              Stop AI review
            </button>
          )}
        </div>
      )}
      {data?.snapshots[0] && <p className="studio-boundary">{data.snapshots[0].coverage}</p>}
      <h3>Captured messages</h3>
      {!data?.messages.length && (
        <p>No real messages captured yet. Sign in and select a view in the reader window.</p>
      )}
      <div className="studio-ideas">
        {data?.messages.map((m) => (
          <button
            key={m.id}
            className={message?.id === m.id ? 'selected' : ''}
            onClick={() => {
              setSelected(m.id);
              setManual('');
            }}
          >
            <div>
              <strong>{m.scope}</strong>
              <small>
                {m.author || 'Author not shown'} · {m.preview ? 'Preview' : 'Rendered message'} ·
                observed {dateTime(m.observedAt)}
              </small>
              <p>{m.text.slice(0, 180)}</p>
            </div>
          </button>
        ))}
      </div>
      {message && (
        <article>
          <h3>{message.scope}</h3>
          <pre className="mail-body">{message.text}</pre>
          <p className="microcopy">
            {message.sentAt
              ? 'Provider time: ' + message.sentAt
              : 'Sent time was not shown; observation time is not a sent timestamp.'}
          </p>
          <form
            className="stacked-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await action.execute(
                () => post('/captured-messages/' + message.id + '/draft', { body: manual }),
                'Local draft saved. Nothing was sent.',
              );
              if (result) {
                setManual('');
                await refresh();
              }
            }}
          >
            <label>
              Your own draft
              <textarea
                aria-label="Your own draft"
                required
                rows={4}
                maxLength={6000}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
            </label>
            <button className="button secondary" disabled={action.busy}>
              Save local draft
            </button>
          </form>
        </article>
      )}
      <h3>AI reports</h3>
      {reports.map((report) => (
        <article className="external-review" key={report.id}>
          <h4>
            {report.scope} · {dateTime(report.createdAt)}
          </h4>
          <p>{report.summary}</p>
          <p className="microcopy">{report.coverage}</p>
          {report.assessments.map((assessment) => (
            <div className="assessment" key={assessment.messageId}>
              <Status state={assessment.urgency} />
              <p>{assessment.reason}</p>
              <blockquote>{assessment.evidence}</blockquote>
              <details>
                <summary>Read captured source</summary>
                <small>Observed {dateTime(assessment.sourceObservedAt)}</small>
                <pre className="mail-body">{assessment.sourceText}</pre>
              </details>
            </div>
          ))}
        </article>
      ))}
      <h3>Local reply drafts</h3>
      {data?.drafts
        .filter((d) => d.status !== 'ARCHIVED')
        .map((draft) => (
          <LocalDraft key={draft.id + ':' + draft.version} draft={draft} refresh={refresh} />
        ))}
      <p className="studio-boundary">
        Review and copy a draft, then paste and send it yourself in Outlook or Teams. The AI Office
        has no Outlook or Teams send action.
      </p>
    </div>
  );
}
function LocalDraft({ draft, refresh }: { draft: LocalReplyDraft; refresh: () => Promise<void> }) {
  const [body, setBody] = useState(draft.body),
    action = useAction();
  const update = async (status: LocalReplyDraft['status']) => {
    const result = await action.execute(
      () =>
        api('/local-reply-drafts/' + draft.id, {
          method: 'PUT',
          body: JSON.stringify({ version: draft.version, body, status }),
        }),
      'Local draft updated. Nothing was sent.',
    );
    if (result) await refresh();
  };
  return (
    <article
      id={'local-draft-' + draft.id}
      className="external-review"
      aria-label="Local reply draft"
    >
      <div className="studio-title">
        <h4>{draft.scope}</h4>
        <Status state={draft.status} />
      </div>
      <p className="microcopy">
        {draft.origin === 'AI' ? 'AI-written draft' : 'Your draft'} · {draft.provider} · local only
      </p>
      <textarea
        aria-label="Local reply text"
        rows={6}
        maxLength={6000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="job-actions">
        <button
          className="button secondary"
          disabled={action.busy || !body.trim()}
          onClick={() => void update('DRAFT')}
        >
          Save edits
        </button>
        <button
          className="button primary"
          disabled={action.busy || body !== draft.body || draft.status === 'REVIEWED'}
          onClick={() => void update('REVIEWED')}
        >
          Mark reviewed
        </button>
        <button
          className="button secondary"
          onClick={() =>
            action.execute(async () => {
              await navigator.clipboard.writeText(body);
            }, 'Draft copied. Paste and send it manually.')
          }
        >
          Copy draft
        </button>
        <button
          className="text-button"
          disabled={action.busy}
          onClick={() => void update('ARCHIVED')}
        >
          Archive
        </button>
      </div>
      <ErrorText error={action.error} />
    </article>
  );
}
