import { useState, useEffect } from 'react';
import type { ExternalDraft, TimeApprovalPolicy } from '../../shared/connected';
import { useAction, post, ErrorText, dateTime } from './common';
export function TimeApprovalCountdown({
  draft,
  policy,
  refresh,
}: {
  draft: ExternalDraft;
  policy?: TimeApprovalPolicy;
  refresh: () => Promise<void>;
}) {
  const [now, setNow] = useState(() => Date.now()),
    action = useAction();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const schedule = draft.autoApproval;
  if (!schedule || draft.state !== 'DRAFT') return null;
  const active = policy?.enabled && policy.version === schedule.policyVersion;
  const remaining = Math.max(0, Math.ceil((schedule.dueAt - now) / 1000));
  const countdown = Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
  return (
    <div
      className={'time-countdown ' + (schedule.status === 'BLOCKED' ? 'blocked' : '')}
      role="status"
    >
      <strong>
        {schedule.status === 'PAUSED'
          ? 'Automatic submission paused'
          : schedule.status === 'BLOCKED'
            ? 'Automatic submission stopped'
            : !policy
              ? 'Timer status unavailable · check your connection'
              : !active
                ? 'Automatic submission is off'
                : remaining
                  ? 'Submits automatically in ' + countdown
                  : 'Due now · checking before submission'}
      </strong>
      {schedule.status === 'SCHEDULED' && active && (
        <small>Scheduled {dateTime(schedule.dueAt)}</small>
      )}
      {schedule.reason && <p className="microcopy">{schedule.reason}</p>}
      <button
        className="text-button"
        disabled={action.busy || (!active && schedule.status !== 'SCHEDULED')}
        onClick={async () => {
          await action.execute(() =>
            post('/external-drafts/' + draft.id + '/timer', {
              version: draft.version,
              scopeHash: draft.scopeHash,
              paused: schedule.status === 'SCHEDULED',
            }),
          );
          await refresh();
        }}
      >
        {schedule.status === 'SCHEDULED' ? 'Pause automatic submission' : 'Restart 30-minute timer'}
      </button>
      <ErrorText error={action.error} />
    </div>
  );
}
