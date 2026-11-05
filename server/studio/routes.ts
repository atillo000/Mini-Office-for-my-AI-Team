import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Store } from '../db';
import type { JobQueue } from '../agents/queue';
import type { Job } from '../../shared/types';
import { digest } from '../agents/artifacts';
import { MemoryService } from './memory';
import { contentOf, contentScope, StudioService } from './service';
import { saveProductionPolicy } from './production';
export function registerStudioRoutes(
  app: FastifyInstance,
  store: Store,
  queue: JobQueue,
  changed: () => void,
) {
  const studio = new StudioService(store),
    memory = new MemoryService(store);
  app.put('/api/studio/production', async (request) => {
    const value = saveProductionPolicy(store, request.body);
    changed();
    return value;
  });
  app.get('/api/studio', async () => {
    const snapshot = studio.snapshot();
    return {
      ...snapshot,
      generationScopes:
        snapshot.project && snapshot.brief
          ? {
              withoutProfile: contentScope(studio.request(false)),
              withProfile: snapshot.profile.confirmed ? contentScope(studio.request(true)) : null,
            }
          : null,
      rememberedFeedback: snapshot.project && snapshot.brief ? studio.request(false).feedback : [],
      ideas: snapshot.ideas.map((idea) => ({ ...idea, contentHash: digest(contentOf(idea)) })),
    };
  });
  app.post('/api/studio/setup', async () => {
    const value = studio.setup();
    changed();
    return value;
  });
  app.put('/api/work/profile', async (request) => {
    const value = memory.save(request.body);
    changed();
    return value;
  });
  app.get('/api/work/profile', async () => memory.profile());
  app.put('/api/studio/brief', async (request) => {
    const value = studio.saveBrief(request.body);
    changed();
    return value;
  });
  app.put<{ Params: { id: string } }>('/api/studio/ideas/:id', async (request) => {
    const value = studio.updateIdea(request.params.id, request.body);
    changed();
    return value;
  });
  app.post<{ Params: { id: string } }>('/api/studio/ideas/:id/review', async (request) => {
    const value = studio.review(request.params.id, request.body);
    changed();
    return value;
  });
  app.post('/api/studio/generate', async (request) => {
    const input = z
      .object({
        briefVersion: z.number().int().min(1),
        approved: z.literal(true),
        scopeHash: z.string().length(64),
        includeProfile: z.boolean().default(false),
      })
      .strict()
      .parse(request.body);
    const content = studio.request(input.includeProfile);
    if (input.scopeHash !== contentScope(content))
      throw new Error(
        'Shared brief, profile or feedback changed. Reload and approve the current context.',
      );
    if (content.brief.version !== input.briefVersion)
      throw new Error('Video brief changed. Review it before generating.');
    if (
      store
        .list<Job>('jobs')
        .some(
          (job) =>
            job.kind === 'content-ideas' &&
            job.projectId === content.project.id &&
            ['QUEUED', 'PLANNING', 'RUNNING'].includes(job.state),
        )
    )
      throw new Error('The team is already preparing drafts for this project.');
    const job: Job = {
      id: crypto.randomUUID(),
      projectId: content.project.id,
      agentId: 'sarah',
      kind: 'content-ideas',
      title: 'Brainstorm three AI video drafts',
      instruction: content.brief.direction,
      contentRequest: content,
      policyHash: digest(queue.adapter.policy()),
      state: 'QUEUED',
      stage: 'plan',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 1,
      workspace: '',
      result: 'Approved brief queued for team discussion. Ideas will remain drafts.',
      testResult: 'Not applicable: content drafting',
      subtasks: [],
      logs: [],
      approvals: [
        {
          id: crypto.randomUUID(),
          kind: 'planning',
          scopeHash: digest(content),
          approvedBy: 'ceo',
          at: Date.now(),
          attempt: 1,
        },
      ],
    };
    queue.adapter.artifacts.init(job);
    queue.adapter.artifacts.write(job, 'execution-policy.json', queue.adapter.policy());
    queue.adapter.artifacts.write(job, 'content-request.json', content);
    queue.adapter.artifacts.write(job, 'approvals.json', job.approvals);
    queue.save(job);
    void queue.drain();
    return job;
  });
  app.post('/api/studio/publish', async (_request, reply) =>
    reply.code(409).send({
      error:
        'Publishing is not connected. Idea approval does not authorize posting. A rendered video, connected destination and separate exact-post approval are required.',
    }),
  );
}
