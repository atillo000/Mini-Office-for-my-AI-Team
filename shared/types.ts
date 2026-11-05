export type Activity =
  | 'IDLE'
  | 'WALKING'
  | 'WORKING'
  | 'MEETING'
  | 'CHATTING'
  | 'EATING'
  | 'EXERCISING'
  | 'RESTING'
  | 'REPORTING';
export type RoomId =
  'studio' | 'ceo' | 'meeting' | 'cafe' | 'gym' | 'lounge' | 'reception' | 'courtyard';
export type Point = [number, number];
export type Interaction =
  | 'none'
  | 'typing'
  | 'reading'
  | 'speaking'
  | 'listening'
  | 'coffee'
  | 'chatting'
  | 'eating'
  | 'treadmill'
  | 'weights'
  | 'stretching'
  | 'relaxing'
  | 'reporting'
  | 'waiting';
export interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
  color: string;
  skin: string;
  hair: string;
  personality: string;
  style: string;
  desk: Point;
  room: RoomId;
  schedule: { time: string; activity: Activity; room: RoomId }[];
}
export interface EmployeeRuntime {
  realStatus?: string;
  position: Point;
  state: Activity;
  room: RoomId;
  path: Point[];
  targetState: Activity;
  nextChange: number;
  history: { time: number; text: string }[];
  targetRoom?: RoomId;
  resourceId?: string;
  interaction?: Interaction;
  targetInteraction?: Interaction;
  heading?: number;
  targetHeading?: number;
  seated?: boolean;
  targetSeated?: boolean;
  elevation?: number;
  targetElevation?: number;
  elapsed?: number;
  goalKey?: string;
  completedGoal?: string;
  breakPhase?: 'coffee' | 'social';
  carrying?: 'mug';
  waitingFor?: string;
  blockedSeconds?: number;
  routineKey?: string;
  waitingSeconds?: number;
  retryIn?: number;
}
export type JobState =
  | 'DRAFT'
  | 'QUEUED'
  | 'PLANNING'
  | 'RUNNING'
  | 'TESTING'
  | 'AWAITING_APPROVAL'
  | 'VERIFYING'
  | 'UNVERIFIED'
  | 'REVIEW'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'INTERRUPTED';
export interface Subtask {
  id: string;
  title: string;
  agentId: string;
  dependsOn: string[];
  status: 'pending' | 'running' | 'reported' | 'done' | 'failed';
  result?: string;
}
export interface Job {
  id: string;
  title: string;
  instruction: string;
  agentId: string;
  projectId: string;
  kind?:
    | 'development'
    | 'conversation'
    | 'meeting'
    | 'content-ideas'
    | 'assistant-chat'
    | 'communication-review';
  communicationRequest?: import('./reader').CommunicationRequest;
  memory?: import('./studio').SharedMemory;
  contentRequest?: import('./studio').ContentRequest;
  relatedId?: string;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  subtasks: Subtask[];
  result: string;
  testResult: string;
  workspace: string;
  baseCommit?: string;
  logs: { at: number; text: string }[];
  stage?: 'plan' | 'implement' | 'test';
  policyHash?: string;
  source?: { path: string; commit: string; testCommand: Project['testCommand'] };
  approvalRequest?: ApprovalRequest;
  approvals?: ApprovalRecord[];
  testPlan?: TestPlan;
  evidence?: JobEvidence;
}
export interface ApprovalRequest {
  id: string;
  kind: 'implementation' | 'tests' | 'review';
  scopeHash: string;
  summary: string;
  createdAt: number;
}
export interface ApprovalRecord {
  id: string;
  kind: 'planning' | ApprovalRequest['kind'];
  scopeHash: string;
  at: number;
  approvedBy: 'ceo';
  attempt: number;
  allowDependencyInstall?: boolean;
}
export interface TestPlan {
  program: 'node' | 'npm';
  args: string[];
  label: string;
  sourceDigest: string;
  needsInstall: boolean;
  installAllowed: boolean;
  reason?: string;
  scripts: Record<string, string>;
}
export interface TestEvidence {
  status: 'passed' | 'failed' | 'no_tests';
  exitCode: number | null;
  count: number;
  output: string;
  command: string;
  startedAt: number;
  finishedAt: number;
}
export interface JobEvidence {
  sourceCommit: string;
  sourceDigest: string;
  changes: { path: string; change: 'added' | 'modified' | 'deleted'; sha256?: string }[];
  patchHash: string;
  manifestHash: string;
  bundleHash: string;
  capturedAt: number;
  verified: boolean;
  tests: TestEvidence;
  reason?: string;
}
export interface Project {
  id: string;
  name: string;
  path: string;
  approved: boolean;
  testCommand: 'auto' | 'none' | 'npm-test' | 'node-test';
  color: string;
}
export interface Message {
  id: string;
  channel: string;
  sender: string;
  text: string;
  at: number;
  mode: 'human' | 'simulation' | 'execution';
  read: boolean;
}
export interface Meeting {
  id: string;
  title: string;
  agenda: string;
  participants: string[];
  startsAt: number;
  duration: number;
  transcript: string[];
  transcriptMode?: 'human' | 'execution';
  actions: string[];
}
export interface Weather {
  city: string;
  temperature: number;
  code: number;
  condition: 'sunny' | 'cloudy' | 'rainy';
  fetchedAt: number;
  source: 'live' | 'cached' | 'offline';
  provider: string;
  timezone: string;
}
export interface Snapshot {
  employees: Employee[];
  projects: Project[];
  jobs: Job[];
  messages: Message[];
  meetings: Meeting[];
  weather: Weather;
  simulation: {
    minute: number;
    savedAt: number;
    history?: Record<string, EmployeeRuntime['history']>;
  };
  codex: {
    available: boolean;
    version: string;
    executionReady?: boolean;
    detail?: string;
  };
  authRequired: boolean;
}
