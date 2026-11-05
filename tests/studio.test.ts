import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Employee, Job } from '../shared/types';
import { Store } from '../server/db';
import { createApp } from '../server/app';
import { StudioService, contentOf, contentScope } from '../server/studio/service';
import { MemoryService } from '../server/studio/memory';
import { WorkService } from '../server/work/service';
import { CodexAdapter } from '../server/agents/codex';
import { Artifacts, digest } from '../server/agents/artifacts';
import type { CodexRun } from '../server/agents/protocol';
const stores: Store[] = [],
  apps: FastifyInstance[] = [];
function setup() {
  const store = new Store(':memory:');
  stores.push(store);
  const studio = new StudioService(store);
  studio.setup();
  return { store, studio, memory: new MemoryService(store) };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  stores.splice(0).forEach((s) => s.close());
});
const review = (
  idea: ReturnType<StudioService['snapshot']>['ideas'][number],
  action = 'APPROVED',
  feedback = '',
  rememberFeedback = false,
) => ({
  version: idea.version,
  contentHash: digest(contentOf(idea)),
  action,
  feedback,
  rememberFeedback,
});
function profileInput(memory: MemoryService, confirmed = true) {
  const { about, responsibilities, routines, communication, goals, version } = memory.profile();
  return { about, responsibilities, routines, communication, goals, version, confirmed };
}
describe('Video studio and work memory', () => {
  it('sets up once, keeps an honest starter draft and never invents routines or confirms a profile', () => {
    const { store, studio, memory } = setup();
    const first = studio.snapshot();
    expect(studio.setup().project?.id).toBe(first.project!.id);
    expect(store.list('knowledge_projects')).toHaveLength(1);
    expect(first.ideas).toHaveLength(1);
    expect(first.ideas[0]).toMatchObject({ status: 'DRAFT', origin: 'STARTER' });
    expect(first.brief!.direction).toContain('patok sa masa');
    expect(memory.profile()).toMatchObject({ confirmed: false, routines: '' });
    expect(store.list('jobs')).toHaveLength(0);
  });
  it('ties approval to the current content and clears it after edits', () => {
    const { studio } = setup();
    const idea = studio.snapshot().ideas[0];
    expect(() => studio.review(idea.id, { ...review(idea), contentHash: '0'.repeat(64) })).toThrow(
      'Idea changed',
    );
    const approved = studio.review(idea.id, review(idea));
    expect(approved.approval).toMatchObject({
      contentHash: digest(contentOf(idea)),
      version: approved.version,
    });
    expect(() => studio.review(idea.id, review(idea))).toThrow('Idea changed');
    const edited = studio.updateIdea(idea.id, {
      version: approved.version,
      content: { ...contentOf(approved), title: 'A revised draft' },
    });
    expect(edited.status).toBe('DRAFT');
    expect(edited.approval).toBeUndefined();
    expect(() => studio.review(idea.id, review(approved))).toThrow('Idea changed');
  });
  it('requires useful revision feedback and reuses only explicitly remembered feedback', () => {
    const { studio } = setup();
    let idea = studio.snapshot().ideas[0];
    expect(() => studio.review(idea.id, review(idea, 'CHANGES_REQUESTED'))).toThrow('Describe');
    idea = studio.review(idea.id, review(idea, 'CHANGES_REQUESTED', 'Less narration, please.'));
    expect(studio.request(false).feedback).toEqual([]);
    studio.review(idea.id, review(idea, 'APPROVED', 'Use relatable dialogue.', true));
    expect(studio.request(false).feedback).toEqual(['APPROVED: Use relatable dialogue.']);
  });
  it('shares confirmed profile and selected project metadata only; rejects changed snapshots', () => {
    const { studio, store, memory } = setup();
    expect(() => studio.request(true)).toThrow('confirm');
    memory.save(profileInput(memory));
    const request = studio.request(true);
    store.put('work_records', 'private', { body: 'Unrelated private email' });
    new WorkService(store).saveProject({ name: 'Unrelated business', role: 'OBSERVER' });
    expect(JSON.stringify(request)).not.toContain('Unrelated');
    expect(request.memory?.projects).toHaveLength(1);
    expect(studio.request(false).memory).toBeNull();
    memory.save({ ...profileInput(memory), communication: 'Prefer concise updates' });
    expect(() => studio.assertRequest(request)).toThrow('profile changed');
    expect(() => memory.save({ ...profileInput(memory), version: 1 })).toThrow('Profile changed');
  });
  it('rejects stale briefs, wrong durations and model-supplied approvals; saves exactly three unapproved drafts', () => {
    const { studio } = setup();
    const contentRequest = studio.request(false);
    const job = { id: 'generation', projectId: contentRequest.project.id, contentRequest } as Job;
    const content = contentOf(studio.snapshot().ideas[0]);
    expect(() =>
      studio.generated(job, { ideas: [content, content, { ...content, status: 'APPROVED' }] }),
    ).toThrow();
    expect(() =>
      studio.generated(job, { ideas: [content, content, { ...content, durationSeconds: 30 }] }),
    ).toThrow();
    const generated = studio.generated(job, { ideas: [content, content, content] });
    expect(generated.every((i) => i.origin === 'AI' && i.status === 'DRAFT' && !i.approval)).toBe(
      true,
    );
    expect(() => studio.generated(job, { ideas: [content, content, content] })).toThrow(
      'already produced',
    );
    const { direction, audience, language, durationSeconds, version } = contentRequest.brief;
    studio.saveBrief({
      direction: direction + ' More comedy.',
      audience,
      language,
      durationSeconds,
      version,
    });
    expect(() => studio.assertRequest(contentRequest)).toThrow('direction changed');
  });
});

