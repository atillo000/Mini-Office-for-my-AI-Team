// Explicit real-model verification. Uses a disposable database, no mailbox or Zoho account.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../server/db';
import { JobQueue } from '../server/agents/queue';
import { CodexAdapter } from '../server/agents/codex';
import { Artifacts } from '../server/agents/artifacts';
import { enqueueChat } from '../server/team/chat';
import type { Job } from '../shared/types';
const root = path.resolve('test-results', 'chat-' + Date.now());
mkdirSync(root, { recursive: true });
const store = new Store(path.join(root, 'company.sqlite'));
const adapter = new CodexAdapter(
  undefined,
  path.join(root, 'workspaces'),
  new Artifacts(path.join(root, 'jobs')),
);
const queue = new JobQueue(store, () => {}, adapter);
try {
  const job = enqueueChat(
    store,
    adapter,
    'sarah',
    'This is a setup check for real AI team chat. In two sentences, explain that you can help plan work and discuss drafts, while Outlook and Zoho access requires their own connected accounts and external writes require CEO approval. Do not use tools or claim any emails were read, messages sent or hours logged.',
  );
  console.log('Verifying real read-only team chat: ' + job.id);
  await queue.drain();
  const saved = store.get<Job>('jobs', job.id)!;
  assert.equal(saved.state, 'COMPLETED', saved.result);
  const receipt = adapter.artifacts.json<{
    threadId: string;
    completed: boolean;
    exitCode: number;
  }>(saved, 'chat-run.json');
  assert(receipt.threadId && receipt.completed && receipt.exitCode === 0);
  assert.equal(store.snapshot().messages.at(-1)?.mode, 'execution');
  writeFileSync(
    path.join(root, 'receipt.json'),
    JSON.stringify(
      { jobId: job.id, state: saved.state, ...receipt, externalWrites: false },
      null,
      2,
    ),
  );
  console.log('Real team reply and completed CLI receipt verified: ' + root);
} finally {
  await queue.close();
  store.close();
}
