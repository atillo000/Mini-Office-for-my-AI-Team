// Corporate work records are separate from coding repositories, office messages and avatar state.
export const applications = ['outlook', 'teams', 'zoho'] as const;
export type Application = (typeof applications)[number];
export const integrationModes = [
  'AUTO',
  'API_ONLY',
  'BROWSER_ONLY',
  'MANUAL_ONLY',
  'SIMULATION_ONLY',
] as const;
export type IntegrationMode = (typeof integrationModes)[number];
export type IntegrationMethod = 'API' | 'BROWSER' | 'MANUAL' | 'SIMULATION';
export const operations = {
  outlook: ['listMessages', 'getMessage', 'classifyMessages', 'prepareBriefing'],
  teams: [
    'getAuthorizedMessages',
    'getAuthorizedConversation',
    'classifyMessage',
    'prepareReply',
    'submitApprovedReply',
    'createManualMeetingRecord',
  ],
  zoho: [
    'listPortals',
    'listProjects',
    'listTasks',
    'listIssues',
    'getTimeLogs',
    'prepareTimeLog',
    'submitApprovedTimeLog',
  ],
} as const;
export type Operation = (typeof operations)[Application][number];
export type IntegrationErrorCode =
  | 'UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'AUTH_REQUIRED'
  | 'UNAVAILABLE'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'VALIDATION'
  | 'APPROVAL_REQUIRED'
  | 'UNKNOWN_OUTCOME'
  | 'CANCELLED';
export interface IntegrationFailure {
  code: IntegrationErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}
export interface AdapterHealth {
  health: 'HEALTHY' | 'UNAVAILABLE' | 'UNKNOWN';
  authentication: 'AUTHENTICATED' | 'REQUIRED' | 'NOT_APPLICABLE';
  authorization: 'AUTHORIZED' | 'DENIED' | 'UNKNOWN';
  capabilities: Operation[];
  scopes: string[];
  failure?: IntegrationFailure;
}
export interface Connection {
  id: Application;
  mode: IntegrationMode;
  apiAllowed: boolean;
  browserAllowed: boolean;
  policyConfirmedAt: number | null;
  version: number;
  updatedAt: number;
  lastSuccessAt: number | null;
  lastSyncAt: number | null;
}
export interface ConnectionView extends Connection {
  checkedAt: number;
  name: string;
  adapters: Partial<Record<IntegrationMethod, AdapterHealth>>;
  errors: { at: number; operation: Operation; failure: IntegrationFailure }[];
  detail: string;
}
export interface IntegrationRequest {
  application: Application;
  operation: Operation;
  input: Record<string, unknown>;
  signal?: AbortSignal;
}
export interface RouteDecision {
  method: IntegrationMethod | null;
  reason: string;
  failure?: IntegrationFailure;
}
export interface IntegrationRun {
  id: string;
  application: Application;
  operation: Operation;
  method: IntegrationMethod | null;
  state: 'EXECUTING' | 'VERIFIED' | 'FAILED' | 'UNSUPPORTED' | 'UNKNOWN_OUTCOME';
  reason: string;
  simulated: boolean;
  startedAt: number;
  finishedAt?: number;
  attempts: number;
  failure?: IntegrationFailure;
  result?: unknown;
  events?: { at: number; method: IntegrationMethod | null; failure: IntegrationFailure }[];
}
export const projectRoles = [
  'PROJECT_OWNER',
  'TECHNICAL_LEAD',
  'DEVELOPER',
  'SUPPORT_ENGINEER',
  'BACKUP_SUPPORT',
  'OBSERVER',
] as const;
export type ProjectRole = (typeof projectRoles)[number];
export const classifications = [
  'PROJECT_LEAD',
  'PROJECT_SUPPORT',
  'IT_HELPDESK',
  'IT_ADVISORY',
  'HR_COMMUNICATION',
  'MEETING',
  'CLIENT_REQUEST',
  'PROMOTIONAL',
  'GENERAL',
  'NEEDS_REVIEW',
] as const;
export type ClassificationLabel = (typeof classifications)[number];
export type InputSource = 'outlook' | 'teams' | 'manual';
export interface KnowledgeProject {
  id: string;
  name: string;
  aliases: string[];
  department: string;
  description: string;
  role: ProjectRole;
  stakeholders: string[];
  applications: string[];
  technologies: string[];
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETE' | 'ARCHIVED';
  responsibilities: string[];
  repositoryId?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}
export interface ZohoMapping {
  routingCategory?: 'PROJECT' | 'GENERAL' | 'BUSINESS_DEVELOPMENT' | 'NEEDS_REVIEW';
  projectNumber?: string;
  id: string;
  knowledgeProjectId: string;
  activityName: string;
  portalId?: string;
  projectId?: string;
  taskId?: string;
  issueId?: string;
  module: 'TASK' | 'ISSUE' | 'GENERAL';
  billing: 'BILLABLE' | 'NON_BILLABLE' | 'UNKNOWN';
  approvedDescriptions: string[];
  source: 'USER_CONFIRMED';
  verifiedAt: number | null;
  note: string;
  version: number;
  updatedAt: number;
}
export interface WorkRule {
  id: string;
  name: string;
  enabled: boolean;
  source: InputSource | 'any';
  terms: string[];
  match: 'ALL' | 'ANY';
  sender?: string;
  knowledgeProjectId?: string;
  mappingId?: string;
  labels: ClassificationLabel[];
  requiredFields: ('date' | 'duration' | 'project' | 'attendance')[];
  confidence: number;
  origin: 'USER_CONFIRMED' | 'CONFIRMED_CORRECTION';
  explanation: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}
export interface WorkClassification {
  labels: ClassificationLabel[];
  projectId: string | null;
  candidateProjectIds: string[];
  confidence: number;
  explanation: string[];
  ruleIds: string[];
  conflict: boolean;
  missing: string[];
  mappingId: string | null;
}
export interface WorkRecord {
  id: string;
  source: InputSource;
  kind: 'EMAIL' | 'MESSAGE' | 'ACTIVITY' | 'MEETING';
  subject: string;
  body: string;
  sender: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  attendanceConfirmed: boolean;
  activityConfirmed: boolean;
  provenance: 'MANUAL';
  classification: WorkClassification;
  version: number;
  createdAt: number;
  updatedAt: number;
}
export interface LearningRecord {
  id: string;
  recordId: string;
  originalInput: Pick<WorkRecord, 'source' | 'subject' | 'body' | 'sender'>;
  previous: WorkClassification;
  corrected: WorkClassification;
  explanation: string;
  scope: 'THIS_RECORD';
  ruleId?: string;
  createdAt: number;
}
export interface WorkAudit {
  id: string;
  at: number;
  action: string;
  entityType: string;
  entityId: string;
  version?: number;
}
export interface WorkSnapshot {
  projects: KnowledgeProject[];
  mappings: ZohoMapping[];
  rules: WorkRule[];
  records: WorkRecord[];
  learning: LearningRecord[];
  audit: WorkAudit[];
}
