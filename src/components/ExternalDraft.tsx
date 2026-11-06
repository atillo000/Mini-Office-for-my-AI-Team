import { useState } from 'react';
import type {
  ExternalDraft as Draft,
  ReplyPayload,
  TimeLogPayload,
  TimeApprovalPolicy,
} from '../../shared/connected';
import { api } from '../api';
import { ErrorText, useAction, Status, post } from './common';
import { TimeApprovalCountdown } from './TimeApprovalCountdown';
export function ExternalDraftReview({
  draft,
  refresh,
  timePolicy,
}: {
  draft: Draft;
  refresh: () => Promise<void>;
  timePolicy?: TimeApprovalPolicy;
}) {
  const action = useAction(),
    [body, setBody] = useState(
      draft.kind === 'EMAIL_REPLY' ? (draft.payload as ReplyPayload).body : '',
    );
  const [confirmed, setConfirmed] = useState(false);
  const time = draft.kind === 'TIME_LOG' ? (draft.payload as TimeLogPayload) : null;
  const reply = draft.kind === 'EMAIL_REPLY' ? (draft.payload as ReplyPayload) : null;
  const dirty = reply && body !== reply.body;
  return (
    <article
      id={'draft-' + draft.id}
      className="external-review"
      aria-label="Review external action"
    >
      <div className="studio-title">
        <h3>{time ? 'Review time log' : 'Review email reply'}</h3>
        <Status state={draft.state} />
      </div>
      {time && <TimeApprovalCountdown draft={draft} policy={timePolicy} refresh={refresh} />}
      {time && (
        <dl className="draft-details">
          {[
            ['Category', time.category.replaceAll('_', ' ')],
            ['Project', time.projectName],
            ['Project API ID', time.projectId],
            ['Task / issue', time.taskName || time.module],
            ['Log for', time.ownerName],
            ['Date', time.date],
            ['Duration', time.durationMinutes + ' minutes'],
            [
              'Time',
              time.startTime
                ? time.startTime + '–' + time.endTime + ' (Asia/Manila)'
                : 'Duration only',
            ],
            ['Billing', time.billing],
            ['Work performed', time.description],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {time && draft.state === 'DRAFT' && (
        <button
          className="text-button"
          disabled={action.busy}
          onClick={() =>
            void action.execute(
              () => post('/external-drafts/' + draft.id + '/check', {}),
              'Read-only submission checks passed. Nothing was sent.',
            )
          }
        >
          Check before submission
        </button>
      )}
      {reply && (
        <>
          <p>
            <strong>To:</strong> {reply.to}
          </p>
          <p>
            <strong>Subject:</strong> {reply.subject}
          </p>
          <label className="studio-feedback">
            Reply body
            <textarea
              aria-label="Reply body"
              rows={7}
              value={body}
              disabled={!['DRAFT', 'FAILED', 'REVIEWED'].includes(draft.state)}
              maxLength={12000}
              onChange={(e) => {
                setBody(e.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          {dirty && (
            <button
              className="button secondary"
              disabled={action.busy || !body.trim()}
              onClick={async () => {
                const result = await action.execute(() =>
                  api('/external-drafts/' + draft.id, {
                    method: 'PUT',
                    body: JSON.stringify({ version: draft.version, payload: { body } }),
                  }),
                );
                if (result) await refresh();
              }}
            >
              Save reply edits
            </button>
          )}
        </>
      )}
      {reply && (
        <div className="job-actions">
          <button
            className="button secondary"
            onClick={() =>
              action.execute(async () => {
                await navigator.clipboard.writeText(body);
              }, 'Reply copied. Paste and send it yourself in Outlook.')
            }
          >
            Copy reply
          </button>
          {draft.state === 'DRAFT' && (
            <button
              className="button primary"
              disabled={action.busy || !!dirty}
              onClick={async () => {
                const result = await action.execute(
                  () =>
                    post('/external-drafts/' + draft.id + '/review', {
                      version: draft.version,
                      scopeHash: draft.scopeHash,
                    }),
                  'Marked reviewed locally. Nothing was sent.',
                );
                if (result) await refresh();
              }}
            >
              Mark reviewed
            </button>
          )}
          <p className="microcopy">
            Local review only. The office cannot create or send an Outlook message.
          </p>
        </div>
      )}
      {draft.state === 'DRAFT' && !reply && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              I reviewed these exact details and approve{' '}
              {time ? 'submitting this time log to Zoho' : 'sending this reply through Outlook'}.
            </span>
          </label>
          <div className="job-actions">
            <button
              className="button primary"
              disabled={!confirmed || !!dirty || action.busy}
              onClick={async () => {
                const result = await action.execute(() =>
                  post('/external-drafts/' + draft.id + '/approve', {
                    version: draft.version,
                    scopeHash: draft.scopeHash,
                  }),
                );
                if (result) await refresh();
              }}
            >
              Approve and {time ? 'submit time log' : 'send reply'}
            </button>
            <button
              className="text-button"
              disabled={action.busy}
              onClick={async () => {
                await action.execute(() =>
                  post('/external-drafts/' + draft.id + '/reject', { version: draft.version }),
                );
                await refresh();
              }}
            >
              Reject draft
            </button>
          </div>
        </>
      )}
      {draft.receipt && (
        <p className="microcopy">
          Provider receipt:{' '}
          {draft.receipt.providerId || draft.receipt.requestId || 'HTTP ' + draft.receipt.status}
          {draft.state === 'ACCEPTED'
            ? ' · Microsoft accepted the send request; delivery is not confirmed.'
            : draft.receipt.verifiedAt
              ? ' · Zoho entry read back and verified. Organizational approval may still be pending.'
              : ''}
        </p>
      )}
      {draft.approval?.mode === 'AUTO_POLICY' && (
        <p className="microcopy">
          Approved under your 30-minute automatic time-log policy (version{' '}
          {draft.approval.policyVersion}).
        </p>
      )}
      {draft.error && <p className="form-error">{draft.error}</p>}
      <ErrorText error={action.error} />
      {draft.state === 'UNKNOWN_OUTCOME' && (
        <p>
          Check Outlook Sent Items or Zoho Time Logs before doing anything further. Automatic
          resubmission is disabled.
        </p>
      )}
    </article>
  );
}
