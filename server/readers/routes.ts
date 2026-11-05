import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from '../db';
import type { JobQueue } from '../agents/queue';
import type {
  CapturedMessage,
  CommunicationReport,
  LocalReplyDraft,
  ReaderSnapshot,
} from '../../shared/reader';
import { EdgeReader, type ReaderDriver } from './browser';
import { ReaderService } from './service';
import { enqueueCommunication } from './review';
import { digest } from '../agents/artifacts';
const provider = z.enum(['outlook', 'teams']);
export function registerReaderRoutes(
  app: FastifyInstance,
  store: Store,
  queue: JobQueue,
  changed: () => void,
  driver?: ReaderDriver,
  enabled = true,
) {
  const readers = new ReaderService(
    store,
    driver || new EdgeReader(store.file + '.browser'),
    queue,
    changed,
  );
  app.get('/api/readers', async () => ({
    readers: [readers.state('outlook'), readers.state('teams')],
  }));
  app.post<{ Params: { provider: string; action: string } }>(
    '/api/readers/:provider/:action',
    async (request) => {
      const p = provider.parse(request.params.provider),
        action = request.params.action;
      if (!enabled && !driver)
        throw new Error('External browser reading is disabled in offline QA.');
      if (action === 'open') return readers.open(p);
      if (action === 'stop') return readers.stop(p);
      if (action === 'close') return readers.close(p);
      const input = z
        .object({ mode: z.enum(['LIST', 'SELECTED']), shareWithAI: z.boolean().default(false) })
        .strict()
        .parse(request.body);
      if (action === 'capture') return readers.capture(p, input.mode, input.shareWithAI);
      if (action === 'watch') return readers.watch(p, input.mode, input.shareWithAI);
      throw new Error('Unknown read-only browser action.');
    },
  );
  app.get<{ Params: { provider: string } }>('/api/readers/:provider/messages', async (request) => {
    const p = provider.parse(request.params.provider);
    return {
      state: readers.state(p),
      messages: store
        .list<CapturedMessage>('captured_messages')
        .filter((m) => m.provider === p)
        .toSorted((a, b) => b.observedAt - a.observedAt)
        .slice(0, 200),
      snapshots: store
        .list<ReaderSnapshot>('reader_snapshots')
        .filter((s) => s.provider === p)
        .slice(-20)
        .toReversed(),
      reports: store
        .list<CommunicationReport>('communication_reports')
        .filter((r) => r.provider === p)
        .slice(-20)
        .toReversed(),
      drafts: store
        .list<LocalReplyDraft>('local_reply_drafts')
        .filter((d) => d.provider === p)
        .slice(-100)
        .toReversed(),
      jobs: store
        .list<import('../../shared/types').Job>('jobs')
        .filter((j) => j.kind === 'communication-review' && j.relatedId === 'external:' + p)
        .slice(-10)
        .toReversed(),
    };
  });
  app.post<{ Params: { id: string } }>('/api/reader-snapshots/:id/review', async (request) => {
    const input = z
      .object({ approved: z.literal(true), hash: z.string().length(64) })
      .strict()
      .parse(request.body);
    const snapshot = store.get<ReaderSnapshot>('reader_snapshots', request.params.id);
    if (!snapshot || snapshot.hash !== input.hash)
      throw new Error('Capture changed. Review it before sharing with AI.');
    const messages = snapshot.messageIds.map((id) =>
      store.get<CapturedMessage>('captured_messages', id)!,
    );
    if (messages.some((m) => !m) || digest(messages) !== snapshot.hash)
      throw new Error('Captured messages changed. Capture the current view again.');
    const value = { snapshot, messages, consentHash: digest({ snapshot, messages }) };
    const job = enqueueCommunication(store, queue.adapter, value);
    queue.save(job);
    void queue.drain();
    return job;
  });
  app.put<{ Params: { id: string } }>('/api/local-reply-drafts/:id', async (request) =>
    readers.editDraft(request.params.id, request.body),
  );
  app.post<{ Params: { id: string } }>('/api/captured-messages/:id/draft', async (request) => {
    const { body } = z
      .object({ body: z.string().trim().min(1).max(6000) })
      .strict()
      .parse(request.body);
    const message = store.get<CapturedMessage>('captured_messages', request.params.id);
    if (!message) throw new Error('Captured message not found.');
    const value: LocalReplyDraft = {
      id: crypto.randomUUID(),
      provider: message.provider,
      sourceMessageId: message.id,
      reportId: '',
      scope: message.scope,
      body,
      status: 'DRAFT',
      origin: 'CEO',
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.put('local_reply_drafts', value.id, value);
    changed();
    return value;
  });
  return readers;
}
