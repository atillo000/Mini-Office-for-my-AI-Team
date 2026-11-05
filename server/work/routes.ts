import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  applications,
  integrationModes,
  operations,
  type Connection,
  type IntegrationRun,
  type Operation,
  type WorkAudit,
} from '../../shared/work';
import { Store } from '../db';
import { IntegrationEngine, type IntegrationAdapter } from '../integrations/engine';
import { localAdapters } from '../integrations/local';
import { WorkService } from './service';
const params = z.object({ version: z.number().int().min(1), data: z.unknown() }).strict();
export function registerWorkRoutes(
  app: FastifyInstance,
  store: Store,
  changed: () => void,
  adapters: IntegrationAdapter[] = [],
) {
  const work = new WorkService(store);
  const engine = new IntegrationEngine(store, [...localAdapters(store), ...adapters], changed);
  // Interrupted reads are never invented as successful. External writes are not implemented here.
  for (const run of store.list<IntegrationRun>('integration_runs'))
    if (run.state === 'EXECUTING') {
      run.state = 'UNKNOWN_OUTCOME';
      run.finishedAt = Date.now();
      run.failure = {
        code: 'UNKNOWN_OUTCOME',
        message: 'Service restarted before a verified result was saved.',
        retryable: false,
      };
      store.put('integration_runs', run.id, run);
    }
  app.get('/api/work', async () => ({ ...work.snapshot(), issues: work.issues() }));
  app.post('/api/work/analyze', async (request) => work.analyze(request.body));
  app.post('/api/work/records', async (request) => {
    const result = work.saveRecord(request.body);
    changed();
    return result;
  });
  app.post<{ Params: { id: string } }>('/api/work/records/:id/correct', async (request) => {
    const result = work.correct(request.params.id, request.body);
    changed();
    return result;
  });
  app.post<{ Params: { id: string } }>('/api/work/records/:id/reclassify', async (request) => {
    const { version } = z
      .object({ version: z.number().int().min(1) })
      .strict()
      .parse(request.body);
    const result = work.reclassify(request.params.id, version);
    changed();
    return result;
  });
  for (const kind of ['projects', 'mappings', 'rules'] as const) {
    const save = (data: unknown, id?: string, version?: number) =>
      kind === 'projects'
        ? work.saveProject(data, id, version)
        : kind === 'mappings'
          ? work.saveMapping(data, id, version)
          : work.saveRule(data, id, version);
    app.post(`/api/work/${kind}`, async (request) => {
      const result = save(request.body);
      changed();
      return result;
    });
    app.put<{ Params: { id: string } }>(`/api/work/${kind}/:id`, async (request) => {
      const { version, data } = params.parse(request.body);
      const result = save(data, request.params.id, version);
      changed();
      return result;
    });
  }
  app.post<{ Params: { id: string } }>('/api/work/learning/:id/rule', async (request) => {
    const rule = work.saveRule(request.body, undefined, undefined, request.params.id);
    changed();
    return rule;
  });
  app.get('/api/integrations', async () => ({
    connections: await Promise.all(applications.map((application) => engine.inspect(application))),
    runs: store.list<IntegrationRun>('integration_runs').slice(-50).toReversed(),
    audit: store
      .list<WorkAudit>('work_audit')
      .filter((e) => e.entityType === 'integrations')
      .slice(-20),
  }));
  app.put<{ Params: { application: string } }>(
    '/api/integrations/:application',
    async (request) => {
      const application = z.enum(applications).parse(request.params.application);
      const input = z
        .object({
          version: z.number().int().min(1),
          mode: z.enum(integrationModes),
          apiAllowed: z.boolean(),
          browserAllowed: z.boolean(),
          policyConfirmed: z.boolean(),
        })
        .strict()
        .parse(request.body);
      const connection = store.transaction(() => {
        if (input.mode === 'SIMULATION_ONLY') throw new Error('Simulation is disabled. Use a connected account or confirmed local records.');
        const current = store.get<Connection>('integrations', application)!;
        if (input.version !== current.version)
          throw new Error('Connection settings changed. Reload before saving.');
        if ((input.apiAllowed || input.browserAllowed) && !input.policyConfirmed)
          throw new Error(
            'Independent organizational authorization must be confirmed for enabled external methods',
          );
        const value: Connection = {
          ...current,
          mode: input.mode,
          apiAllowed: input.apiAllowed,
          browserAllowed: input.browserAllowed,
          policyConfirmedAt: input.policyConfirmed ? Date.now() : null,
          version: current.version + 1,
          updatedAt: Date.now(),
        };
        store.put('integrations', application, value);
        work.audit('ROUTING_POLICY_UPDATED', 'integrations', application, value.version);
        return value;
      });
      changed();
      return connection;
    },
  );
  app.post('/api/integrations/route', async (request) => {
    const input = z
      .object({ application: z.enum(applications), operation: z.string() })
      .strict()
      .parse(request.body);
    if (!(operations[input.application] as readonly string[]).includes(input.operation))
      throw new Error('Unsupported application operation');
    return engine.preview(input.application, input.operation as Operation);
  });
  app.post('/api/integrations/run', async (request) => engine.execute(request.body));
  app.post<{ Params: { id: string } }>('/api/integrations/runs/:id/cancel', async (request) => {
    engine.cancel(request.params.id);
    return { ok: true };
  });
  app.addHook('onClose', async () => {
    engine.close();
  });
  return { work, engine };
}
