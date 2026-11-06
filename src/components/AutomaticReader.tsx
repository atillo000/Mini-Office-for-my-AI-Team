import { useEffect } from 'react';
import type {
  ReaderProvider,
  ReaderAutomationSettings,
  ReaderAutomationState,
} from '../../shared/reader';
import { useResource } from './useResource';
import { useAction, post, ErrorText, Status, dateTime } from './common';
import { api } from '../api';
export function AutomaticReader({ provider }: { provider: ReaderProvider }) {
  const { data, error, refresh } = useResource<{
    automation: { settings: ReaderAutomationSettings; state: ReaderAutomationState }[];
  }>('/readers');
  const action = useAction(),
    current = data?.automation?.find((item) => item.settings.provider === provider);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const update = async (patch: Partial<ReaderAutomationSettings>) => {
    if (!current) return;
    const { version, enabled, shareWithAI, intervalMinutes } = current.settings;
    await action.execute(() =>
      api('/readers/' + provider + '/automation', {
        method: 'PUT',
        body: JSON.stringify({ version, enabled, shareWithAI, intervalMinutes, ...patch }),
      }),
    );
    await refresh();
  };
  return (
    <section className="automatic-reader">
      <div className="studio-title">
        <h3>Automatic {provider === 'outlook' ? 'Outlook' : 'Teams'} reader</h3>
        {current && <Status state={current.state.status} />}
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={current?.settings.enabled || false}
          disabled={!current || action.busy}
          onChange={(e) => void update({ enabled: e.target.checked })}
        />
        Let my team open, navigate and check this account automatically when the app starts
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={current?.settings.shareWithAI || false}
          disabled={!current || action.busy}
          onChange={(e) => void update({ shareWithAI: e.target.checked })}
        />
        Ask my AI team to review new matching work messages. Model usage consumes quota.
      </label>
      {current?.settings.enabled && (
        <p className="microcopy">
          Checks every {current.settings.intervalMinutes} minutes while the backend is running. Uses
          the saved Microsoft sign-in in the dedicated profile. Passwords, MFA and consent prompts
          still require you.
        </p>
      )}
      {current?.state.coverage && <p className="microcopy">{current.state.coverage}</p>}
      {current?.state.lastRunAt && (
        <small>
          Last check {dateTime(current.state.lastRunAt)}
          {current.state.nextRunAt ? ' · Next ' + dateTime(current.state.nextRunAt) : ''}
        </small>
      )}
      {current?.settings.enabled && (
        <div className="job-actions">
          <button
            className="text-button"
            disabled={action.busy}
            onClick={async () => {
              await action.execute(() => post('/readers/' + provider + '/automation/run', {}));
              await refresh();
            }}
          >
            Check now
          </button>
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() => void update({ enabled: false })}
          >
            Pause automatic reader
          </button>
        </div>
      )}
      {current && ['NEEDS_SIGN_IN', 'NEEDS_ATTENTION'].includes(current.state.status) && (
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={() => void action.execute(() => post('/readers/' + provider + '/open', {}))}
        >
          Open reader window
        </button>
      )}
      <ErrorText error={error || action.error || current?.state.error || ''} />
    </section>
  );
}
