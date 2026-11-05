// Preparation-only regression check. Never calls Codex, executes project scripts or changes job approvals.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { CodexAdapter } from '../server/agents/codex';
import { Artifacts } from '../server/agents/artifacts';
import type { Job, Project } from '../shared/types';
const sourcePath = process.argv[2];
if (!sourcePath)
  throw new Error('Usage: npm run test:workspace -- "absolute path to an approved Git repository"');
const root = path.resolve('test-results', `workspace-${Date.now()}`);
mkdirSync(root, { recursive: true });
const adapter = new CodexAdapter(
  undefined,
  path.join(root, 'workspaces'),
  new Artifacts(path.join(root, 'jobs')),
);
const project: Project = {
  id: 'preparation-check',
  name: 'Preparation verification',
  path: await realpath(sourcePath),
  approved: true,
  testCommand: 'auto',
  color: '#64748b',
};
const source = await adapter.source(project);
const job: Job = {
  id: crypto.randomUUID(),
  title: 'Verify workspace preparation',
  instruction: '',
  agentId: 'alex',
  projectId: project.id,
  state: 'DRAFT',
  source,
  attempts: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  subtasks: [],
  result: '',
  testResult: 'Not run',
  workspace: '',
  logs: [],
};
adapter.artifacts.init(job);
const started = Date.now();
const workspace = await adapter.isolate(project, job, AbortSignal.timeout(360000), (text) => {
  adapter.artifacts.log(job, text);
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
});
const manifest = adapter.artifacts.manifest(job, 'baseline');
const verificationFile = `office-preparation-check-${job.id}.txt`;
writeFileSync(path.join(workspace, verificationFile), 'Disposable workspace verification only.\n');
const after = await adapter.capture(job, 'after', AbortSignal.timeout(190000), (text) =>
  adapter.artifacts.log(job, text),
);
const changes = adapter.artifacts.changes(job);
assert.equal(changes.length, 1);
assert.equal(changes[0].path, verificationFile);
for (const original of manifest.files)
  assert.equal(after.files.find((file) => file.path === original.path)?.sha256, original.sha256);
assert.ok(workspace.startsWith(root + path.sep));
assert.equal((await adapter.source(project)).commit, source.commit);
const receipt = {
  state: 'PREPARATION_VERIFIED',
  sourceCommit: source.commit,
  files: manifest.files.length,
  bytes: manifest.files.reduce((n, file) => n + file.size, 0),
  elapsedSeconds: (Date.now() - started) / 1000,
  workspace,
  manifestHash: adapter.artifacts.hash(job, 'baseline.json'),
  patchHash: adapter.artifacts.hash(job, 'after.patch'),
  bundleHash: adapter.artifacts.hash(job, 'after.tar.gz'),
  verifiedChange: verificationFile,
  testReadiness: adapter.artifacts.testPlan(job, source.testCommand).reason || 'Tests detected',
  agentExecuted: false,
  testsExecuted: false,
};
writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
console.log(`Preparation receipt: ${path.join(root, 'receipt.json')}`);
