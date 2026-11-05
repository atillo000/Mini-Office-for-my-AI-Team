import { z } from 'zod';
import { Store } from '../db';
import { redact } from '../process';
import {
  applications,
  operations,
  type AdapterHealth,
  type Application,
  type Connection,
  type ConnectionView,
  type IntegrationFailure,
  type IntegrationMethod,
  type IntegrationRequest,
  type IntegrationRun,
  type Operation,
  type RouteDecision,
} from '../../shared/work';
export const writes = new Set<Operation>(['submitApprovedReply', 'submitApprovedTimeLog']);
export const requestSchema = z
  .object({
    application: z.enum(applications),
    operation: z.string(),
    input: z
      .object({
        recordId: z.string().max(100).optional(),
        projectId: z.string().max(100).optional(),
        cursor: z
          .string()
          .regex(/^\d{1,8}$/)
          .optional(),
        limit: z.number().int().min(1).max(100).default(25),
      })
      .strict()
      .default({ limit: 25 }),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!(operations[v.application] as readonly string[]).includes(v.operation))
      ctx.addIssue({
        code: 'custom',
        path: ['operation'],
        message: 'Unsupported application operation',
      });
  });
export class IntegrationError extends Error {
  constructor(public failure: IntegrationFailure) {
    super(failure.message);
  }
}
export const failure = (
  code: IntegrationFailure['code'],
  message: string,
  retryable = false,
): IntegrationFailure => ({ code, message, retryable });
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new IntegrationError(failure('CANCELLED', 'Operation was cancelled or timed out.')));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export interface IntegrationAdapter {
  application: Application;
  method: IntegrationMethod;
  // Adapters validate provider scopes here; configuration and UI cannot forge authentication.
  inspect(signal: AbortSignal): Promise<AdapterHealth>;
  executeRead(
    request: IntegrationRequest & { signal: AbortSignal },
  ): Promise<{ data: unknown; verified: boolean; synchronized?: boolean }>;
}
function eligible(connection: Connection, method: 'API' | 'BROWSER', status?: AdapterHealth) {
  return (
    !!connection.policyConfirmedAt &&
    (method === 'API' ? connection.apiAllowed : connection.browserAllowed) &&
    status?.health === 'HEALTHY' &&
    status.authentication === 'AUTHENTICATED' &&
    status.authorization === 'AUTHORIZED'
  );
}
export function chooseRoute(
  connection: Connection,
  operation: Operation,
  adapters: ConnectionView['adapters'],
): RouteDecision {
  const supports = (method: IntegrationMethod) =>
    adapters[method]?.capabilities.includes(operation);
  const selected = (method: IntegrationMethod, reason: string): RouteDecision => {
    if (!supports(method))
      return {
        method: null,
        reason: `${method} does not implement ${operation}.`,
        failure: failure(
          'UNSUPPORTED',
          'This operation is not available through the selected method.',
        ),
      };
    if (adapters[method]?.authorization !== 'AUTHORIZED')
      return {
        method: null,
        reason: `${method} is not authorized.`,
        failure: failure('PERMISSION_DENIED', 'Authorization must be established before use.'),
      };
    if (adapters[method]?.health !== 'HEALTHY')
      return {
        method: null,
        reason: `${method} is not healthy.`,
        failure: failure('UNAVAILABLE', 'The selected method is currently unavailable.'),
      };
    return { method, reason };
  };
  const denied = (method: 'API' | 'BROWSER') =>
    ({
      method: null,
      reason: `${method} authorization is denied. No alternate route will bypass that denial.`,
      failure: failure(
        'PERMISSION_DENIED',
        `${method} permission denied. Resolve permissions before retrying.`,
      ),
    }) satisfies RouteDecision;
  if (connection.mode === 'SIMULATION_ONLY')
    return selected('SIMULATION', 'Simulation was explicitly selected; all results are synthetic.');
  if (connection.mode === 'MANUAL_ONLY')
    return selected('MANUAL', 'Use only data supplied or confirmed by the CEO.');
  if (connection.mode === 'API_ONLY' || connection.mode === 'BROWSER_ONLY') {
    const method = connection.mode === 'API_ONLY' ? 'API' : 'BROWSER';
    if (adapters[method]?.authorization === 'DENIED') return denied(method);
    if (eligible(connection, method, adapters[method]))
      return selected(method, `Authorized ${method} selected by the CEO.`);
    return {
      method: null,
      reason: `${method} is not independently authorized, authenticated and healthy.`,
      failure: failure(
        !connection.policyConfirmedAt ||
          !(method === 'API' ? connection.apiAllowed : connection.browserAllowed)
          ? 'PERMISSION_DENIED'
          : adapters[method]?.authentication === 'REQUIRED'
            ? 'AUTH_REQUIRED'
            : 'UNAVAILABLE',
        'Authorize and connect this method before use.',
      ),
    };
  }
  if (adapters.API?.authorization === 'DENIED') return denied('API');
  // Unknown authorization on an installed API is not a technical failure and cannot justify browser fallback.
  if (
    connection.apiAllowed &&
    adapters.API?.authorization === 'UNKNOWN' &&
    !['NETWORK', 'UNAVAILABLE', 'RATE_LIMITED'].includes(adapters.API.failure?.code || '')
  )
    return {
      method: null,
      reason: 'API authorization is uncertain. Clarification is required.',
      failure: failure(
        'PERMISSION_DENIED',
        'Confirm API authorization before selecting another route.',
      ),
    };
  if (eligible(connection, 'API', adapters.API) && supports('API'))
    return selected('API', 'Prefer the authorized, healthy API.');
  if (adapters.BROWSER?.authorization === 'DENIED' && connection.browserAllowed)
    return denied('BROWSER');
  if (eligible(connection, 'BROWSER', adapters.BROWSER) && supports('BROWSER'))
    return selected(
      'BROWSER',
      'API technically unavailable or unsupported; browser access is independently authorized.',
    );
  return selected(
    'MANUAL',
    'No healthy, authorized connector is available. Use CEO-supplied input; simulation was not selected.',
  );
}
const appNames = { outlook: 'Microsoft Outlook', teams: 'Microsoft Teams', zoho: 'Zoho Projects' };
export class IntegrationEngine {
  private adapters = new Map<string, IntegrationAdapter>();
  private active = new Map<string, AbortController>();
  constructor(
    public store: Store,
    adapters: IntegrationAdapter[] = [],
    public changed: () => void = () => {},
  ) {
    adapters.forEach((a) => this.adapters.set(`${a.application}:${a.method}`, a));
  }
  async inspect(
    application: Application,
    signal = AbortSignal.timeout(10000),
  ): Promise<ConnectionView> {
    const connection = this.store.get<Connection>('integrations', application)!;
    const adapters: ConnectionView['adapters'] = {};
    for (const method of ['API', 'BROWSER', 'MANUAL', 'SIMULATION'] as const) {
      signal.throwIfAborted();
      const adapter = this.adapters.get(`${application}:${method}`);
      if (!adapter) continue;
      if (
        ['API', 'BROWSER'].includes(method) &&
        (['MANUAL_ONLY', 'SIMULATION_ONLY'].includes(connection.mode) ||
          (connection.mode === 'API_ONLY' && method === 'BROWSER') ||
          (connection.mode === 'BROWSER_ONLY' && method === 'API') ||
          !connection.policyConfirmedAt ||
          !(method === 'API' ? connection.apiAllowed : connection.browserAllowed))
      ) {
        adapters[method] = {
          health: 'UNKNOWN',
          authentication: 'REQUIRED',
          authorization: 'UNKNOWN',
          capabilities: [],
          scopes: [],
          failure: failure(
            'PERMISSION_DENIED',
            'This external method is not enabled by the CEO policy.',
          ),
        };
        continue;
      }
      try {
        adapters[method] = await bounded(adapter.inspect(signal), signal);
      } catch (error) {
        adapters[method] = {
          health: 'UNAVAILABLE',
          authentication: 'REQUIRED',
          authorization: 'UNKNOWN',
          capabilities: [],
          scopes: [],
          failure: this.error(error),
        };
      }
    }
    // Preserve permission denials until an actual authenticated check establishes authorization again.
    const last = this.store.get<ConnectionView>('integration_health', application);
    for (const method of ['API', 'BROWSER'] as const) {
      if (
        last?.adapters[method]?.authorization === 'DENIED' &&
        adapters[method]?.authorization !== 'AUTHORIZED'
      )
        adapters[method] = last.adapters[method];
    }
    const runs = this.store
      .list<IntegrationRun>('integration_runs')
      .filter((r) => r.application === application);
    const view: ConnectionView = {
      ...connection,
      checkedAt: Date.now(),
      name: appNames[application],
      adapters,
      errors: runs
        .flatMap((r) =>
          r.events?.length
            ? r.events.map((event) => ({
                at: event.at,
                operation: r.operation,
                failure: event.failure,
              }))
            : r.failure
              ? [{ at: r.finishedAt || r.startedAt, operation: r.operation, failure: r.failure }]
              : [],
        )
        .slice(-10),
      detail:
        adapters.API || adapters.BROWSER
          ? 'Only declared, authorized capabilities can run.'
          : 'Manual records available. API and browser connectors are not installed in this phase.',
    };
    this.store.put('integration_health', application, view);
    return view;
  }
  error(error: unknown): IntegrationFailure {
    if (error instanceof IntegrationError)
      return { ...error.failure, message: redact(error.message).slice(0, 500) };
    return failure(
      'UNKNOWN_OUTCOME',
      'The adapter failed without a verified error classification; no fallback or retry is authorized.',
    );
  }
  async preview(application: Application, operation: Operation) {
    if (!(operations[application] as readonly string[]).includes(operation))
      throw new Error('Unknown operation');
    const connection = await this.inspect(application);
    return chooseRoute(connection, operation, connection.adapters);
  }
  async execute(raw: unknown): Promise<IntegrationRun> {
    const parsed = requestSchema.parse(raw);
    if (this.store.get<Connection>('integrations', parsed.application)?.mode === 'SIMULATION_ONLY') throw new Error('Simulation is disabled. Connect a real account.');
    const request = { ...parsed, operation: parsed.operation as Operation };
    const controller = new AbortController();
    const run: IntegrationRun = {
      id: crypto.randomUUID(),
      application: request.application,
      operation: request.operation,
      method: null,
      state: 'EXECUTING',
      reason: 'Checking authorization and capabilities.',
      simulated: false,
      startedAt: Date.now(),
      attempts: 0,
    };
    this.active.set(run.id, controller);
    this.store.put('integration_runs', run.id, run);
    this.changed();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (writes.has(request.operation))
        throw new IntegrationError(
          failure(
            'APPROVAL_REQUIRED',
            'External writes are unavailable in Phase 1–2. An exact-payload approval and verified connector are required.',
          ),
        );
      const view = await this.inspect(request.application, controller.signal);
      let decision = chooseRoute(view, request.operation, view.adapters);
      run.method = decision.method;
      run.reason = decision.reason;
      run.simulated = decision.method === 'SIMULATION';
      if (!decision.method || decision.failure)
        throw new IntegrationError(decision.failure || failure('UNSUPPORTED', decision.reason));
      let adapter = this.adapters.get(`${request.application}:${decision.method}`)!;
      const tried = new Set<IntegrationMethod>([decision.method]);
      for (let attempt = 1; attempt <= 2; attempt++) {
        run.attempts++;
        this.store.put('integration_runs', run.id, run);
        try {
          controller.signal.throwIfAborted();
          if (
            this.store.get<Connection>('integrations', request.application)!.version !==
            view.version
          )
            throw new IntegrationError(
              failure('PERMISSION_DENIED', 'Connection policy changed; execution stopped.'),
            );
          const result = await bounded(
            adapter.executeRead({ ...request, signal: controller.signal }),
            controller.signal,
          );
          controller.signal.throwIfAborted();
          const current = this.store.get<Connection>('integrations', request.application)!;
          if (current.version !== view.version)
            throw new IntegrationError(
              failure(
                'PERMISSION_DENIED',
                'Connection policy changed during execution; result was discarded.',
              ),
            );
          if (!result.verified)
            throw new IntegrationError(
              failure('UNKNOWN_OUTCOME', 'The adapter could not verify this operation.'),
            );
          run.state = 'VERIFIED';
          run.result = result.data;
          if (!run.simulated) {
            current.lastSuccessAt = Date.now();
            if (result.synchronized && ['API', 'BROWSER'].includes(run.method!))
              current.lastSyncAt = Date.now();
            this.store.put('integrations', current.id, current);
          }
          break;
        } catch (error) {
          const problem = this.error(error);
          (run.events ||= []).push({ at: Date.now(), method: run.method, failure: problem });
          if (problem.code === 'PERMISSION_DENIED') {
            view.adapters[run.method!] = {
              ...view.adapters[run.method!]!,
              authorization: 'DENIED',
              failure: problem,
            };
            this.store.put('integration_health', request.application, view);
          }
          const technical = ['NETWORK', 'RATE_LIMITED', 'UNAVAILABLE'].includes(problem.code);
          if (
            attempt === 2 ||
            !problem.retryable ||
            !technical ||
            (problem.retryAfterMs || 0) > 2000 ||
            controller.signal.aborted
          ) {
            // Only a technical read failure can trigger an independently authorized fallback.
            if (
              view.mode === 'AUTO' &&
              technical &&
              !controller.signal.aborted &&
              ['API', 'BROWSER'].includes(run.method!)
            ) {
              view.adapters[run.method!] = {
                ...view.adapters[run.method!]!,
                health: 'UNAVAILABLE',
                failure: problem,
              };
              const next = chooseRoute(view, request.operation, view.adapters);
              if (next.method && !next.failure && !tried.has(next.method)) {
                tried.add(next.method);
                decision = next;
                adapter = this.adapters.get(`${request.application}:${next.method}`)!;
                run.reason += ` ${run.method} had a technical failure; ${next.reason}`;
                run.method = next.method;
                run.simulated = next.method === 'SIMULATION';
                attempt = 0;
                continue;
              }
            }
            throw error;
          }
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.max(50, problem.retryAfterMs || 100)),
          );
        }
      }
    } catch (error) {
      run.failure = controller.signal.aborted
        ? failure('CANCELLED', 'Operation timed out or was cancelled.')
        : this.error(error);
      run.state =
        run.failure.code === 'UNSUPPORTED'
          ? 'UNSUPPORTED'
          : run.failure.code === 'UNKNOWN_OUTCOME'
            ? 'UNKNOWN_OUTCOME'
            : 'FAILED';
    } finally {
      clearTimeout(timer);
      this.active.delete(run.id);
      run.finishedAt = Date.now();
      this.store.put('integration_runs', run.id, run);
      this.changed();
    }
    return run;
  }
  cancel(id: string) {
    this.active.get(id)?.abort();
  }
  close() {
    for (const controller of this.active.values()) controller.abort();
  }
}
