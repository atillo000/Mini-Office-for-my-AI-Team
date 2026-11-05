import type { Store } from '../db';
import type { Job, Message } from '../../shared/types';
import type { VideoIdea } from '../../shared/studio';
import type { ExternalDraft, MailItem, NotificationItem } from '../../shared/connected';
import type { CapturedMessage, CommunicationReport, LocalReplyDraft } from '../../shared/reader';
export function notifications(store: Store): NotificationItem[] {
  const result: Omit<NotificationItem, 'read'>[] = [];
  for (const job of store.list<Job>('jobs')) {
    if (job.kind === 'assistant-chat' && job.state === 'COMPLETED') continue;
    const review = ['DRAFT', 'AWAITING_APPROVAL', 'REVIEW'].includes(job.state),
      failed = ['FAILED', 'INTERRUPTED', 'UNVERIFIED'].includes(job.state);
    if (!review && !failed && job.state !== 'COMPLETED') continue;
    result.push({
      id: 'job:' + job.id,
      category: failed ? 'ERROR' : review ? 'APPROVAL' : 'RESULT',
      title: job.title,
      detail: job.state + ': ' + job.result,
      at: job.updatedAt,
      revision: job.approvalRequest?.id || job.state + ':' + job.attempts,
      target: {
        panel:
          job.kind === 'content-ideas'
            ? 'start'
            : job.kind === 'assistant-chat' || job.kind === 'communication-review'
              ? 'inbox'
              : 'projects',
        id: job.id,
        channel: job.relatedId,
      },
      actions: [review ? 'REVIEW' : 'OPEN'],
    });
  }
  for (const idea of store.list<VideoIdea>('video_ideas'))
    if (['DRAFT', 'CHANGES_REQUESTED'].includes(idea.status))
      result.push({
        id: 'idea:' + idea.id,
        category: 'APPROVAL',
        title: idea.title,
        detail: 'Review video idea · ' + idea.status,
        at: idea.updatedAt,
        revision: String(idea.version),
        target: { panel: 'start', id: idea.id },
        actions: ['REVIEW'],
      });
  for (const draft of store.list<ExternalDraft>('external_drafts'))
    if (draft.state !== 'REJECTED')
      result.push({
        id: 'external:' + draft.id,
        category:
          draft.state === 'DRAFT'
            ? 'APPROVAL'
            : ['FAILED', 'UNKNOWN_OUTCOME'].includes(draft.state)
              ? 'ERROR'
              : 'RESULT',
        title: draft.kind === 'EMAIL_REPLY' ? 'Review Outlook reply' : 'Review Zoho time log',
        detail:
          draft.state +
          ' · ' +
          (draft.error ||
            (draft.kind === 'EMAIL_REPLY'
              ? (draft.payload as { subject: string }).subject
              : (draft.payload as { description: string }).description)),
        at: draft.updatedAt,
        revision: draft.state + ':' + draft.version,
        target: { panel: draft.kind === 'EMAIL_REPLY' ? 'inbox' : 'timelogs', id: draft.id },
        actions: [draft.state === 'DRAFT' ? 'REVIEW' : 'OPEN'],
      });
  const syncAccount = store.get<{ account: string }>('connected_account', 'outlook')?.account;
  const mailRows = store.db
    .prepare(
      "SELECT json_remove(data,'$.body') AS data FROM records WHERE kind='mail_items' AND json_extract(data,'$.account')=? AND json_extract(data,'$.removed')=0 ORDER BY json_extract(data,'$.receivedAt') DESC LIMIT 200",
    )
    .all(syncAccount || '') as { data: string }[];
  for (const mail of mailRows.map((r) => JSON.parse(r.data) as MailItem))
    if (!mail.removed && mail.account === syncAccount)
      result.push({
        id: 'mail:' + mail.id,
        category: 'EMAIL',
        title: mail.subject,
        detail: mail.from + ' · ' + mail.reason,
        at: Date.parse(mail.receivedAt) || 0,
        revision: mail.changeKey,
        target: { panel: 'inbox', id: mail.id },
        actions: ['OPEN', 'REPLY'],
      });
  for (const message of store.list<Message>('messages'))
    if (message.sender !== 'ceo' && message.mode === 'execution')
      result.push({
        id: 'chat:' + message.id,
        category: 'CHAT',
        title: store.get<{ name: string }>('employees', message.sender)?.name || message.sender,
        detail: message.text,
        at: message.at,
        revision: message.id,
        target: { panel: 'inbox', id: message.id, channel: message.channel },
        actions: ['REPLY'],
      });
  for (const message of store.list<CapturedMessage>('captured_messages').slice(-200))
    result.push({
      id: 'captured:' + message.id,
      category: message.provider === 'outlook' ? 'EMAIL' : 'CHAT',
      title: message.scope,
      detail: message.text,
      at: message.firstSeenAt,
      revision: String(message.version),
      target: { panel: 'inbox', id: message.id, channel: 'external:' + message.provider },
      actions: ['OPEN', 'REPLY'],
    });
  for (const report of store.list<CommunicationReport>('communication_reports'))
    for (const assessment of report.assessments)
      if (assessment.urgency === 'URGENT' || assessment.urgency === 'IMPORTANT')
        result.push({
          id: 'assessment:' + report.id + ':' + assessment.messageId,
          category: assessment.urgency === 'URGENT' ? 'URGENT' : 'RESULT',
          title: assessment.urgency.toLowerCase() + ': ' + report.scope,
          detail: 'AI assessment: ' + assessment.reason,
          at: report.createdAt,
          revision: report.id,
          target: { panel: 'inbox', id: report.id, channel: 'external:' + report.provider },
          actions: ['OPEN'],
        });
  for (const draft of store.list<LocalReplyDraft>('local_reply_drafts'))
    if (draft.status === 'DRAFT')
      result.push({
        id: 'local-draft:' + draft.id,
        category: 'APPROVAL',
        title: 'Review local ' + draft.provider + ' reply',
        detail: draft.body,
        at: draft.updatedAt,
        revision: String(draft.version),
        target: { panel: 'inbox', id: draft.id, channel: 'external:' + draft.provider },
        actions: ['REVIEW'],
      });
  return result
    .map((n) => ({
      ...n,
      detail: n.detail.slice(0, 500),
      read: store.get<{ revision: string }>('notification_reads', n.id)?.revision === n.revision,
    }))
    .sort((a, b) => b.at - a.at);
}
