import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../server/db';
import { JobQueue } from '../server/agents/queue';
import { CodexAdapter, validatePlan } from '../server/agents/codex';
import { Artifacts, type Manifest } from '../server/agents/artifacts';
import { redact } from '../server/process';
import type { CodexRun } from '../server/agents/protocol';
import type { Job, Project } from '../shared/types';
const receipt = (text: string): CodexRun => ({
  text,
  threadId: 'test-double',
  completed: true,
  exitCode: 0,
  startedAt: Date.now(),
  finishedAt: Date.now(),
});
// Injected test double only. Production always uses the real container adapter.
class TestAdapter extends CodexAdapter {
  calls: string[] = [];
  output = '# tests 2\n# pass 2';
  code = 0;
  changed = true;
  postDigest = 'changed';
  constructor() {
    super(
      undefined,
      '/isolated',
      new Artifacts(mkdtempSync(path.join(os.tmpdir(), 'office-jobs-'))),
    );
  }
  async health() {
    return {
      available: true,
      version: 'test double',
      executionReady: true,
      detail: 'unit fixture',
    };
  }
  async source(project: Project) {
    return { path: project.path, commit: 'a'.repeat(40), testCommand: project.testCommand };
  }
  async isolate(_project: Project, job: Job) {
    this.calls.push('isolate');
    job.workspace = '/isolated';
    job.baseCommit = job.source!.commit;
    await this.capture(job, 'baseline');
    return job.workspace;
  }
  async execute(_workspace: string, prompt: string) {
    if (prompt.includes('project manager')) {
      this.calls.push('plan');
      return receipt(
        JSON.stringify({
          summary: 'Implement and test',
          subtasks: [{ id: 'step', title: 'Fix endpoint', agentId: 'alex', dependsOn: [] }],
        }),
      );
    }
    this.calls.push('implement');
    return receipt('Employee claims all work is complete.');
  }
  async capture(job: Job, phase: 'baseline' | 'after' | 'tested' | 'post') {
    const value: Manifest = {
      sourceDigest: phase === 'baseline' ? 'base' : 'changed',
      files: [],
      scripts: { test: 'node --test' },
      nodeTests: ['test/api.test.js'],
      hasDependencies: false,
      hasNodeModules: false,
      installAllowed: false,
    };
    this.artifacts.write(job, `${phase}.json`, value);
    this.artifacts.write(
      job,
      `${phase}-changes.json`,
      this.changed ? [{ path: 'api.js', change: 'modified', sha256: 'abc' }] : [],
    );
    writeFileSync(path.join(this.artifacts.directory(job), `${phase}.patch`), '+ fixture');
    writeFileSync(path.join(this.artifacts.directory(job), `${phase}.tar.gz`), 'unit fixture');
    return value;
  }
  async inspectDigest() {
    return this.postDigest;
  }
  async tests() {
    this.calls.push('test');
    return { code: this.code, output: this.output };
  }
}
const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function setup() {
  const store = new Store(':memory:');
  stores.push(store);
  const adapter = new TestAdapter();
  const project: Project = {
    id: 'project',
    name: 'Fixture',
    path: '/approved',
    approved: true,
    testCommand: 'auto',
    color: '#fff',
  };
  store.put('projects', project.id, project);
  const job: Job = {
    id: 'job',
    title: 'Fix endpoint',
    instruction: 'Fix endpoint and test it',
    agentId: 'alex',
    projectId: project.id,
    state: 'DRAFT',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attempts: 0,
    subtasks: [],
    result: '',
    testResult: 'Not run',
    workspace: '',
    logs: [],
  };
  store.put('jobs', job.id, job);
  const queue = new JobQueue(store, () => {}, adapter);
  const saved = () => store.get<Job>('jobs', 'job')!;
  const approve = async (action: string, extra = {}) => {
    const request = saved().approvalRequest;
    await queue.authorize('job', action, {
      requestId: request?.id,
      scopeHash: request?.scopeHash,
      ...extra,
    });
  };
  const implement = async () => {
    await approve('approve');
    await queue.drain();
    await approve('approve-plan');
    await queue.drain();
  };
  return { store, adapter, queue, saved, approve, implement };
}
describe('durable execution queue', () => {
  it('requires separate scoped CEO approvals and verified artifacts before completion', async () => {
    const { queue, adapter, saved, approve } = setup();
    await approve('approve');
    await queue.drain();
    expect(saved().state).toBe('AWAITING_APPROVAL');
    expect(adapter.calls).toEqual(['isolate', 'plan']);
    await expect(
      queue.authorize('job', 'approve-plan', {
        requestId: 'stale',
        scopeHash: saved().approvalRequest!.scopeHash,
      }),
    ).rejects.toThrow('stale');
    await approve('approve-plan');
    await queue.drain();
    expect(saved().state).toBe('AWAITING_APPROVAL');
    expect(saved().subtasks[0].status).toBe('reported');
    expect(adapter.calls).not.toContain('test');
    await approve('approve-tests');
    await queue.drain();
    expect(saved().state).toBe('REVIEW');
    expect(saved().evidence?.verified).toBe(true);
    expect(saved().result).not.toContain('claims all');
    await approve('accept');
    expect(saved().state).toBe('COMPLETED');
    expect(saved().approvals).toHaveLength(4);
    expect(adapter.artifacts.json<Job['approvals']>(saved(), 'approvals.json')).toHaveLength(4);
    await queue.close();
  });
  it.each([
    [1, 'Assertion failed', 'FAILED'],
    [0, 'Tests passed!', 'UNVERIFIED'],
    [0, '# tests 0', 'UNVERIFIED'],
  ])('blocks completion for exit %s and output %s', async (code, output, state) => {
    const { queue, adapter, saved, approve, implement } = setup();
    adapter.code = Number(code);
    adapter.output = String(output);
    await implement();
    await approve('approve-tests');
    await queue.drain();
    expect(saved().state).toBe(state);
    expect(saved().testResult).toContain(output);
    await expect(approve('accept')).rejects.toThrow();
    await queue.close();
  });
  it('blocks source mutation during tests and empty implementation changes', async () => {
    const first = setup();
    first.adapter.postDigest = 'mutated';
    await first.implement();
    await first.approve('approve-tests');
    await first.queue.drain();
    expect(first.saved().state).toBe('UNVERIFIED');
    expect(first.saved().result).toContain('changed source');
    await first.queue.close();
    const second = setup();
    second.adapter.changed = false;
    await second.implement();
    expect(second.saved().state).toBe('UNVERIFIED');
    expect(second.adapter.calls).not.toContain('test');
    await second.queue.close();
  });
  it('rejects acceptance when saved artifacts were changed', async () => {
    const { queue, adapter, saved, approve, implement } = setup();
    await implement();
    await approve('approve-tests');
    await queue.drain();
    writeFileSync(path.join(adapter.artifacts.directory(saved()), 'tested.patch'), 'tampered');
    await expect(approve('accept')).rejects.toThrow('evidence changed');
    expect(saved().state).toBe('REVIEW');
    await queue.close();
  });
  it('marks interrupted work and legacy claims honestly on restart', () => {
    const { store, saved } = setup();
    store.put('jobs', 'job', { ...saved(), state: 'RUNNING' });
    new JobQueue(store, () => {}, new TestAdapter());
    expect(saved().state).toBe('INTERRUPTED');
    store.put('jobs', 'job', { ...saved(), state: 'COMPLETED' });
    new JobQueue(store, () => {}, new TestAdapter());
    expect(saved().state).toBe('UNVERIFIED');
  });
  it('fails honestly when the real execution service is unavailable', async () => {
    const { queue, adapter, saved, approve } = setup();
    adapter.health = async () => ({
      available: false,
      version: 'absent',
      executionReady: false,
      detail: 'Docker not configured',
    });
    await approve('approve');
    await queue.drain();
    expect(saved().state).toBe('FAILED');
    expect(saved().result).toContain('Docker not configured');
    expect(adapter.calls).toEqual([]);
    await queue.close();
  });
  it('cancels planning without implementing after an in-flight response', async () => {
    const { queue, adapter, saved, approve } = setup();
    let started!: () => void;
    let release!: (result: CodexRun) => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    adapter.execute = async () => {
      started();
      return new Promise<CodexRun>((resolve) => {
        release = resolve;
      });
    };
    await approve('approve');
    const draining = queue.drain();
    await pending;
    queue.cancel('job');
    release(receipt('{}'));
    await draining;
    expect(saved().state).toBe('CANCELLED');
    expect(adapter.calls).toEqual(['isolate']);
    await queue.close();
  });
  it('rejects cyclic dependencies and unknown specialists', () => {
    expect(() =>
      validatePlan([
        { id: 'a', title: 'Bad', agentId: 'alex', dependsOn: ['a'], status: 'pending' },
      ]),
    ).toThrow();
    expect(() =>
      validatePlan([
        { id: 'a', title: 'Bad', agentId: 'unknown', dependsOn: [], status: 'pending' },
      ]),
    ).toThrow();
  });
  it('redacts secret output', () => {
    expect(
      redact('api_key=super-secret-value password="hunter2" sk-abcdefghijk12345'),
    ).not.toContain('super-secret-value');
  });
});
