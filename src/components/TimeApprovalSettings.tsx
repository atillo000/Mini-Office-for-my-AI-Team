import type { TimeApprovalPolicy } from '../../shared/connected';
import { api } from '../api';
import { useAction, ErrorText } from './common';
export function TimeApprovalSettings({
  policy,
  refresh,
  error = '',
}: {
  policy?: TimeApprovalPolicy;
  refresh: () => Promise<void>;
  error?: string;
}) {
  const action = useAction();
  return (
    <details className="time-approval-settings">
      <summary>
        Automatic Zoho approval ·{' '}
        {!policy
          ? error
            ? 'Status unavailable'
            : 'Checking status'
          : policy.enabled
            ? 'On, after 30 minutes'
            : 'Off'}
      </summary>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={policy?.enabled || false}
          disabled={!policy || action.busy}
          onChange={async (e) => {
            await action.execute(() =>
              api('/timelogs/approval-policy', {
                method: 'PUT',
                body: JSON.stringify({ version: policy!.version, enabled: e.target.checked }),
              }),
            );
            await refresh();
          }}
        />
        Submit confirmed time-log drafts automatically after 30 minutes
      </label>
      <p className="microcopy">
        {policy?.enabled ? 'Applies to ' + policy.ownerName + ' in the saved Zoho portal. ' : ''}
        Opening the editor pauses its timer. Saving valid changes starts a fresh 30 minutes. Pause
        any draft to keep it for manual review. The backend must be running; overdue timers are
        checked when it restarts.
      </p>
      <p className="microcopy">
        Current Zoho entries, project access and the daily work target are rechecked before sending.
        Failed checks stop the timer. Emails and chats stay manual.
      </p>
      <ErrorText error={action.error || error} />
    </details>
  );
}