// Explicit test double. The live smoke script exercises the real CLI separately.
class DraftAdapter extends CodexAdapter {
  prompts: string[] = [];
  failAt = 0;
  content: unknown;
  constructor(content: unknown) {
    super(
      undefined,
      '/unused',
      new Artifacts(mkdtempSync(path.join(os.tmpdir(), 'office-studio-'))),
    );
    this.content = content;
  }
  async health() {
    return {
      available: true,
      executionReady: true,
      version: 'Test double',
      detail: 'Fixture only',
    };
  }
  async execute(
    _workspace: string,
    prompt: string,
    _signal: AbortSignal,
    _log: (s: string) => void,
    _jobId: string,
    readOnly = false,
    _schema?: string,
    skipGitCheck = false,
  ): Promise<CodexRun> {
    expect(readOnly).toBe(true);
    expect(skipGitCheck).toBe(true);
    this.prompts.push(prompt);
    if (this.failAt === this.prompts.length) throw new Error('Fixture CLI failure');
    return {
      text:
        this.prompts.length === 3
          ? JSON.stringify({ ideas: [this.content, this.content, this.content] })
          : 'Team discussion fixture',
      completed: true,
      threadId: 'test-double-' + this.prompts.length,
      exitCode: 0,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
  }
}
async function apiFixture() {
  const store = new Store(':memory:');
  const studio = new StudioService(store);
  studio.setup();
  const adapter = new DraftAdapter(contentOf(studio.snapshot().ideas[0]));
  const app = await createApp(store, { skipExternal: true, token: '', adapter });
  apps.push(app);
  return { store, studio, adapter, app };
}
async function finished(store: Store, id: string) {
  for (let i = 0; i < 200; i++) {
    const job = store.get<Job>('jobs', id)!;
    if (['FAILED', 'COMPLETED', 'CANCELLED'].includes(job.state)) return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Fixture queue did not finish');
}
describe('Durable content jobs', () => {
  it('requires exact drafting consent; performs three sequential runs and exposes results without any coding repository', async () => {
    const { app, store, studio, adapter } = await apiFixture();
    const coordinator = store.get<Employee>('employees', 'sarah')!;
    store.put('employees', 'sarah', { ...coordinator, name: 'Customized coordinator' });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/studio/generate',
          payload: { briefVersion: 1 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/studio/generate',
          payload: {
            briefVersion: 99,
            approved: true,
            scopeHash: contentScope(studio.request(false)),
          },
        })
      ).statusCode,
    ).toBe(400);
    const response = await app.inject({
      method: 'POST',
      url: '/api/studio/generate',
      payload: { briefVersion: 1, approved: true, scopeHash: contentScope(studio.request(false)) },
    });
    expect(response.statusCode).toBe(200);
    const job = await finished(store, response.json().id);
    expect(job.state).toBe('COMPLETED');
    expect(job.evidence).toBeUndefined();
    expect(job.subtasks.map((t) => t.agentId)).toEqual(['sarah', 'olivia', 'mia']);
    expect(adapter.prompts[0]).toContain('You are Customized coordinator');
    expect(adapter.prompts[1]).toContain('sarah: Team discussion fixture');
    expect(adapter.prompts[2]).toContain('olivia: Team discussion fixture');
    expect(studio.snapshot().ideas.filter((i) => i.origin === 'AI')).toHaveLength(3);
    expect(
      (await app.inject({ method: 'POST', url: '/api/jobs/' + job.id + '/accept', payload: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/api/studio/publish', payload: {} })).statusCode,
    ).toBe(409);
    expect((await app.inject('/api/studio')).json().ideas[0].contentHash).toHaveLength(64);
    expect((await app.inject('/api/jobs/' + job.id + '/artifacts/run-2.json')).statusCode).toBe(
      200,
    );
    expect(store.list('projects')).toHaveLength(0);
  });
  it('reports a real execution failure and never manufactures drafts or success', async () => {
    const { app, store, studio, adapter } = await apiFixture();
    adapter.failAt = 2;
    const response = await app.inject({
      method: 'POST',
      url: '/api/studio/generate',
      payload: { briefVersion: 1, approved: true, scopeHash: contentScope(studio.request(false)) },
    });
    const job = await finished(store, response.json().id);
    expect(job.state).toBe('FAILED');
    expect(job.result).toContain('Fixture CLI failure');
    expect(studio.snapshot().ideas.filter((i) => i.origin === 'AI')).toHaveLength(0);
  });
});
