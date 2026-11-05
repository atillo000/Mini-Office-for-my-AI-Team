import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app';
import { Store } from '../server/db';
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
describe('work and integrations API', () => {
  it('requires CEO authentication for new APIs and rejects forged health/credentials', async () => {
    const { app } = await setup('ceo-token');
    expect((await app.inject('/api/work')).statusCode).toBe(401);
    expect((await app.inject('/api/integrations')).statusCode).toBe(401);
    const result = await app.inject({
      method: 'PUT',
      url: '/api/integrations/teams',
      headers: { authorization: 'Bearer ceo-token' },
      payload: {
        version: 1,
        mode: 'AUTO',
        apiAllowed: true,
        browserAllowed: true,
        policyConfirmed: true,
        authentication: 'AUTHENTICATED',
        password: 'not-accepted',
      },
    });
    expect(result.statusCode).toBe(400);
  });
  it('shows disconnected external methods and real local capability discovery', async () => {
    const { app } = await setup();
    const response = await app.inject('/api/integrations');
    expect(response.statusCode).toBe(200);
    for (const connection of response.json().connections) {
      expect(connection.mode).toBe('MANUAL_ONLY');
      expect(connection.adapters.API).toBeUndefined();
      expect(connection.adapters.BROWSER).toBeUndefined();
      expect(connection.lastSyncAt).toBeNull();
      expect(connection.adapters.MANUAL.capabilities.length).toBeGreaterThan(0);
    }
  });
  it('enforces independent policy approval and optimistic connection versions', async () => {
    const { app } = await setup();
    const payload = {
      version: 1,
      mode: 'AUTO',
      apiAllowed: false,
      browserAllowed: true,
      policyConfirmed: false,
    };
    expect(
      (await app.inject({ method: 'PUT', url: '/api/integrations/teams', payload })).statusCode,
    ).toBe(400);
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/integrations/teams',
      payload: { ...payload, policyConfirmed: true },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().version).toBe(2);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/integrations/teams',
          payload: { ...payload, policyConfirmed: true },
        })
      ).statusCode,
    ).toBe(400);
    const route = await app.inject({
      method: 'POST',
      url: '/api/integrations/route',
      payload: { application: 'teams', operation: 'getAuthorizedMessages' },
    });
    expect(route.json().method).toBe('MANUAL');
  });
  it('persists work knowledge, explicit corrections and rules without touching jobs or office state', async () => {
    const { app, store } = await setup();
    const officeBefore = store.snapshot();
    const project = await app.inject({
      method: 'POST',
      url: '/api/work/projects',
      payload: { name: 'Apollo', aliases: ['AP API'], role: 'TECHNICAL_LEAD' },
    });
    expect(project.statusCode).toBe(200);
    const record = await app.inject({
      method: 'POST',
      url: '/api/work/records',
      payload: { source: 'outlook', kind: 'EMAIL', body: 'Apollo update: please review the API.' },
    });
    expect(record.statusCode).toBe(200);
    expect(record.json().classification.labels).toContain('PROJECT_LEAD');
    const correction = await app.inject({
      method: 'POST',
      url: `/api/work/records/${record.json().id}/correct`,
      payload: {
        version: 1,
        labels: ['IT_ADVISORY'],
        projectId: null,
        explanation: 'This email is a general advisory.',
        confirmed: true,
      },
    });
    expect(correction.statusCode).toBe(200);
    const snapshot = (await app.inject('/api/work')).json();
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.learning).toHaveLength(1);
    expect(snapshot.rules).toHaveLength(0);
    expect(snapshot.records[0].classification.projectId).toBeNull();
    const rule = await app.inject({
      method: 'POST',
      url: `/api/work/learning/${snapshot.learning[0].id}/rule`,
      payload: {
        name: 'Advisory email',
        source: 'outlook',
        terms: ['general advisory'],
        match: 'ALL',
        labels: ['IT_ADVISORY'],
        confirmed: true,
      },
    });
    expect(rule.statusCode).toBe(200);
    const after = store.snapshot();
    expect(after.jobs).toEqual(officeBefore.jobs);
    expect(after.employees).toEqual(officeBefore.employees);
    expect(after.messages).toEqual(officeBefore.messages);
    expect(after.meetings).toEqual(officeBefore.meetings);
    const direct = await app.inject({
      method: 'POST',
      url: '/api/integrations/run',
      payload: { application: 'outlook', operation: 'listMessages' },
    });
    expect(direct.json().result.provenance).toBe('MANUAL');
    expect(direct.json().result.items[0].id).toBe(record.json().id);
  });
  it('rejects missing confirmation, invalid mappings and time invented from messages', async () => {
    const { app } = await setup();
    const badRecord = await app.inject({
      method: 'POST',
      url: '/api/work/records',
      payload: {
        source: 'teams',
        kind: 'MESSAGE',
        body: 'Please test now',
        durationMinutes: 60,
        activityConfirmed: true,
      },
    });
    expect(badRecord.statusCode).toBe(400);
    const mapping = await app.inject({
      method: 'POST',
      url: '/api/work/mappings',
      payload: {
        knowledgeProjectId: 'missing',
        activityName: 'Meeting',
        module: 'GENERAL',
        billing: 'NON_BILLABLE',
        confirmed: true,
      },
    });
    expect(mapping.statusCode).toBe(400);
    const reply = await app.inject({
      method: 'POST',
      url: '/api/integrations/run',
      payload: { application: 'teams', operation: 'submitApprovedReply' },
    });
    expect(reply.json().failure.code).toBe('APPROVAL_REQUIRED');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/work/rules',
          payload: {
            name: 'Unconfirmed',
            source: 'any',
            terms: ['API'],
            match: 'ANY',
            labels: ['GENERAL'],
          },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('marks interrupted operations unknown after restart instead of claiming success', async () => {
    const store = new Store(':memory:');
    store.put('integration_runs', 'interrupted', {
      id: 'interrupted',
      application: 'zoho',
      operation: 'listProjects',
      state: 'EXECUTING',
      startedAt: Date.now(),
    });
    const app = await createApp(store, { skipExternal: true });
    apps.push(app);
    expect(store.get('integration_runs', 'interrupted')).toMatchObject({
      state: 'UNKNOWN_OUTCOME',
      failure: { code: 'UNKNOWN_OUTCOME' },
    });
  });
});
