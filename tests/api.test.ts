import { afterEach, describe, it, expect } from 'vitest';
import { createApp } from '../server/app';
import { Store } from '../server/db';
import type { FastifyInstance } from 'fastify';
import type { Project, Job } from '../shared/types';
const apps: FastifyInstance[] = [];
async function setup(token = '') {
  const store = new Store(':memory:');
  const app = await createApp(store, { skipExternal: true, token });
  apps.push(app);
  return { app, store };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe('CEO API', () => {
  it('persists seeded employees and explicit offline weather', async () => {
    const { app } = await setup();
    const response = await app.inject('/api/snapshot');
    expect(response.statusCode).toBe(200);
    expect(response.json().employees).toHaveLength(9);
    expect(response.json().weather.source).toBe('offline');
    expect(response.json().jobs).toEqual([]);
  });
  it('protects remote access, authenticated writes, and cross-origin requests', async () => {
    const { app } = await setup('a-test-ceo-token');
    expect((await app.inject('/api/snapshot')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/snapshot',
          headers: { authorization: 'Bearer a-test-ceo-token' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: '/api/snapshot',
          headers: {
            authorization: 'Bearer a-test-ceo-token',
            origin: 'https://hostile.example',
          },
        })
      ).statusCode,
    ).toBe(403);
    const local = await setup();
    expect(
      (
        await local.app.inject({
          url: '/api/snapshot',
          headers: { host: 'hostile.example' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('saves tasks as drafts and rejects unapproved workspaces', async () => {
    const { app, store } = await setup();
    const project: Project = {
      id: 'project',
      name: 'Test',
      path: '/test',
      approved: true,
      testCommand: 'none',
      color: '#abc',
    };
    store.put('projects', project.id, project);
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: {
        instruction: 'Build authentication',
        agentId: 'alex',
        projectId: 'project',
      },
    });
    expect(res.statusCode).toBe(200);
    const job = res.json();
    expect(job.state).toBe('DRAFT');
    expect(job.logs).toEqual([]);
    expect(store.get<Job>('jobs', job.id)?.state).toBe('DRAFT');
    const denied = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: {
        instruction: 'Build authentication',
        agentId: 'alex',
        projectId: 'not-approved',
      },
    });
    expect(denied.statusCode).toBe(400);
  });
  it('rejects empty instructions and unknown specialists', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { instruction: ' ', agentId: 'alex', projectId: 'test' },
    });
    expect(response.statusCode).toBe(400);
  });
  it('rejects stale stage approvals and accepting a result without evidence', async () => {
    const { app, store } = await setup();
    const job: Job = {
      id: 'approval-test',
      title: 'Test',
      instruction: 'Test',
      agentId: 'alex',
      projectId: 'project',
      state: 'AWAITING_APPROVAL',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 1,
      subtasks: [],
      logs: [],
      workspace: '',
      testResult: 'Not run',
      result: '',
      approvalRequest: {
        id: 'request',
        kind: 'implementation',
        scopeHash: 'scope',
        createdAt: Date.now(),
        summary: 'Review',
      },
    };
    store.put('jobs', job.id, job);
    const stale = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/approve-plan`,
      payload: { requestId: 'old-request', scopeHash: 'scope' },
    });
    expect(stale.statusCode).toBe(400);
    expect(stale.json().error).toContain('stale');
    expect(store.get<Job>('jobs', job.id)?.state).toBe('AWAITING_APPROVAL');
    job.state = 'REVIEW';
    job.approvalRequest!.kind = 'review';
    store.put('jobs', job.id, job);
    const accept = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/accept`,
      payload: { requestId: 'request', scopeHash: 'scope' },
    });
    expect(accept.statusCode).toBe(400);
    expect(accept.json().error).toContain('no verified implementation');
    expect(store.get<Job>('jobs', job.id)?.state).toBe('REVIEW');
  });
  it('persists a real chat job and never manufactures a simulated reply', async () => {
    const { app, store } = await setup();
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: { channel: 'alex', text: 'Hello Alex' },
    });
    const messages = store.snapshot().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].sender).toBe('ceo');
    expect(store.snapshot().jobs[0]).toMatchObject({
      kind: 'assistant-chat',
      state: 'QUEUED',
      relatedId: 'alex',
    });
    await app.inject({
      method: 'POST',
      url: '/api/messages/read',
      payload: { channel: 'alex' },
    });
    expect(store.snapshot().messages.every((m) => m.read)).toBe(true);
  });
  it('validates meetings and saves editable action items', async () => {
    const { app } = await setup();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/meetings',
      payload: {
        title: 'Standup',
        agenda: 'Plan',
        participants: ['unknown'],
        startsAt: Date.now() + 60000,
        duration: 15,
      },
    });
    expect(bad.statusCode).toBe(400);
    const good = await app.inject({
      method: 'POST',
      url: '/api/meetings',
      payload: {
        title: 'Standup',
        agenda: 'Plan',
        participants: ['sarah', 'alex'],
        startsAt: Date.now() + 60000,
        duration: 15,
      },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().transcript).toEqual([]);
    const notes = await app.inject({
      method: 'PUT',
      url: `/api/meetings/${good.json().id}/notes`,
      payload: {
        transcript: ['CEO: Plan the API'],
        actions: ['Alex — draft schema'],
      },
    });
    expect(notes.statusCode).toBe(200);
  });
  it('requires a one-time ticket for real-time connections', async () => {
    const { app } = await setup();
    const ticket = await app.inject({
      method: 'POST',
      url: '/api/ws-ticket',
      payload: {},
    });
    const ws = await app.injectWS(`/ws?ticket=${ticket.json().ticket}`, {
      headers: { host: 'localhost' },
    });
    expect(ws.readyState).toBe(1);
    ws.close();
  });
  it('disables simulation updates without changing saved data', async () => {
    const { app, store } = await setup();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/simulation',
      payload: { minute: 720, savedAt: 1 },
    });
    expect(response.statusCode).toBe(410);
    expect(store.snapshot().simulation.minute).toBe(568);
  });
});
