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
  snapshot: ReaderSnapshot;
  messages: CapturedMessage[];
  consentHash: string;
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
  reportId: string;
  scope: string;
  body: string;
  status: 'DRAFT' | 'REVIEWED' | 'ARCHIVED';
  version: number;
  createdAt: number;
  updatedAt: number;
  origin: 'AI' | 'CEO';
}
