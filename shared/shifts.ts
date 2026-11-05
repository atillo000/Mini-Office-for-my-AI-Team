import type { CapturedMessage } from './reader';
import type { WorkRecord, ZohoMapping, KnowledgeProject } from './work';
export interface ShiftSettings {
  version: number;
  sproutUrl: string;
  enabled: boolean;
  shareWithAI: boolean;
  unpaidBreakMinutes: number;
  targetMinutes: number;
}
export interface AttendancePunch {
  at: number;
  type: 'IN' | 'OUT';
  source: string;
}
export interface AttendanceShift {
  id: string;
  clockIn: number;
  clockOut: number;
  sourceUrl: string;
  version: number;
  observedAt: number;
}
export interface ShiftEvidence {
  id: string;
  text: string;
  source: 'TEAMS' | 'WORK_RECORD';
  sentAt?: string;
}
export interface ShiftRequest {
  shift: AttendanceShift;
  settings: ShiftSettings;
  capacityMinutes: number;
  evidence: ShiftEvidence[];
  mappings: ZohoMapping[];
  projects: KnowledgeProject[];
  records: WorkRecord[];
  coverage: string;
}
export interface ShiftPlanRow {
  id: string;
  date: string;
  durationMinutes: number;
  description: string;
  mappingId: string | null;
  kind: 'MEETING' | 'PROJECT' | 'GENERAL';
  evidence: { id: string; quote: string }[];
}
export interface ShiftPlan {
  id: string;
  jobId: string;
  shiftId: string;
  shiftVersion: number;
  settingsVersion: number;
  clockIn: number;
  clockOut: number;
  capacityMinutes: number;
  rows: ShiftPlanRow[];
  summary: string;
  coverage: string;
  unallocatedMinutes: number;
  status: 'DRAFT' | 'PREPARING' | 'PREPARED' | 'NEEDS_REVIEW';
  version: number;
  createdAt: number;
  draftIds: Record<string, string>;
  error?: string;
  sourceMappings: ZohoMapping[];
}
export interface ShiftSnapshot {
  settings: ShiftSettings;
  reader: { open: boolean; lastCheckedAt?: number; error?: string; rowsSeen?: number };
  shifts: AttendanceShift[];
  plans: ShiftPlan[];
  jobs: import('./types').Job[];
  mappings: ZohoMapping[];
}
// Evidence is bounded before it reaches a model; these aliases document its source types.
export type ShiftMessageSource = CapturedMessage;
