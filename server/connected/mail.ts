import { createHash } from 'node:crypto';
import type { Store } from '../db';
import type { MailItem, MailSync } from '../../shared/connected';
import type { KnowledgeProject } from '../../shared/work';
import { contains } from '../work/classifier';
import { Accounts } from './accounts';
const initial =
  '/v1.0/me/mailFolders/inbox/messages/delta?$select=id,changeKey,subject,body,from,replyTo,receivedDateTime,isRead,webLink&$top=100';
export function mailMatch(subject: string, body: string, projects: KnowledgeProject[]) {
  const text = subject + '\n' + body;
  const numbers = [...new Set(text.match(/\b20\d{6}\b/g) || [])];
  const matched = projects.filter((p) =>
    [p.name, ...p.aliases].some((name) => contains(text, name)),
  );
  const proposal = /\b(proposal|prototyp(?:e|ing)|pre[- ]?sales|quotation|bid)\b/i.test(text);
  const routing = proposal
    ? 'BUSINESS_DEVELOPMENT'
    : matched.length === 1 || numbers.length === 1
      ? 'PROJECT'
      : matched.length > 1 || numbers.length > 1
        ? 'NEEDS_REVIEW'
        : 'GENERAL';
  return {
    projectIds: matched.map((p) => p.id),
    projectNumbers: numbers,
    routing,
    reason: proposal
      ? 'Proposal/prototype wording: review Business Development routing.'
      : routing === 'PROJECT'
        ? 'Matched a registered project or project number. Confirm approval stage before logging.'
        : routing === 'GENERAL'
          ? 'No project number matched. Review General routing.'
          : 'Multiple project matches need your choice.',
  } satisfies Pick<MailItem, 'projectIds' | 'projectNumbers' | 'routing' | 'reason'>;
}
export class MailService {
  private running: Promise<void> | null = null;
  private starting: Promise<MailSync | null> | null = null;
  private controller?: AbortController;
  constructor(
    public store: Store,
    public accounts: Accounts,
    public changed: () => void,
  ) {
    const saved = store.get<MailSync>('mail_sync', 'inbox');
    if (saved?.state === 'RUNNING')
      store.put('mail_sync', 'inbox', {
        ...saved,
        state: 'INTERRUPTED',
        error: 'Service stopped. Resume to continue from the saved page.',
      });
  }
  state() {
    return this.store.get<MailSync>('mail_sync', 'inbox') || null;
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = this.startNow().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  private async startNow() {
    if (this.running) return this.state();
    const account = (await this.accounts.tokens('outlook')).account;
    const old = this.state();
    const state: MailSync =
      old?.account === account
        ? { ...old, state: 'RUNNING', error: undefined }
        : { id: 'inbox', account, state: 'RUNNING', complete: false, processed: 0 };
    this.store.put('mail_sync', 'inbox', state);
    this.controller = new AbortController();
    this.running = this.sync(state, this.controller.signal).finally(() => {
      this.running = null;
      this.controller = undefined;
    });
    this.changed();
    return state;
  }
  private async sync(state: MailSync, signal: AbortSignal) {
    try {
      let next = state.cursor || state.delta || initial;
      // Follow every page, saving after each. No date cutoff or "latest 50" shortcut.
      const seen = new Set<string>();
      while (next) {
        signal.throwIfAborted();
        if (seen.has(next))
          throw new Error(
            'Outlook returned a repeated paging cursor. Resume after checking the connection.',
          );
        seen.add(next);
        if ((await this.accounts.tokens('outlook')).account !== state.account)
          throw new Error('Outlook account changed. Start a new sync.');
        const response = await this.accounts.request('outlook', next, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        });
        const page = (await response.json()) as {
          value: Record<string, unknown>[];
          '@odata.nextLink'?: string;
          '@odata.deltaLink'?: string;
        };
        if (!Array.isArray(page.value) || (!page['@odata.nextLink'] && !page['@odata.deltaLink']))
          throw new Error(
            'Outlook did not return a complete paging contract. No complete sync is claimed.',
          );
        const projects = this.store.list<KnowledgeProject>('knowledge_projects');
        this.store.transaction(() => {
          for (const raw of page.value) {
            if (typeof raw.id !== 'string')
              throw new Error('Outlook returned a message without an ID.');
            const id = createHash('sha256')
              .update(state.account + ':' + raw.id)
              .digest('hex');
            const old = this.store.get<MailItem>('mail_items', id);
            if (raw['@removed']) {
              if (old)
                this.store.put('mail_items', id, {
                  ...old,
                  removed: true,
                  version: old.version + 1,
                });
              continue;
            }
            const body = (raw.body as { content?: string } | undefined)?.content ?? old?.body ?? '';
            const subject =
              raw.subject === undefined
                ? old?.subject || '(No subject)'
                : String(raw.subject || '(No subject)');
            const from =
              (raw.from as { emailAddress?: { address?: string } } | undefined)?.emailAddress
                ?.address ||
              old?.from ||
              '';
            const replyTo = Array.isArray(raw.replyTo)
              ? raw.replyTo
                  .map(
                    (r) =>
                      (r as { emailAddress?: { address?: string } }).emailAddress?.address || '',
                  )
                  .filter(Boolean)
              : old?.replyTo || [];
            const item: MailItem = {
              id,
              account: state.account,
              providerId: raw.id,
              changeKey: String(raw.changeKey || old?.changeKey || ''),
              subject,
              body,
              from,
              replyTo,
              receivedAt: String(raw.receivedDateTime || old?.receivedAt || ''),
              isRead: typeof raw.isRead === 'boolean' ? raw.isRead : old?.isRead || false,
              webLink: String(raw.webLink || old?.webLink || ''),
              removed: false,
              ...mailMatch(subject, body, projects),
              version: (old?.version || 0) + 1,
            };
            this.store.put('mail_items', id, item);
          }
          state.processed += page.value.length;
          state.cursor = page['@odata.nextLink'];
          state.delta = page['@odata.deltaLink'] || state.delta;
          if (!state.cursor) {
            state.complete = true;
            state.lastSyncAt = Date.now();
            state.state = 'IDLE';
          }
          this.store.put('mail_sync', 'inbox', state);
        });
        this.changed();
        next = page['@odata.nextLink'] || '';
      }
    } catch (error) {
      state.state = signal.aborted ? 'INTERRUPTED' : 'FAILED';
      state.error = (error as Error).message;
      this.store.put('mail_sync', 'inbox', state);
      this.changed();
    }
  }
  async items(limit = 50, offset = 0, search = '', projectsOnly = false) {
    const account = (await this.accounts.secrets.get<{ account: string }>('outlook:tokens'))
      ?.account;
    if (!account) return [];
    const rows = this.store.db
      .prepare(
        "SELECT json_remove(data, '$.body') AS data FROM records WHERE kind='mail_items' AND json_extract(data,'$.account')=? AND json_extract(data,'$.removed')=0 AND (?=0 OR json_extract(data,'$.routing')!='GENERAL') AND (?='' OR instr(lower(json_extract(data,'$.subject') || ' ' || json_extract(data,'$.from') || ' ' || json_extract(data,'$.body')),lower(?))>0) ORDER BY json_extract(data,'$.receivedAt') DESC LIMIT ? OFFSET ?",
      )
      .all(account, projectsOnly ? 1 : 0, search, search, limit, offset) as { data: string }[];
    return rows.map((row) => ({ ...JSON.parse(row.data), body: '' }) as MailItem);
  }
  async item(id: string) {
    const account = (await this.accounts.secrets.get<{ account: string }>('outlook:tokens'))
      ?.account;
    const item = this.store.get<MailItem>('mail_items', id);
    if (!item || item.account !== account || item.removed)
      throw new Error('Message is not available for the connected Outlook account.');
    return item;
  }
  async close() {
    await this.starting;
    this.controller?.abort();
    await this.running;
  }
}
