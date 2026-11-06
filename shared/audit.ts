import type { RemoteTimeLog } from './connected';
export interface TimeAudit {
  portalId: string;
  ownerId: string;
  startDate: string;
  endDate: string;
  complete: boolean;
  checkedAt: number;
  days: {
    date: string;
    state: string;
    loggedMinutes: number | null;
    expectedMinutes: number | null;
    missingMinutes: number | null;
    items: RemoteTimeLog[];
    localDrafts: { id: string; state: string; minutes: number }[];
    duplicateCandidates: string[];
  }[];
}
