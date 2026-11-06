export type ReaderProvider = 'outlook' | 'teams';
export type CaptureMode = 'LIST' | 'SELECTED';
export interface RenderedMessage {
  sourceId: string;
  text: string;
  author: string;
  sentAt: string;
  preview: boolean;
}
export interface RenderedView {
  sourceUrl: string;
  scope: string;
  mode: CaptureMode;
  messages: RenderedMessage[];
  truncated: boolean;
}
export interface ReaderState {
  provider: ReaderProvider;
  state: 'CLOSED' | 'OPEN' | 'READING' | 'NEEDS_SIGN_IN' | 'NEEDS_SELECTION' | 'ERROR';
  mode: CaptureMode;
  watching: boolean;
  shareWithAI: boolean;
  scope: string;
  lastReadAt?: number;
  lastError?: string;
  lastNotice?: string;
}
export interface CapturedMessage extends RenderedMessage {
  id: string;
  provider: ReaderProvider;
  scope: string;
  sourceUrl: string;
  firstSeenAt: number;
  observedAt: number;
  version: number;
}
export interface ReaderSnapshot {
  id: string;
  provider: ReaderProvider;
  scope: string;
  sourceUrl: string;
  mode: CaptureMode;
  messageIds: string[];
  capturedAt: number;
  hash: string;
  complete: false;
  coverage: string;
}
export interface CommunicationRequest {
  automation?: { provider: ReaderProvider; version: number };
  focus?: { numbers: string[]; selfNames: string[]; notice: string };
  snapshot: ReaderSnapshot;
  messages: CapturedMessage[];
  consentHash: string;
}
export interface ReaderAutomationSettings {
  provider: ReaderProvider;
  enabled: boolean;
  shareWithAI: boolean;
  intervalMinutes: number;
  version: number;
}
export interface ReaderAutomationState {
  provider: ReaderProvider;
  status: 'OFF' | 'STARTING' | 'READING' | 'MONITORING' | 'NEEDS_SIGN_IN' | 'NEEDS_ATTENTION';
  visitedViews: number;
  capturedMessages: number;
  lastRunAt?: number;
  nextRunAt?: number;
  error?: string;
  coverage?: string;
}
export interface ReaderTarget {
  id: string;
  label: string;
}
export interface MessageAssessment {
  messageId: string;
  urgency: 'URGENT' | 'IMPORTANT' | 'ROUTINE' | 'UNCERTAIN';
  reason: string;
  evidence: string;
  draftReply: string | null;
  sourceText: string;
  sourceObservedAt: number;
}
export interface CommunicationReport {
  id: string;
  jobId: string;
  snapshotId: string;
  provider: ReaderProvider;
  scope: string;
  summary: string;
  assessments: MessageAssessment[];
  coverage: string;
  createdAt: number;
}
export interface LocalReplyDraft {
  id: string;
  provider: ReaderProvider;
  sourceMessageId: string;
  sourceVersion?: number;
  reportId: string;
  scope: string;
  body: string;
  status: 'DRAFT' | 'REVIEWED' | 'ARCHIVED';
  version: number;
  createdAt: number;
  updatedAt: number;
  origin: 'AI' | 'CEO';
}
