import { z } from 'zod';
import type { Store } from '../db';
import type { JobQueue } from '../agents/queue';
import type {
  CapturedMessage,
  ReaderProvider,
  ReaderAutomationSettings,
  ReaderAutomationState,
  ReaderSnapshot,
  CommunicationRequest,
} from '../../shared/reader';
import type { Job } from '../../shared/types';
import { ReaderService } from './service';
import { ReaderError } from './browser';
import { focusContext, messageRelevance } from '../connected/focus';
import { digest } from '../agents/artifacts';
import { enqueueCommunication } from './review';
const contentKey = (m: CapturedMessage) =>
  digest({
    provider: m.provider,
    scope: m.provider === 'teams' ? m.scope : '',
    text: m.text,
    author: m.author,
    sentAt: m.sentAt,
    preview: m.preview,
  });
export function automationSettings(
  store: Store,
  provider: ReaderProvider,
): ReaderAutomationSettings {
  return (
    store.get<ReaderAutomationSettings>('reader_automation', provider) || {
      provider,
      enabled: false,
      shareWithAI: false,
      intervalMinutes: 3,
      version: 1,
    }
  );
}
export class AutomaticReaders {
  private stopped = false;
  private runs = new Map<ReaderProvider, Promise<void>>();
  private timer: ReturnType<typeof setInterval>;
  private startup: ReturnType<typeof setTimeout>;
  constructor(
    public store: Store,
    public readers: ReaderService,
    public queue: JobQueue,
    public changed: () => void,
    private enabled = true,
  ) {
    for (const provider of ['outlook', 'teams'] as const)
      this.save({
        provider,
        status: automationSettings(store, provider).enabled ? 'STARTING' : 'OFF',
        visitedViews: 0,
        capturedMessages: 0,
      });
    this.timer = setInterval(() => this.tick(), 30000);
    this.startup = setTimeout(() => this.tick(true), 1000);
  }
  state(provider: ReaderProvider) {
    return this.store.get<ReaderAutomationState>('reader_automation_state', provider)!;
  }
  private save(state: ReaderAutomationState) {
    this.store.put('reader_automation_state', state.provider, state);
    this.changed();
    return state;
  }
  async configure(provider: ReaderProvider, raw: unknown) {
    const input = z
        .object({
          version: z.number().int().min(1),
          enabled: z.boolean(),
          shareWithAI: z.boolean(),
          intervalMinutes: z.number().int().min(1).max(30),
        })
        .strict()
        .parse(raw),
      old = automationSettings(this.store, provider);
    if (input.version !== old.version)
      throw new Error('Automatic reader settings changed. Reload before saving.');
    const settings = { ...input, provider, version: old.version + 1 };
    this.store.put('reader_automation', provider, settings);
    this.readers.stop(provider);
    this.save({
      ...this.state(provider),
      status: input.enabled ? 'STARTING' : 'OFF',
      error: undefined,
      nextRunAt: undefined,
    });
    for (const job of this.store.list<Job>('jobs'))
      if (
        job.communicationRequest?.automation?.provider === provider &&
        ['QUEUED', 'RUNNING'].includes(job.state)
      )
        this.queue.cancel(job.id);
    if (input.enabled) this.schedule(provider);
    return { settings, state: this.state(provider) };
  }
  pause(provider: ReaderProvider) {
    const old = automationSettings(this.store, provider);
    if (old.enabled) {
      this.store.put('reader_automation', provider, {
        ...old,
        enabled: false,
        version: old.version + 1,
      });
      for (const job of this.store.list<Job>('jobs'))
        if (
          job.communicationRequest?.automation?.provider === provider &&
          ['QUEUED', 'RUNNING'].includes(job.state)
        )
          this.queue.cancel(job.id);
    }
    this.save({ ...this.state(provider), status: 'OFF', nextRunAt: undefined });
  }
  tick(force = false) {
    if (this.stopped || !this.enabled) return;
    for (const provider of ['outlook', 'teams'] as const) {
      const config = automationSettings(this.store, provider);
      if (
        config.enabled &&
        (force || !this.state(provider).nextRunAt || this.state(provider).nextRunAt! <= Date.now())
      )
        this.schedule(provider);
    }
  }
  private schedule(provider: ReaderProvider) {
    if (this.stopped || !this.enabled || this.runs.has(provider)) return;
    const work = this.cycle(provider).finally(() => this.runs.delete(provider));
    this.runs.set(provider, work);
  }
  async runNow(provider: ReaderProvider) {
    if (!this.enabled) throw new Error('Automatic browser reading is disabled in offline QA.');
    if (!automationSettings(this.store, provider).enabled)
      throw new Error('Enable the automatic reader first.');
    this.schedule(provider);
    await this.runs.get(provider);
    return this.state(provider);
  }
  private current(config: ReaderAutomationSettings) {
    const latest = automationSettings(this.store, config.provider);
    if (this.stopped || !latest.enabled || latest.version !== config.version)
      throw new Error('Automatic reader was paused or its settings changed.');
  }
  private async cycle(provider: ReaderProvider) {
    const config = automationSettings(this.store, provider);
    let visitedViews = 0,
      capturedMessages = 0;
    const snapshots: ReaderSnapshot[] = [],
      errors: string[] = [];
    try {
      this.current(config);
      this.readers.stop(provider);
      this.save({ ...this.state(provider), status: 'STARTING', error: undefined });
      await this.readers.open(provider, true);
      this.current(config);
      if (!this.readers.driver.targets || !this.readers.driver.select)
        throw new Error('This browser driver does not support automatic navigation.');
      const context = focusContext(this.store);
      if (!context.settings.enabled)
        throw new Error('Enable My projects work focus before automatic reading.');
      const targets = await this.readers.driver.targets(provider, context.numbers);
      for (const target of targets.slice(0, 8)) {
        this.current(config);
        this.save({
          ...this.state(provider),
          status: 'READING',
          coverage: 'Reading ' + target.label,
        });
        try {
          await this.readers.driver.select(provider, target.id);
          this.current(config);
          const result = await this.readers.capture(
            provider,
            provider === 'outlook' ? 'LIST' : 'SELECTED',
            false,
          );
          this.current(config);
          visitedViews++;
          capturedMessages += result.snapshot.messageIds.length;
          snapshots.push(result.snapshot);
        } catch (error) {
          if (error instanceof ReaderError && error.state === 'NEEDS_SIGN_IN') throw error;
          errors.push((error as Error).message.split('\n')[0].slice(0, 400));
        }
      }
      this.current(config);
      if (!visitedViews)
        throw new ReaderError(
          'NEEDS_SELECTION',
          errors[0] || 'No rendered work view was available. The team will retry.',
        );
      if (config.shareWithAI) this.review(provider, config, snapshots, errors.length);
      this.save({
        provider,
        status: 'MONITORING',
        visitedViews,
        capturedMessages,
        lastRunAt: Date.now(),
        nextRunAt: Date.now() + config.intervalMinutes * 60000,
        error: errors.length ? errors[0] : undefined,
        coverage:
          'Checked ' +
          visitedViews +
          ' rendered ' +
          (provider === 'outlook' ? 'mail views' : 'conversations') +
          '. ' +
          errors.length +
          ' view(s) were unavailable. Unloaded history, attachments and other chats were not checked.',
      });
    } catch (error) {
      if (
        this.stopped ||
        !automationSettings(this.store, provider).enabled ||
        automationSettings(this.store, provider).version !== config.version
      )
        return;
      this.save({
        provider,
        status:
          error instanceof ReaderError && error.state === 'NEEDS_SIGN_IN'
            ? 'NEEDS_SIGN_IN'
            : 'NEEDS_ATTENTION',
        visitedViews,
        capturedMessages,
        lastRunAt: Date.now(),
        nextRunAt: Date.now() + config.intervalMinutes * 60000,
        error: (error as Error).message.split('\n')[0].slice(0, 400),
        coverage:
          'No complete mailbox or all-chat check is claimed. The team will retry while automatic mode remains enabled.',
      });
    }
  }
  private review(
    provider: ReaderProvider,
    config: ReaderAutomationSettings,
    snapshots: ReaderSnapshot[],
    failedViews: number,
  ) {
    if (
      this.store
        .list<Job>('jobs')
        .some(
          (j) =>
            j.kind === 'communication-review' &&
            j.relatedId === 'external:' + provider &&
            ['QUEUED', 'RUNNING'].includes(j.state),
        )
    )
      return;
    const ids = [...new Set(snapshots.flatMap((s) => s.messageIds))];
    // Provider DOM IDs and Outlook result sections can change without new message content.
    // Include earlier manual/automatic requests so an app restart cannot spend quota again.
    const requested = new Set(
      this.store
        .list<Job>('jobs')
        .flatMap((j) => (j.communicationRequest?.messages || []).map(contentKey)),
    );
    let size = 0;
    const messages = ids
      .map((id) => this.store.get<CapturedMessage>('captured_messages', id)!)
      .filter(
        (m) =>
          m &&
          messageRelevance(this.store, m).relevant &&
          !requested.has(contentKey(m)) &&
          this.store.get<{ version: number }>('reader_review_requested', m.id)?.version !==
            m.version,
      )
      .filter((m) => {
        if (requested.has(contentKey(m))) return false;
        if (size + m.text.length > 48000) return false;
        requested.add(contentKey(m));
        size += m.text.length;
        return true;
      })
      .slice(0, 50);
    if (!messages.length) return;
    const snapshot: ReaderSnapshot = {
      id: crypto.randomUUID(),
      provider,
      scope: 'Automatic ' + provider + ' work review',
      sourceUrl: snapshots[0].sourceUrl,
      mode: provider === 'outlook' ? 'LIST' : 'SELECTED',
      messageIds: messages.map((m) => m.id),
      capturedAt: Date.now(),
      hash: digest(messages),
      complete: false,
      coverage:
        'Only ' +
        messages.length +
        ' new or changed work messages from ' +
        snapshots.length +
        ' rendered views were selected. ' +
        failedViews +
        ' views were unavailable. Unloaded history and other conversations were not checked.',
    };
    const focus = focusContext(this.store);
    const request: CommunicationRequest = {
      snapshot,
      messages,
      consentHash: digest({ snapshot, messages }),
      automation: { provider, version: config.version },
      focus: { numbers: focus.numbers, selfNames: focus.settings.selfNames, notice: focus.notice },
    };
    this.store.put('reader_snapshots', snapshot.id, snapshot);
    const job = enqueueCommunication(this.store, this.queue.adapter, request);
    this.queue.save(job);
    for (const message of messages)
      this.store.put('reader_review_requested', message.id, {
        version: message.version,
        jobId: job.id,
      });
    void this.queue.drain();
  }
  async shutdown() {
    this.stopped = true;
    clearTimeout(this.startup);
    clearInterval(this.timer);
    await Promise.allSettled(
      (['outlook', 'teams'] as const).map((p) => this.readers.driver.close(p)),
    );
    await Promise.allSettled([...this.runs.values()]);
  }
}
