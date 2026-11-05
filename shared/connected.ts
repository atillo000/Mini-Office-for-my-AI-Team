export type AccountProvider = 'outlook' | 'zoho';
export interface AccountConfig {
  provider: AccountProvider;
  clientId: string;
  tenant: string;
  region: string;
  version: number;
}
export interface AccountView extends AccountConfig {
  configured: boolean;
  connected: boolean;
  account?: string;
  expiresAt?: number;
  scopes: string[];
  hasClientSecret: boolean;
  callbackUrl: string;
}
export interface MailItem {
  id: string;
  account: string;
  providerId: string;
  changeKey: string;
  subject: string;
  body: string;
  from: string;
  replyTo: string[];
  receivedAt: string;
  isRead: boolean;
  webLink: string;
  removed: boolean;
  projectIds: string[];
  projectNumbers: string[];
  routing: 'PROJECT' | 'GENERAL' | 'BUSINESS_DEVELOPMENT' | 'NEEDS_REVIEW';
  reason: string;
  version: number;
}
export interface MailSync {
  id: 'inbox';
  account: string;
  state: 'IDLE' | 'RUNNING' | 'FAILED' | 'INTERRUPTED';
  cursor?: string;
  delta?: string;
  processed: number;
  complete: boolean;
  lastSyncAt?: number;
  error?: string;
}
export interface ZohoEntity {
  id: string;
  name: string;
  projectId?: string;
  email?: string;
  status?: string;
}
export interface RemoteTimeLog {
  id: string;
  projectId: string;
  projectName: string;
  ownerId: string;
  date: string;
  minutes: number | null;
  description: string;
  billing: string;
  module: string;
  moduleId?: string;
  startTime?: string;
  endTime?: string;
}
export interface TimeLogPayload {
  account: string;
  portalId: string;
  projectId: string;
  projectName: string;
  category: 'PROJECT' | 'GENERAL' | 'BUSINESS_DEVELOPMENT';
  projectNumber: string;
  proposalStage: boolean;
  module: 'task' | 'issue' | 'general';
  taskId?: string;
  taskName?: string;
  ownerId: string;
  ownerName: string;
  date: string;
  durationMinutes: number;
  startTime?: string;
  endTime?: string;
  billing: 'Billable' | 'Non Billable';
  description: string;
  workConfirmed: true;
}
export interface ReplyPayload {
  account: string;
  mailId: string;
  providerId: string;
  changeKey: string;
  to: string;
  subject: string;
  body: string;
}
export interface ExternalDraft {
  id: string;
  kind: 'EMAIL_REPLY' | 'TIME_LOG';
  version: number;
  payload: ReplyPayload | TimeLogPayload;
  state:
    | 'DRAFT'
    | 'REVIEWED'
    | 'SUBMITTING'
    | 'SUBMITTED'
    | 'ACCEPTED'
    | 'FAILED'
    | 'UNKNOWN_OUTCOME'
    | 'REJECTED';
  scopeHash: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  approval?: { at: number; approvedBy: 'ceo'; version: number; scopeHash: string };
  receipt?: { providerId?: string; requestId?: string; status: number; verifiedAt?: number };
}
export interface NotificationItem {
  id: string;
  category: 'URGENT' | 'APPROVAL' | 'EMAIL' | 'CHAT' | 'RESULT' | 'ERROR';
  title: string;
  detail: string;
  at: number;
  revision: string;
  read: boolean;
  target: {
    panel: 'projects' | 'start' | 'inbox' | 'connections' | 'timelogs';
    id: string;
    channel?: string;
  };
  actions: ('OPEN' | 'REVIEW' | 'REPLY')[];
}
