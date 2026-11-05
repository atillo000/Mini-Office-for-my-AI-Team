import type { KnowledgeProject } from './work';
import type { Job } from './types';
export interface WorkProfile {
  id: 'me';
  about: string;
  responsibilities: string;
  routines: string;
  communication: string;
  goals: string;
  confirmed: boolean;
  version: number;
  updatedAt: number;
}
export interface SharedMemory {
  profile: WorkProfile | null;
  projects: Pick<
    KnowledgeProject,
    'id' | 'name' | 'role' | 'description' | 'responsibilities' | 'version'
  >[];
  capturedAt: number;
}
export interface VideoBrief {
  id: string;
  direction: string;
  audience: string;
  language: string;
  durationSeconds: number;
  version: number;
  updatedAt: number;
}
export interface VideoIdeaContent {
  title: string;
  genre: string;
  hook: string;
  concept: string;
  language: string;
  durationSeconds: number;
  script: string;
  scenes: { visual: string; narration: string; seconds: number }[];
  youtubeCaption: string;
  facebookCaption: string;
}
export interface VideoIdea extends VideoIdeaContent {
  id: string;
  projectId: string;
  status: 'DRAFT' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED';
  origin: 'STARTER' | 'AI' | 'MANUAL';
  generationJobId?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  approval?: { at: number; approvedBy: 'ceo'; contentHash: string; version: number };
  feedback: {
    id: string;
    text: string;
    at: number;
    action: 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED';
    reusable: boolean;
  }[];
}
export interface ContentRequest {
  production?: VideoProductionPolicy;
  brief: VideoBrief;
  project: SharedMemory['projects'][number];
  memory: SharedMemory | null;
  feedback: string[];
}
export interface StudioSnapshot {
  production: VideoProductionPolicy;
  profile: WorkProfile;
  project: KnowledgeProject | null;
  brief: VideoBrief | null;
  ideas: VideoIdea[];
  jobs: Job[];
  publishing: {
    youtube: 'NOT_CONNECTED';
    facebook: 'NOT_CONNECTED';
    videoRendering: 'NOT_CONNECTED';
  };
}
export interface VideoProductionPolicy {
  version: number;
  freeOnly: true;
  tool: 'Google Flow';
  model: 'Veo 3.1 Lite';
  dailyCreditLimit: 50;
  creditsPerGeneration: 10;
  outputsPerScene: 1;
  sceneCount: 4 | 5;
  verifyBalanceBeforeGeneration: true;
  allowPaidTopUps: false;
}
