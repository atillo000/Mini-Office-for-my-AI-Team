import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../server/db';
import {
  IntegrationEngine,
  IntegrationError,
  chooseRoute,
  failure,
  type IntegrationAdapter,
} from '../server/integrations/engine';
import { localAdapters } from '../server/integrations/local';
import type { AdapterHealth, Connection, IntegrationRun, WorkRecord } from '../shared/work';
const stores: Store[] = [];
const healthy = (): AdapterHealth => ({
  health: 'HEALTHY',
  authentication: 'AUTHENTICATED',
  authorization: 'AUTHORIZED',
  capabilities: ['listMessages'],
  scopes: ['test.scope'],
});
function config(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'outlook',
    mode: 'AUTO',
    apiAllowed: true,
    browserAllowed: true,
    policyConfirmedAt: Date.now(),
    version: 1,
    updatedAt: Date.now(),
    lastSuccessAt: null,
    lastSyncAt: null,
    ...overrides,
  };
}
function setup(adapters: IntegrationAdapter[] = []) {
  const store = new Store(':memory:');
  stores.push(store);
  store.put('integrations', 'outlook', config());
  const engine = new IntegrationEngine(store, [...localAdapters(store), ...adapters]);
  return { store, engine };
}
const apiAdapter = (
  status = healthy(),
  execute?: IntegrationAdapter['executeRead'],
): IntegrationAdapter => ({
  application: 'outlook',
  method: 'API',
  async inspect() {
    return status;
  },
  executeRead: execute || (async () => ({ data: { genuineTestDouble: true }, verified: true })),
});
const browserAdapter = (execute?: IntegrationAdapter['executeRead']): IntegrationAdapter => ({
  ...apiAdapter(healthy(), execute),
  method: 'BROWSER',
});
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
});
describe('integration routing and truthful execution', () => {
  it('prefers an authorized healthy API and records the actual method', async () => {
    let browserCalls = 0;
    const { store, engine } = setup([
      apiAdapter(),
      browserAdapter(async () => {
        browserCalls++;
        return { verified: true, data: {} };
      }),
    ]);
    const result = await engine.execute({ application: 'outlook', operation: 'listMessages' });
    expect(result).toMatchObject({
      method: 'API',
      state: 'VERIFIED',
      simulated: false,
      attempts: 1,
    });
    expect(browserCalls).toBe(0);
    expect(store.get<IntegrationRun>('integration_runs', result.id)).toEqual(result);
    expect(store.get<Connection>('integrations', 'outlook')!.lastSuccessAt).toBeTruthy();
  });
  it('falls back to the independently authorized browser on technical API unavailability', () => {
    const api = {
      ...healthy(),
      health: 'UNAVAILABLE' as const,
      failure: failure('NETWORK', 'Offline'),
    };
    expect(chooseRoute(config(), 'listMessages', { API: api, BROWSER: healthy() }).method).toBe(
      'BROWSER',
    );
    expect(
      chooseRoute(config({ browserAllowed: false }), 'listMessages', {
        API: api,
        BROWSER: healthy(),
        MANUAL: healthy(),
      }).method,
    ).toBe('MANUAL');
    expect(
      chooseRoute(config({ policyConfirmedAt: null }), 'listMessages', {
        API: api,
        BROWSER: healthy(),
        MANUAL: healthy(),
      }).method,
    ).toBe('MANUAL');
  });
  it('never routes an API permission denial or uncertain authorization through a browser', async () => {
    const denied = { ...healthy(), authorization: 'DENIED' as const };
    expect(
      chooseRoute(config(), 'listMessages', { API: denied, BROWSER: healthy(), MANUAL: healthy() })
        .failure?.code,
    ).toBe('PERMISSION_DENIED');
    expect(
      chooseRoute(config(), 'listMessages', {
        API: { ...healthy(), authorization: 'UNKNOWN' },
        BROWSER: healthy(),
      }).method,
    ).toBeNull();
    let browserCalls = 0;
    const { engine } = setup([
      apiAdapter(healthy(), async () => {
        throw new IntegrationError(failure('PERMISSION_DENIED', 'Scope denied'));
      }),
      browserAdapter(async () => {
        browserCalls++;
        return { verified: true, data: {} };
      }),
    ]);
    const result = await engine.execute({ application: 'outlook', operation: 'listMessages' });
    expect(result.state).toBe('FAILED');
    expect(result.failure?.code).toBe('PERMISSION_DENIED');
    expect(browserCalls).toBe(0);
    expect(result.attempts).toBe(1);
  });
  it('retries a rate-limited read within its bound, then succeeds', async () => {
    let calls = 0;
    const { engine } = setup([
      apiAdapter(healthy(), async () => {
        if (++calls === 1)
          throw new IntegrationError({ ...failure('RATE_LIMITED', 'Wait', true), retryAfterMs: 1 });
        return { verified: true, data: { ok: true } };
      }),
    ]);
    const result = await engine.execute({ application: 'outlook', operation: 'listMessages' });
    expect(result.state).toBe('VERIFIED');
    expect(result.attempts).toBe(2);
  });
  it('falls back only after bounded technical read retries', async () => {
    let calls = 0;
    const { engine } = setup([
      apiAdapter(healthy(), async () => {
        calls++;
        throw new IntegrationError(failure('NETWORK', 'Offline', true));
      }),
      browserAdapter(),
    ]);
    const result = await engine.execute({ application: 'outlook', operation: 'listMessages' });
    expect(result.state).toBe('VERIFIED');
    expect(result.method).toBe('BROWSER');
    expect(result.attempts).toBe(3);
    expect(calls).toBe(2);
  });
  it('honors routing policies and rejects simulation execution', async () => {
    const { engine, store } = setup();
    store.put('integrations', 'outlook', config({ mode: 'API_ONLY' }));
    expect(
      (await engine.execute({ application: 'outlook', operation: 'listMessages' })).failure?.code,
    ).toBe('UNAVAILABLE');
    store.put('integrations', 'outlook', config({ mode: 'BROWSER_ONLY', browserAllowed: false }));
    expect(
      (await engine.execute({ application: 'outlook', operation: 'listMessages' })).failure?.code,
    ).toBe('PERMISSION_DENIED');
    store.put('integrations', 'outlook', config({ mode: 'MANUAL_ONLY' }));
    const manual = await engine.execute({ application: 'outlook', operation: 'listMessages' });
    expect(manual.method).toBe('MANUAL');
    expect(manual.simulated).toBe(false);
    store.put('integrations', 'outlook', config({ mode: 'SIMULATION_ONLY' }));
    await expect(
      engine.execute({ application: 'outlook', operation: 'listMessages' }),
    ).rejects.toThrow('Simulation is disabled');
    expect(store.get<Connection>('integrations', 'outlook')!.lastSuccessAt).toBeNull();
  });
  it('pages genuine manual records separately from simulation and other sources', async () => {
    const { engine, store } = setup();
    store.put('integrations', 'outlook', config({ mode: 'MANUAL_ONLY' }));
    for (let i = 0; i < 3; i++)
      store.put('work_records', String(i), {
        id: String(i),
        source: 'outlook',
        kind: 'EMAIL',
        body: 'Supplied content',
        classification: { labels: [] },
      } as unknown as WorkRecord);
    store.put('work_records', 'other', { id: 'other', source: 'teams', kind: 'MESSAGE' });
    const first = await engine.execute({
      application: 'outlook',
      operation: 'listMessages',
      input: { limit: 2 },
    });
    expect(first.result).toMatchObject({ provenance: 'MANUAL', nextCursor: '2' });
    const second = await engine.execute({
      application: 'outlook',
      operation: 'listMessages',
      input: { limit: 2, cursor: '2' },
    });
    expect((second.result as { items: unknown[] }).items).toHaveLength(1);
  });
  it('blocks every external write and unknown operation without executing adapters', async () => {
    const { engine } = setup();
    const result = await engine.execute({ application: 'teams', operation: 'submitApprovedReply' });
    expect(result.failure?.code).toBe('APPROVAL_REQUIRED');
    expect(
      (await engine.execute({ application: 'zoho', operation: 'submitApprovedTimeLog' })).failure
        ?.code,
    ).toBe('APPROVAL_REQUIRED');
    await expect(
      engine.execute({ application: 'teams', operation: 'executeShell', input: {} }),
    ).rejects.toThrow();
    await expect(
      engine.execute({
        application: 'teams',
        operation: 'getAuthorizedMessages',
        input: { script: 'send everything' },
      }),
    ).rejects.toThrow();
    expect((await engine.execute({ application: 'teams', operation: 'prepareReply' })).state).toBe(
      'UNSUPPORTED',
    );
  });
  it('does not call an unverified result successful or retry an ambiguous outcome', async () => {
    const { engine } = setup([
      apiAdapter(healthy(), async () => ({ data: { accepted: true }, verified: false })),
    ]);
    const result = await engine.execute({ application: 'outlook', operation: 'listMessages' });
    expect(result.state).toBe('UNKNOWN_OUTCOME');
    expect(result.attempts).toBe(1);
  });
  it('discards results when the connection policy changes in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { store, engine } = setup([
      apiAdapter(healthy(), async () => {
        await gate;
        return { data: { confidential: 'discarded' }, verified: true };
      }),
    ]);
    const pending = engine.execute({ application: 'outlook', operation: 'listMessages' });
    await new Promise((r) => setTimeout(r, 15));
    store.put('integrations', 'outlook', config({ version: 2, apiAllowed: false }));
    release();
    const result = await pending;
    expect(result.failure?.code).toBe('PERMISSION_DENIED');
    expect(result.result).toBeUndefined();
  });
  it('cancels a non-responsive read adapter and never claims completion', async () => {
    const { engine, store } = setup([apiAdapter(healthy(), async () => new Promise(() => {}))]);
    const pending = engine.execute({ application: 'outlook', operation: 'listMessages' });
    await new Promise((r) => setTimeout(r, 15));
    const run = store.list<IntegrationRun>('integration_runs')[0];
    engine.cancel(run.id);
    const result = await pending;
    expect(result.failure?.code).toBe('CANCELLED');
    expect(result.state).toBe('FAILED');
  });
  it('does not contact external adapters in manual or simulation modes', async () => {
    let calls = 0;
    const adapter = {
      ...apiAdapter(),
      inspect: async () => {
        calls++;
        return healthy();
      },
    };
    const { engine, store } = setup([adapter]);
    for (const mode of ['MANUAL_ONLY', 'SIMULATION_ONLY'] as const) {
      store.put('integrations', 'outlook', config({ mode }));
      if (mode === 'SIMULATION_ONLY')
        await expect(
          engine.execute({ application: 'outlook', operation: 'listMessages' }),
        ).rejects.toThrow('Simulation is disabled');
      else await engine.execute({ application: 'outlook', operation: 'listMessages' });
    }
    expect(calls).toBe(0);
  });
  it('does not interpret an unclassified adapter error as permission to fall back', async () => {
    let browserCalls = 0;
    const { engine } = setup([
      apiAdapter(healthy(), async () => {
        throw new Error('Unclassified provider failure');
      }),
      browserAdapter(async () => {
        browserCalls++;
        return { data: {}, verified: true };
      }),
    ]);
    const result = await engine.execute({ application: 'outlook', operation: 'listMessages' });
    expect(result.state).toBe('UNKNOWN_OUTCOME');
    expect(result.attempts).toBe(1);
    expect(browserCalls).toBe(0);
  });
});
