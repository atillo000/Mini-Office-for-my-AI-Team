// Explicit live verification: three real model turns, draft-only; never renders or posts.
// --local-office sets up the requested project and saves drafts in the running local office.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../server/db';
import { createApp } from '../server/app';
import { CodexAdapter } from '../server/agents/codex';
import { Artifacts, digest } from '../server/agents/artifacts';
import type { StudioSnapshot } from '../shared/studio';
import type { CodexRun } from '../server/agents/protocol';
import type { Job } from '../shared/types';
const local = process.argv.includes('--local-office');
const root = path.resolve('test-results', 'studio-' + Date.now());
mkdirSync(root, { recursive: true });
const store = local ? null : new Store(path.join(root, 'company.sqlite'));
const app = store
  ? await createApp(store, {
      skipExternal: true,
      token: '',
      adapter: new CodexAdapter(
        undefined,
        path.join(root, 'workspaces'),
        new Artifacts(path.join(root, 'jobs')),
      ),
    })
  : null;
async function request<T>(url: string, body?: unknown): Promise<T> {
  if (app) {
    const response = await app.inject({
      method: body === undefined ? 'GET' : 'POST',
      url: '/api' + url,
      payload: body,
    });
    if (response.statusCode !== 200) throw new Error(response.body);
    return response.json();
  }
  const response = await fetch('http://127.0.0.1:3001/api' + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CEO_TOKEN ? { Authorization: 'Bearer ' + process.env.CEO_TOKEN } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(
      'Local office request failed: ' + response.status + ' ' + (await response.text()),
    );
  return response.json() as Promise<T>;
}
let id: string | undefined;
try {
  await request('/studio/setup', {});
  const health = await request<{ executionReady: boolean; detail: string }>('/execution/check', {});
  assert(health.executionReady, health.detail);
  const studio = await request<StudioSnapshot & { generationScopes: { withoutProfile: string } }>(
    '/studio',
  );
  const job = await request<Job>('/studio/generate', {
    briefVersion: studio.brief!.version,
    approved: true,
    includeProfile: false,
    scopeHash: studio.generationScopes.withoutProfile,
  });
  id = job.id;
  console.log(
    'Real draft-only team job: ' +
      id +
      (local ? ' (saved in your local office)' : ' (disposable fixture)'),
  );
  const deadline = Date.now() + 31 * 60 * 1000;
  let last = '';
  let saved: Job = job;
  while (Date.now() < deadline) {
    const next = await request<StudioSnapshot>('/studio');
    saved = next.jobs.find((j) => j.id === id)!;
    const state =
      saved.state + ': ' + saved.subtasks.map((t) => t.agentId + '=' + t.status).join(', ');
    if (state !== last) {
      console.log(state);
      last = state;
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(saved.state)) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  writeFileSync(path.join(root, 'job.json'), JSON.stringify(saved, null, 2));
  assert.equal(saved.state, 'COMPLETED', saved.result);
  const result = await request<StudioSnapshot>('/studio');
  const ideas = result.ideas.filter((idea) => idea.generationJobId === id);
  assert.equal(ideas.length, 3);
  assert(ideas.every((idea) => idea.status === 'DRAFT' && !idea.approval && idea.origin === 'AI'));
  const runs: CodexRun[] = [];
  for (let i = 0; i < 3; i++) {
    const run = await request<CodexRun>('/jobs/' + id + '/artifacts/run-' + i + '.json');
    assert(run.completed && run.threadId && run.exitCode === 0);
    runs.push(run);
  }
  writeFileSync(
    path.join(root, 'receipt.json'),
    JSON.stringify(
      {
        jobId: id,
        localOffice: local,
        state: saved.state,
        draftIds: ideas.map((i) => i.id),
        titles: ideas.map((i) => i.title),
        runReceipts: runs.map(({ threadId, completed, exitCode, startedAt, finishedAt }) => ({
          threadId,
          completed,
          exitCode,
          startedAt,
          finishedAt,
        })),
        draftHash: digest(ideas),
        publishing: result.publishing,
        generatedAt: Date.now(),
      },
      null,
      2,
    ),
  );
  console.log(
    'Verified three real AI drafts and three completed CLI receipts. No rendering or publishing. Receipt: ' +
      root,
  );
} catch (error) {
  if (id) await request('/jobs/' + id + '/cancel', {}).catch(() => undefined);
  throw error;
} finally {
  await app?.close();
}
