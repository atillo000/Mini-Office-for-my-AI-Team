// Explicit live test: uses the configured real Codex account on a disposable private fixture.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Store } from '../server/db';
import { CodexAdapter } from '../server/agents/codex';
import { Artifacts } from '../server/agents/artifacts';
import { JobQueue } from '../server/agents/queue';
import { run } from '../server/process';
import type { Job, Project } from '../shared/types';
const root = path.resolve('test-results', `execution-${Date.now()}`);
const source = path.join(root, 'source');
mkdirSync(source, { recursive: true });
writeFileSync(path.join(source, 'sum.cjs'), 'module.exports = (a, b) => a - b;\n');
writeFileSync(
  path.join(source, 'sum.test.cjs'),
  "const test = require('node:test'); const assert = require('node:assert/strict'); const sum = require('./sum.cjs'); test('adds two numbers', () => assert.equal(sum(2, 3), 5));\n",
);
for (const args of [
  ['init', source],
  ['-C', source, 'add', '.'],
  [
    '-C',
    source,
    '-c',
    'user.name=Execution QA',
    '-c',
    'user.email=qa@localhost',
    'commit',
    '-m',
    'Private execution fixture',
  ],
]) {
  const r = await run('git', args);
  assert.equal(r.code, 0, r.output);
}
const dbPath = path.join(root, 'jobs.sqlite');
const store = new Store(dbPath);
const adapter = new CodexAdapter(
  run,
  path.join(root, 'workspaces'),
  new Artifacts(path.join(root, 'jobs')),
);
const queue = new JobQueue(store, () => {}, adapter);
const project: Project = {
  id: 'fixture',
  path: await import('node:fs/promises').then((fs) => fs.realpath(source)),
  name: 'Private fixture',
  approved: true,
  testCommand: 'node-test',
  color: '#fff',
};
store.put('projects', project.id, project);
const id = crypto.randomUUID();
const job: Job = {
  id,
  title: 'Fix addition',
  instruction:
    'Fix sum.cjs so sum(2,3) is 5. Preserve the existing test unchanged. One subtask assigned to alex is sufficient. Do not install packages or run tests; the separate runner will run sum.test.cjs.',
  agentId: 'alex',
  projectId: project.id,
  kind: 'development',
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
store.put('jobs', id, job);
const saved = () => store.get<Job>('jobs', id)!;
async function approve(action: string) {
  const request = saved().approvalRequest;
  await queue.authorize(id, action, { requestId: request?.id, scopeHash: request?.scopeHash });
  if (action !== 'accept') await queue.drain();
  console.log(`${action}: ${saved().state}`);
  if (['FAILED', 'UNVERIFIED'].includes(saved().state)) throw new Error(saved().result);
}
try {
  const health = await adapter.health();
  assert.equal(health.executionReady, true, health.detail);
  await approve('approve');
  assert.equal(saved().state, 'AWAITING_APPROVAL');
  assert.equal(saved().approvalRequest?.kind, 'implementation');
  await approve('approve-plan');
  assert.equal(saved().approvalRequest?.kind, 'tests');
  await approve('approve-tests');
  assert.equal(saved().state, 'REVIEW');
  assert.equal(saved().evidence?.tests.status, 'passed');
  assert.ok(saved().evidence!.tests.count > 0);
  adapter.artifacts.verify(saved());
  await approve('accept');
  assert.equal(saved().state, 'COMPLETED');
  assert.equal(
    readFileSync(path.join(source, 'sum.cjs'), 'utf8'),
    'module.exports = (a, b) => a - b;\n',
  );
  assert.equal(
    readFileSync(
      path.join(adapter.artifacts.directory(saved()), 'baseline', 'sum.test.cjs'),
      'utf8',
    ),
    readFileSync(path.join(saved().workspace, 'sum.test.cjs'), 'utf8'),
  );
  assert.equal(saved().evidence?.changes.length, 1);
  assert.equal(saved().evidence?.changes[0].path, 'sum.cjs');
  writeFileSync(
    path.join(root, 'receipt.json'),
    JSON.stringify(
      { jobId: id, state: saved().state, evidence: saved().evidence, approvals: saved().approvals },
      null,
      2,
    ),
  );
  console.log(`Real Codex integration passed. Evidence: ${root}`);
} finally {
  await queue.close();
  store.close();
}
const reopened = new Store(dbPath);
assert.equal(reopened.get<Job>('jobs', id)?.state, 'COMPLETED');
reopened.close();
