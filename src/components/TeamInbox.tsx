import { useEffect, useState } from 'react';
import type { ExternalDraft, MailItem, MailSync, ReplyPayload } from '../../shared/connected';
import { useOffice } from '../store';
import { useResource } from './useResource';
import { ErrorText, Status, useAction, post, dateTime } from './common';
import { Chat } from './Chat';
import { ExternalDraftReview } from './ExternalDraft';
import { BrowserInbox } from './BrowserReader';
export function TeamInbox() {
  const s = useOffice();
  const [tab, setTab] = useState(
    s.targetChannel === 'external:teams'
      ? 'teams'
      : s.targetChannel === 'external:outlook'
        ? 'outlook'
        : s.targetChannel
          ? 'team'
          : s.targetId
            ? 'graph'
            : 'outlook',
  );
  const [channel, setChannel] = useState(
    s.targetChannel &&
      (s.employees.some((e) => e.id === s.targetChannel) ||
        ['inbox', 'general', 'engineering', 'operations', 'announcements'].includes(
          s.targetChannel,
        ))
      ? s.targetChannel
      : 'sarah',
  );
  const [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(''),
    [onlyProjects, setOnlyProjects] = useState(false);
  const [reply, setReply] = useState('');
  const [shareWithAI, setShareWithAI] = useState(false);
  const [offset, setOffset] = useState(0);
  const mail = useResource<{ items: MailItem[]; sync: MailSync | null; nextOffset: number | null }>(
      '/mail?limit=50&offset=' +
        offset +
        '&search=' +
        encodeURIComponent(query) +
        '&projectsOnly=' +
        onlyProjects,
    ),
    drafts = useResource<ExternalDraft[]>('/external-drafts');
  const action = useAction();
  const refreshMail = mail.refresh;
  const refresh = async () => {
    await Promise.all([mail.refresh(), drafts.refresh()]);
  };
  useEffect(() => {
    const timer = setInterval(() => void refreshMail(), 5000);
    return () => clearInterval(timer);
  }, [refreshMail]);
  const targetDraft = drafts.data?.find((d) => d.id === s.targetId && d.kind === 'EMAIL_REPLY');
  const id = selected || (targetDraft?.payload as ReplyPayload | undefined)?.mailId || s.targetId;
  const detail = useResource<MailItem>(
    tab === 'graph' && id ? '/mail/' + encodeURIComponent(id) : null,
  );
  const item = detail.data;
  const job = s.snapshot?.jobs
    .filter((j) => j.kind === 'assistant-chat' && j.relatedId === channel)
    .at(-1);
  return (
    <div className="panel-content">
      <h2>Inbox</h2>
      <p className="microcopy">
        Read messages and reports here. Notifications lists what needs your attention.
      </p>
      <div className="panel-tabs">
        <button className={tab === 'outlook' ? 'active' : ''} onClick={() => setTab('outlook')}>
          Outlook
        </button>
        <button className={tab === 'teams' ? 'active' : ''} onClick={() => setTab('teams')}>
          Teams
        </button>
        <button className={tab === 'graph' ? 'active' : ''} onClick={() => setTab('graph')}>
          Outlook API
        </button>
        <button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>
          AI team
        </button>
      </div>
      {tab === 'outlook' || tab === 'teams' ? (
        <BrowserInbox key={tab} provider={tab} />
      ) : tab === 'team' ? (
        <>
          <label className="studio-feedback">
            Teammate
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="inbox">Company updates</option>
              <option value="general">General team chat</option>
              <option value="engineering">Engineering</option>
              <option value="operations">Operations</option>
              <option value="announcements">Announcements</option>
              {s.employees.map((e) => (
                <option value={e.id} key={e.id}>
                  {e.name} · {e.role}
                </option>
              ))}
            </select>
          </label>
          <Chat key={channel} channel={channel} />
          {job && (
            <div className="chat-job">
              <Status state={job.state} />
              <p>{job.state === 'COMPLETED' ? 'Real response saved above.' : job.result}</p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="work-actions">
            <button
              className="button secondary"
              disabled={action.busy || mail.data?.sync?.state === 'RUNNING'}
              onClick={async () => {
                await action.execute(() => post('/mail/sync', {}));
                await refresh();
              }}
            >
              {mail.data?.sync?.state === 'RUNNING'
                ? 'Syncing inbox…'
                : mail.data?.sync?.cursor
                  ? 'Resume inbox sync'
                  : 'Fetch Outlook inbox'}
            </button>
            <button className="text-button" onClick={() => s.open('connections')}>
              Connect Outlook
            </button>
          </div>
          {mail.data?.sync && (
            <p className="microcopy">
              {mail.data.sync.state} · {mail.data.sync.processed} message updates processed ·{' '}
              {mail.data.sync.complete ? 'Full initial inbox loaded' : 'Initial inbox not complete'}
              {mail.data.sync.lastSyncAt
                ? ' · Last successful sync ' + dateTime(mail.data.sync.lastSyncAt)
                : ''}
            </p>
          )}
          <ErrorText
            error={
              action.error || mail.error || mail.data?.sync?.error || drafts.error || detail.error
            }
          />
          <label className="studio-feedback">
            Search inbox
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
              placeholder="Project number, subject or sender"
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={onlyProjects}
              onChange={(e) => {
                setOnlyProjects(e.target.checked);
                setOffset(0);
              }}
            />
            <span>Project and proposal messages only</span>
          </label>
          <div className="studio-ideas">
            {mail.data?.items.map((message) => (
              <button
                className={item?.id === message.id ? 'selected' : ''}
                key={message.id}
                onClick={() => {
                  setSelected(message.id);
                  setReply('');
                  setShareWithAI(false);
                }}
              >
                <div>
                  <strong>{message.subject}</strong>
                  <small>
                    {message.from} · {message.routing.replaceAll('_', ' ')} ·{' '}
                    {message.receivedAt.slice(0, 10)}
                  </small>
                </div>
              </button>
            ))}
          </div>
          <div className="work-actions">
            <button
              className="text-button"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous messages
            </button>
            <button
              className="text-button"
              disabled={mail.data?.nextOffset == null}
              onClick={() => setOffset(mail.data!.nextOffset!)}
            >
              Next messages
            </button>
          </div>
          {!mail.data?.items.length && (
            <p>
              No Outlook messages have been fetched for this account. Connect Outlook and fetch your
              inbox.
            </p>
          )}
          {item && (
            <article className="mail-detail">
              <h3>{item.subject}</h3>
              <p>{item.from}</p>
              <p className="microcopy">
                {item.reason} Email activity does not establish hours worked.
              </p>
              <pre className="mail-body">{item.body}</pre>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={shareWithAI}
                  onChange={(e) => setShareWithAI(e.target.checked)}
                />
                <span>
                  Share this email (up to 16,000 characters) with my AI analyst for a real project
                  review. Model usage may incur charges.
                </span>
              </label>
              <button
                className="button secondary"
                disabled={!shareWithAI || action.busy}
                onClick={async () => {
                  const result = await action.execute(
                    () =>
                      post('/mail/' + item.id + '/analyze', {
                        approved: true,
                        version: item.version,
                      }),
                    'Email review queued for your AI analyst',
                  );
                  if (result) {
                    setTab('team');
                    setChannel('olivia');
                    setShareWithAI(false);
                  }
                }}
              >
                Ask my analyst to review this email
              </button>
              <form
                className="stacked-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const result = await action.execute(
                    () => post('/mail/' + item.id + '/reply-draft', { body: reply }),
                    'Reply saved as a draft. Review before sending.',
                  );
                  if (result) {
                    setReply('');
                    await refresh();
                  }
                }}
              >
                <label>
                  Write a reply
                  <textarea
                    aria-label="Write a reply"
                    rows={5}
                    maxLength={12000}
                    required
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                </label>
                <button className="button secondary" disabled={action.busy}>
                  Save reply for approval
                </button>
              </form>
            </article>
          )}
          {drafts.data
            ?.filter(
              (draft) =>
                draft.kind === 'EMAIL_REPLY' &&
                ((draft.payload as ReplyPayload).mailId === item?.id || draft.id === s.targetId),
            )
            .map((draft) => (
              <ExternalDraftReview
                key={draft.id + ':' + draft.version + ':' + draft.state}
                draft={draft}
                refresh={refresh}
              />
            ))}
        </>
      )}
    </div>
  );
}
