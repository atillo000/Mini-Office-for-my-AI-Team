import { z } from 'zod';
import type { Store } from '../db';
import { digest } from '../agents/artifacts';
import type {
  CapturedMessage,
  CaptureMode,
  CommunicationRequest,
  LocalReplyDraft,
  ReaderProvider,
  ReaderSnapshot,
  ReaderState,
} from '../../shared/reader';
import type { JobQueue } from '../agents/queue';
import { enqueueCommunication } from './review';
import { allowedReaderUrl, ReaderError, type ReaderDriver } from './browser';
export class ReaderService {
  private busy = new Set<ReaderProvider>();
  private watches = new Map<
    ReaderProvider,
    { scope: string; epoch: number; mode: CaptureMode; share: boolean }
  >();
  private pending = new Set<Promise<unknown>>();
  private timer: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(
    public store: Store,
    public driver: ReaderDriver,
    public queue: JobQueue,
    public changed: () => void,
  ) {
    for (const p of ['outlook', 'teams'] as const)
      this.save({ ...this.state(p), state: 'CLOSED', watching: false, lastError: undefined });
    this.timer = setInterval(() => {
      for (const [provider, watch] of this.watches)
        this.background(this.capture(provider, watch.mode, watch.share, true));
    }, 60000);
  }
  state(provider: ReaderProvider): ReaderState {
    return (
      this.store.get<ReaderState>('browser_readers', provider) || {
        provider,
        state: 'CLOSED',
        mode: provider === 'outlook' ? 'LIST' : 'SELECTED',
        watching: false,
        shareWithAI: false,
        scope: '',
      }
    );
  }
  private save(state: ReaderState) {
    this.store.put('browser_readers', state.provider, state);
    this.changed();
    return state;
  }
  private background(promise: Promise<unknown>) {
    const task = promise.catch(() => undefined);
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }
  async open(provider: ReaderProvider) {
    if (this.stopped || this.busy.has(provider))
      throw new Error('Reader is busy. Try again when the current capture finishes.');
    this.busy.add(provider);
    try {
      await this.driver.open(provider);
      this.watches.delete(provider);
      return this.save({
        ...this.state(provider),
        state: 'OPEN',
        watching: false,
        scope: '',
        lastError: undefined,
      });
    } catch (e) {
      this.save({
        ...this.state(provider),
        state: 'ERROR',
        lastError: (e as Error).message,
        watching: false,
      });
      throw e;
    } finally {
      this.busy.delete(provider);
    }
  }
  async capture(provider: ReaderProvider, mode: CaptureMode, share: boolean, watched = false) {
    if (this.stopped || this.busy.has(provider)) throw new Error('Reader is closed or busy.');
    if (provider === 'teams' && mode !== 'SELECTED')
      throw new Error('Teams reads the selected conversation only.');
    const watch = this.watches.get(provider);
    if (watch && !watched && (mode !== watch.mode || share !== watch.share))
      throw new Error('Stop watching before changing the view or AI sharing.');
    if (watched && (!watch || this.driver.epoch(provider) !== watch.epoch))
      return this.stopChanged(provider);
    this.busy.add(provider);
    this.save({ ...this.state(provider), state: 'READING', lastError: undefined });
    try {
      const epoch = this.driver.epoch(provider),
        view = await this.driver.read(provider, mode);
      if (!allowedReaderUrl(provider, view.sourceUrl))
        throw new ReaderError(
          'NEEDS_SIGN_IN',
          'The selected page is not an authorized Outlook or Teams view.',
        );
      if (epoch !== this.driver.epoch(provider) || (watched && view.scope !== watch?.scope))
        throw new ReaderError(
          'NEEDS_SELECTION',
          'The browser changed views. Select and capture the new view before watching it.',
        );
      const sourceUrl = new URL(view.sourceUrl);
      sourceUrl.search = '';
      sourceUrl.hash = '';
      const observedAt = Date.now(),
        messages: CapturedMessage[] = [],
        fresh: CapturedMessage[] = [];
      this.store.transaction(() => {
        for (const entry of view.messages) {
          if (!entry.text.trim()) continue;
          const id = digest({
            provider,
            scope: view.scope,
            sourceId: entry.sourceId || entry.text,
          });
          const old = this.store.get<CapturedMessage>('captured_messages', id);
          const value: CapturedMessage = {
            ...entry,
            id,
            provider,
            scope: view.scope,
            sourceUrl: sourceUrl.toString(),
            firstSeenAt: old?.firstSeenAt || observedAt,
            observedAt,
            version: old
              ? old.version + (old.text === entry.text && old.author === entry.author ? 0 : 1)
              : 1,
          };
          messages.push(value);
          if (!old || old.version !== value.version) fresh.push(value);
          this.store.put('captured_messages', id, value);
        }
      });
      if (!messages.length)
        throw new ReaderError(
          'NEEDS_SELECTION',
          'No rendered messages were captured. No report was generated.',
        );
      const snapshot: ReaderSnapshot = {
        id: crypto.randomUUID(),
        provider,
        scope: view.scope,
        sourceUrl: sourceUrl.toString(),
        mode,
        messageIds: messages.map((m) => m.id),
        capturedAt: observedAt,
        hash: digest(messages),
        complete: false,
        coverage:
          'Only ' +
          messages.length +
          ' rendered ' +
          (mode === 'LIST' ? 'mail previews' : 'messages in the selected view') +
          ' were captured. Unloaded history, other chats and folders were not checked.' +
          (view.truncated ? ' Long text or additional rows were omitted by capture limits.' : ''),
      };
      this.store.put('reader_snapshots', snapshot.id, snapshot);
      let jobId: string | undefined;
      const needsReview = messages.some(
        (m) =>
          this.store.get<{ version: number }>('reader_review_requested', m.id)?.version !==
          m.version,
      );
      if (share && (!watched || needsReview)) {
        const running = this.store
          .list<import('../../shared/types').Job>('jobs')
          .some(
            (j) =>
              j.kind === 'communication-review' &&
              j.relatedId === 'external:' + provider &&
              ['QUEUED', 'RUNNING'].includes(j.state),
          );
        if (!running) {
          const request: CommunicationRequest = { snapshot, messages, consentHash: '' };
          request.consentHash = digest({ snapshot, messages });
          const job = enqueueCommunication(this.store, this.queue.adapter, request);
          jobId = job.id;
          this.queue.save(job);
          void this.queue.drain();
          for (const message of messages)
            this.store.put('reader_review_requested', message.id, {
              version: message.version,
              jobId: job.id,
            });
        }
      }
      this.save({
        ...this.state(provider),
        state: 'OPEN',
        mode,
        scope: view.scope,
        shareWithAI: share,
        watching: !!this.watches.get(provider),
        lastReadAt: observedAt,
        lastError: undefined,
      });
      return { snapshot, newMessages: fresh.length, jobId };
    } catch (error) {
      this.watches.delete(provider);
      const state = error instanceof ReaderError ? error.state : 'ERROR';
      this.save({
        ...this.state(provider),
        state,
        watching: false,
        lastError: (error as Error).message,
      });
      throw error;
    } finally {
      this.busy.delete(provider);
    }
  }
  private stopChanged(provider: ReaderProvider): never {
    this.watches.delete(provider);
    this.save({
      ...this.state(provider),
      state: 'NEEDS_SELECTION',
      watching: false,
      lastError:
        'The managed page was reloaded or navigated. Capture and enable watching again for the current view.',
    });
    throw new ReaderError('NEEDS_SELECTION', 'The watched browser changed views.');
  }
  async watch(provider: ReaderProvider, mode: CaptureMode, share: boolean) {
    const result = await this.capture(provider, mode, share);
    this.watches.set(provider, {
      scope: result.snapshot.scope,
      epoch: this.driver.epoch(provider),
      mode,
      share,
    });
    this.save({ ...this.state(provider), watching: true });
    return result;
  }
  stop(provider: ReaderProvider) {
    this.watches.delete(provider);
    return this.save({ ...this.state(provider), watching: false });
  }
  async close(provider: ReaderProvider) {
    this.stop(provider);
    await this.driver.close(provider);
    return this.save({ ...this.state(provider), state: 'CLOSED' });
  }
  editDraft(id: string, raw: unknown) {
    const input = z
      .object({
        version: z.number().int().min(1),
        body: z.string().trim().min(1).max(6000),
        status: z.enum(['DRAFT', 'REVIEWED', 'ARCHIVED']),
      })
      .strict()
      .parse(raw);
    return this.store.transaction(() => {
      const draft = this.store.get<LocalReplyDraft>('local_reply_drafts', id);
      if (!draft || draft.version !== input.version)
        throw new Error('Local draft changed. Reload before reviewing.');
      const changed = input.body !== draft.body;
      const value = {
        ...draft,
        ...input,
        status: changed ? ('DRAFT' as const) : input.status,
        version: draft.version + 1,
        updatedAt: Date.now(),
      };
      this.store.put('local_reply_drafts', id, value);
      this.changed();
      return value;
    });
  }
  async shutdown() {
    this.stopped = true;
    clearInterval(this.timer);
    this.watches.clear();
    await Promise.allSettled((['outlook', 'teams'] as const).map((p) => this.driver.close(p)));
    await Promise.allSettled([...this.pending]);
  }
}
