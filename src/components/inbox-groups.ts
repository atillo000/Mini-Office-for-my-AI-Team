import type { NotificationItem } from '../../shared/connected';
export const notificationGroups = [
  { id: 'urgent', title: 'Urgent', description: 'Time-sensitive findings', open: true },
  {
    id: 'zoho',
    title: 'Zoho time logs',
    description: 'Time-log approvals, timers and submission results',
    open: true,
  },
  {
    id: 'approval',
    title: 'Other approvals',
    description: 'Video ideas, reply drafts and work decisions',
    open: true,
  },
  {
    id: 'problem',
    title: 'Problems to resolve',
    description: 'Connection and task errors',
    open: true,
  },
  { id: 'outlook', title: 'Outlook emails', description: 'Captured work emails', open: false },
  { id: 'teams', title: 'Teams messages', description: 'Captured work conversations', open: false },
  { id: 'team', title: 'My AI team', description: 'Messages from your teammates', open: false },
  {
    id: 'result',
    title: 'Reports and completed work',
    description: 'Finished reviews and results',
    open: false,
  },
] as const;
export function notificationGroup(
  item: NotificationItem,
): (typeof notificationGroups)[number]['id'] {
  if (item.category === 'URGENT') return 'urgent';
  if (item.target.panel === 'timelogs') return 'zoho';
  if (item.category === 'ERROR') return 'problem';
  if (item.category === 'APPROVAL') return 'approval';
  if (item.category === 'EMAIL') return 'outlook';
  if (item.category === 'CHAT') return item.target.channel === 'external:teams' ? 'teams' : 'team';
  return 'result';
}
export function notificationLabel(item: NotificationItem) {
  return {
    URGENT: 'Urgent',
    APPROVAL: 'Needs a decision',
    ERROR: 'Needs attention',
    EMAIL: 'Email',
    CHAT: 'Message',
    RESULT: 'Result',
  }[item.category];
}
export function matchesSearch(query: string, ...values: (string | undefined)[]) {
  const text = values.filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase();
  return query
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((term) => text.includes(term));
}
