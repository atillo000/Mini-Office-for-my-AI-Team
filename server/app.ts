import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { realpath, stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Store } from './db';
import { refreshWeather, weatherConfigSchema } from './weather';
import { JobQueue } from './agents/queue';
import { CodexAdapter } from './agents/codex';
import { run, redact } from './process';
import { registerWorkRoutes } from './work/routes';
import type { IntegrationAdapter } from './integrations/engine';
import { registerStudioRoutes } from './studio/routes';
import { MemoryService } from './studio/memory';
import { registerConnected } from './connected/routes';
import type { Accounts } from './connected/accounts';
import { enqueueChat } from './team/chat';
import { registerReaderRoutes } from './readers/routes';
import type { ReaderDriver } from './readers/browser';
import { registerShiftRoutes } from './shifts/routes';
import type { SproutDriver } from './shifts/browser';
import type { Employee, Job, Meeting, Message, Project } from '../shared/types';
const text = z.string().trim().min(1).max(12000);
const id = z.string().min(1).max(100);
const projectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  path: z.string().min(1).max(1000),
  approved: z.literal(true),
  testCommand: z.enum(['auto', 'none', 'npm-test', 'node-test']).default('auto'),
});
const taskSchema = z.object({
  instruction: text,
  agentId: id,
  projectId: id,
  title: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(['development', 'conversation', 'meeting']).default('development'),
  relatedId: id.optional(),
  useWorkMemory: z.boolean().default(false),
});
const meetingSchema = z.object({
  title: z.string().trim().min(1).max(120),
  agenda: text,
  participants: z.array(id).min(1).max(25),
  startsAt: z.number().min(0),
  duration: z.number().int().min(5).max(240),
});
const employeeUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  role: z.string().trim().min(1).max(100).optional(),
  department: z.string().trim().min(1).max(80).optional(),
  personality: z.string().min(1).max(500).optional(),
  style: z.string().min(1).max(500).optional(),
});
const authEqual = (a: string, b: string) => {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
};
export interface AppOptions {
  sproutDriver?: SproutDriver;
  readerDriver?: ReaderDriver;
  accounts?: Accounts;
  token?: string;
  skipExternal?: boolean;
  adapter?: CodexAdapter;
  integrationAdapters?: IntegrationAdapter[];
}
export async function createApp(store = new Store(), options: AppOptions = {}) {
  const token = options.token ?? process.env.CEO_TOKEN ?? '';
  const app = Fastify({ logger: false, bodyLimit: 64000 });
  const peers = new Set<{
    readyState: number;
    send: (data: string) => void;
    close: () => void;
  }>();
  const tickets = new Map<string, number>();
  const broadcast = () => {
    for (const peer of peers) if (peer.readyState === 1) peer.send('{"type":"changed"}');
  };
  const adapter = options.adapter || new CodexAdapter();
  const queue = new JobQueue(store, broadcast, adapter, !options.skipExternal || !!options.adapter);
  const pending = new Set<Promise<unknown>>();
  function background(work: Promise<unknown>) {
    const task = work.catch(() => undefined);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }
  let codex = {
    available: false,
    version: 'Checking CLI…',
    executionReady: false,
    detail: 'Checking execution environment…',
  };
  if (options.skipExternal)
    codex = {
      available: false,
      version: 'External services disabled in tests',
      executionReady: false,
      detail: 'Disabled in tests',
    };
  else {
    background(
      adapter.health().then((h) => {
        codex = { ...h };
        broadcast();
      }),
    );
    background(refreshWeather(store).then(broadcast));
  }
  const weatherTimer = options.skipExternal
    ? null
    : setInterval(() => {
        background(refreshWeather(store).then(broadcast));
      }, 600000);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    const e = error as Error & { statusCode?: number };
    reply.code(e.statusCode || 400).send({ error: redact(e.message) });
  });
  app.addHook('onRequest', async (request, reply) => {
    const hostname = request.hostname;
    if (!token && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname))
      return reply.code(403).send({ error: 'Remote access requires a configured CEO_TOKEN' });
    const origin = request.headers.origin;
    if (origin) {
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        return reply.code(403).send({ error: 'Invalid origin' });
      }
      if (
        url.host !== request.headers.host &&
        !(
          process.env.NODE_ENV !== 'production' &&
          ['localhost', '127.0.0.1'].includes(url.hostname) &&
          ['localhost', '127.0.0.1'].includes(hostname)
        )
      )
        return reply.code(403).send({ error: 'Cross-origin requests are not allowed' });
    }
    if (
      request.url.startsWith('/api/') &&
      !(
        request.method === 'GET' &&
        /^\/api\/accounts\/(?:outlook|zoho)\/callback(?:\?|$)/.test(request.url)
      ) &&
      !request.url.startsWith('/api/health') &&
      token &&
      !authEqual(request.headers.authorization?.replace(/^Bearer /, '') || '', token)
    )
      return reply.code(401).send({
        error: 'CEO authentication required. Enter your token in Settings.',
      });
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });
  await app.register(websocket);
  app.get(
    '/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const ticket = (request.query as { ticket?: string }).ticket || '';
        const expires = tickets.get(ticket);
        tickets.delete(ticket);
        if (!expires || expires < Date.now())
          return reply.code(401).send({ error: 'Invalid WebSocket ticket' });
      },
    },
    (socket) => {
      peers.add(socket);
      socket.on('close', () => peers.delete(socket));
      socket.on('error', () => peers.delete(socket));
    },
  );
  app.post('/api/ws-ticket', async () => {
    for (const [t, expires] of tickets) if (expires < Date.now()) tickets.delete(t);
    const ticket = crypto.randomUUID();
    tickets.set(ticket, Date.now() + 30000);
    return { ticket };
  });
  registerWorkRoutes(app, store, broadcast, options.integrationAdapters);
  app.get('/api/guide', async () => ({
    title: 'Mini AI Office — step-by-step guide',
    markdown: await readFile(path.resolve('docs/user-guide.md'), 'utf8'),
  }));
  registerStudioRoutes(app, store, queue, broadcast);
  const connected = registerConnected(
    app,
    store,
    queue,
    broadcast,
    options.accounts,
    !options.skipExternal,
  );
  const readers = registerReaderRoutes(
    app,
    store,
    queue,
    broadcast,
    options.readerDriver,
    !options.skipExternal,
  );
  const shifts = registerShiftRoutes(
    app,
    store,
    queue,
    connected.actions,
    broadcast,
    !options.skipExternal,
    options.sproutDriver,
  );
  app.get('/api/health', async () => ({ ok: true, authRequired: !!token }));
  app.get('/api/snapshot', async () => ({
    ...store.snapshot(),
    codex,
    authRequired: !!token,
  }));
  app.post('/api/execution/check', async () => {
    codex = await adapter.health();
    broadcast();
    return codex;
  });
  app.put('/api/simulation', async (_request, reply) =>
    reply
      .code(410)
      .send({ error: 'Simulation is disabled. Employee activity reflects actual saved jobs.' }),
  );
  app.put('/api/weather', async (request) => {
    const config = weatherConfigSchema.parse(request.body);
    store.put('settings', 'location', config);
    store.remove('settings', 'weather');
    const result = await refreshWeather(store, true);
    broadcast();
    return result;
  });
  app.post('/api/projects', async (request) => {
    const data = projectSchema.parse(request.body);
    const canonical = await realpath(data.path);
    if (!(await stat(canonical)).isDirectory()) throw new Error('Project path must be a directory');
    if (canonical.includes(',')) throw new Error('Docker workspace paths cannot contain commas');
    const git = await run('git', ['-C', canonical, 'rev-parse', '--show-toplevel'], {
      timeout: 10000,
    });
    if (git.code !== 0) throw new Error('Choose the root of a Git repository');
    const root = await realpath(git.output.trim());
    if (root !== canonical) throw new Error('Select the repository root, not a subdirectory');
    const commit = await run('git', ['-C', canonical, 'rev-parse', 'HEAD'], {
      timeout: 10000,
    });
    if (commit.code !== 0) throw new Error('Commit the project before connecting it');
    if (store.list<Project>('projects').some((p) => p.path === canonical))
      throw new Error('This project is already connected');
    const project: Project = {
      ...data,
      id: crypto.randomUUID(),
      path: canonical,
      color: '#94aa83',
    };
    store.put('projects', project.id, project);
    broadcast();
    return project;
  });
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request) => {
    const projectId = request.params.id;
    if (
      store
        .list<Job>('jobs')
        .some(
          (j) =>
            j.projectId === projectId &&
            ['QUEUED', 'PLANNING', 'RUNNING', 'TESTING', 'VERIFYING', 'AWAITING_APPROVAL'].includes(
              j.state,
            ),
        )
    )
      throw new Error('Cancel active jobs before disconnecting this project');
    store.remove('projects', projectId);
    broadcast();
    return { ok: true };
  });
  app.post('/api/jobs', async (request) => {
    const data = taskSchema.parse(request.body);
    if (!store.get<Employee>('employees', data.agentId)) throw new Error('Employee not found');
    if (!store.get<Project>('projects', data.projectId)?.approved)
      throw new Error('Connect and approve a project first');
    if (data.kind === 'meeting' && (!data.relatedId || !store.get('meetings', data.relatedId)))
      throw new Error('Meeting not found');
    if (data.kind === 'conversation' && data.relatedId !== data.agentId)
      throw new Error('Conversation must belong to the assigned employee');
    const job: Job = {
      ...data,
      memory: data.useWorkMemory
        ? new MemoryService(store).forRepository(data.projectId)
        : undefined,
      title: data.title || data.instruction.slice(0, 90),
      id: crypto.randomUUID(),
      state: 'DRAFT',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
      subtasks: [],
      result: 'Awaiting your approval to start. No agent has run.',
      testResult: 'Not run',
      workspace: '',
      logs: [],
    };
    store.put('jobs', job.id, job);
    broadcast();
    return job;
  });
  app.post<{ Params: { id: string; action: string } }>('/api/jobs/:id/:action', async (request) => {
    const job = store.get<Job>('jobs', request.params.id);
    if (!job) throw new Error('Task not found');
    const action = request.params.action;
    if (action === 'cancel') {
      if (
        ![
          'DRAFT',
          'QUEUED',
          'PLANNING',
          'RUNNING',
          'TESTING',
          'VERIFYING',
          'AWAITING_APPROVAL',
        ].includes(job.state)
      )
        throw new Error('This task cannot be cancelled');
      queue.cancel(job.id);
    } else {
      await queue.authorize(job.id, action, request.body);
      void queue.drain();
    }
    return store.get('jobs', job.id);
  });
  app.get<{ Params: { id: string } }>('/api/jobs/:id/diff', async (request) => {
    const job = store.get<Job>('jobs', request.params.id);
    if (!job?.workspace) return { diff: 'No saved changes yet.' };
    const phase = job.evidence ? 'tested' : 'after';
    try {
      return {
        diff: redact(
          await readFile(path.join(adapter.artifacts.directory(job), phase + '.patch'), 'utf8'),
        ),
        workspace: job.workspace,
      };
    } catch {
      return { diff: 'No captured changes yet.' };
    }
  });
  app.get<{ Params: { id: string; file: string } }>(
    '/api/jobs/:id/artifacts/:file',
    async (request, reply) => {
      const job = store.get<Job>('jobs', request.params.id);
      if (!job || job.attempts < 1) throw new Error('No job artifacts');
      const file = request.params.file;
      const allowed = [
        'tested.patch',
        'tested.json',
        'tested.tar.gz',
        'evidence.json',
        'tests.json',
        'approvals.json',
        'logs.jsonl',
        'source.json',
        'planning-run.json',
        ...(job.kind === 'communication-review'
          ? ['communication-run.json', 'communication-request.json', 'communication-report.json']
          : []),
        ...(job.kind === 'assistant-chat' ? ['chat-run.json'] : []),
        ...(job.kind === 'shift-review'
          ? ['shift-request.json', 'shift-run.json', 'shift-plan.json']
          : []),
        'execution-policy.json',
        ...(job.kind === 'content-ideas'
          ? ['content-request.json', 'idea-drafts.json', 'ideas-schema.json']
          : []),
        ...job.subtasks.map((_, index) => `run-${index}.json`),
      ];
      if (!allowed.includes(file)) return reply.code(404).send();
      if (job.evidence?.verified && ['tested.patch', 'tested.json', 'tested.tar.gz'].includes(file))
        adapter.artifacts.verify(job);
      const data = await readFile(path.join(adapter.artifacts.directory(job), file));
      reply.header('Content-Disposition', 'attachment; filename="' + file + '"');
      return reply
        .type(file.endsWith('.gz') ? 'application/gzip' : 'application/octet-stream')
        .send(data);
    },
  );
  app.post('/api/messages', async (request) => {
    const data = z.object({ channel: id, text }).parse(request.body);
    if (
      !['general', 'engineering', 'operations', 'announcements', 'inbox'].includes(data.channel) &&
      !store.get('employees', data.channel)
    )
      throw new Error('Unknown conversation');
    const message: Message = {
      ...data,
      id: crypto.randomUUID(),
      sender: 'ceo',
      at: Date.now(),
      mode: 'human',
      read: true,
    };
    store.put('messages', message.id, message);
    const job = enqueueChat(store, adapter, data.channel, data.text);
    queue.save(job);
    void queue.drain();
    broadcast();
    return message;
  });
  app.post('/api/messages/read', async (request) => {
    const { channel } = z.object({ channel: id }).parse(request.body);
    for (const message of store.list<Message>('messages'))
      if (message.channel === channel) {
        message.read = true;
        store.put('messages', message.id, message);
      }
    broadcast();
    return { ok: true };
  });
  app.post('/api/meetings', async (request) => {
    const data = meetingSchema.parse(request.body);
    if (data.participants.some((id) => !store.get('employees', id)))
      throw new Error('Unknown participant');
    if (data.startsAt < Date.now() - 60000) throw new Error('Choose a future meeting time');
    const meeting: Meeting = {
      ...data,
      id: crypto.randomUUID(),
      transcript: [],
      actions: [],
    };
    store.put('meetings', meeting.id, meeting);
    broadcast();
    return meeting;
  });
  app.delete<{ Params: { id: string } }>('/api/meetings/:id', async (request) => {
    store.remove('meetings', request.params.id);
    broadcast();
    return { ok: true };
  });
  app.put<{ Params: { id: string } }>('/api/meetings/:id/notes', async (request) => {
    const data = z
      .object({
        transcript: z.array(z.string().max(2000)).max(100),
        actions: z.array(z.string().max(1000)).max(50),
      })
      .parse(request.body);
    const meeting = store.get<Meeting>('meetings', request.params.id);
    if (!meeting) throw new Error('Meeting not found');
    store.put('meetings', meeting.id, { ...meeting, ...data, transcriptMode: 'human' });
    broadcast();
    return { ok: true };
  });
  app.patch<{ Params: { id: string } }>('/api/employees/:id', async (request) => {
    const data = employeeUpdate.parse(request.body);
    const employee = store.get<Employee>('employees', request.params.id);
    if (!employee) throw new Error('Employee not found');
    store.put('employees', employee.id, { ...employee, ...data });
    broadcast();
    return { ok: true };
  });
  app.post('/api/employees', async (request) => {
    const data = employeeUpdate.required().parse(request.body);
    const employees = store.list<Employee>('employees');
    if (employees.length >= 25) throw new Error('The office supports up to 25 employees');
    const base = employees[0];
    if (!base) throw new Error('Keep one employee as a template');
    const employee: Employee = {
      ...base,
      ...data,
      id: crypto.randomUUID(),
      color: '#99a68c',
      desk: [-11 + (employees.length % 6) * 2, 8],
      room: 'studio',
    };
    store.put('employees', employee.id, employee);
    broadcast();
    return employee;
  });
  app.delete<{ Params: { id: string } }>('/api/employees/:id', async (request) => {
    if (request.params.id === 'sarah')
      throw new Error('Sarah coordinates the execution queue and must remain in the office');
    if (
      store
        .list<Job>('jobs')
        .some(
          (j) =>
            j.agentId === request.params.id &&
            [
              'DRAFT',
              'QUEUED',
              'PLANNING',
              'RUNNING',
              'TESTING',
              'VERIFYING',
              'AWAITING_APPROVAL',
            ].includes(j.state),
        )
    )
      throw new Error('Cancel this employee’s pending tasks first');
    store.remove('employees', request.params.id);
    broadcast();
    return { ok: true };
  });
  if (existsSync(path.resolve('dist/index.html'))) {
    app.get('/', async (_request, reply) =>
      reply.type('text/html').send(await readFile(path.resolve('dist/index.html'))),
    );
    app.get<{ Params: { file: string } }>('/assets/:file', async (request, reply) => {
      const file = request.params.file;
      if (!/^[\w.-]+\.(?:js|css|woff2|png|svg)$/.test(file)) return reply.code(404).send();
      const asset = path.resolve('dist/assets', file);
      if (!existsSync(asset)) return reply.code(404).send();
      const types: Record<string, string> = {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
      };
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.type(types[path.extname(file)]).send(await readFile(asset));
    });
  }
  app.addHook('onClose', async () => {
    await shifts.shutdown();
    await readers.shutdown();
    await connected.shutdown();
    if (weatherTimer) clearInterval(weatherTimer);
    for (const peer of peers) peer.close();
    await queue.close();
    await Promise.allSettled([...pending]);
    store.close();
  });
  if (!options.skipExternal)
    queueMicrotask(() => {
      void queue.recover().then(() => queue.drain());
    });
  return app;
}
