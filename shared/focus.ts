export interface WorkFocus {
  enabled: boolean;
  mode: 'SELECTED' | 'ACCESSIBLE';
  selectedNumbers: string[];
  selfNames: string[];
  portalId: string;
  version: number;
}
export interface FocusProject {
  id: string;
  name: string;
  numbers: string[];
}
export interface FocusCatalog {
  account: string;
  portalId: string;
  projects: FocusProject[];
  checkedAt: number;
  complete: true;
}
export interface MessageRelevance {
  relevant: boolean;
  kind: 'PROJECT' | 'MEETING_CANDIDATE' | 'OTHER';
  numbers: string[];
  reason: string;
}
