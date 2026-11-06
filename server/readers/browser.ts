import path from 'node:path';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page, type Locator } from 'playwright';
import type {
  CaptureMode,
  ReaderProvider,
  RenderedView,
  RenderedMessage,
  ReaderTarget,
} from '../../shared/reader';
export const readerUrls = {
  outlook: 'https://outlook.office.com/mail/',
  teams: 'https://teams.microsoft.com/v2/',
};
export const readerHosts = {
  outlook: [
    'outlook.office.com',
    'outlook.office365.com',
    'outlook.live.com',
    'outlook.cloud.microsoft',
  ],
  teams: ['teams.microsoft.com', 'teams.cloud.microsoft'],
};
export function allowedReaderUrl(provider: ReaderProvider, value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      readerHosts[provider].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export class ReaderError extends Error {
  constructor(
    public state: 'NEEDS_SIGN_IN' | 'NEEDS_SELECTION' | 'ERROR',
    message: string,
  ) {
    super(message);
  }
}
export interface ReaderDriver {
  open(provider: ReaderProvider, options?: { background?: boolean }): Promise<void>;
  targets?(provider: ReaderProvider, numbers: string[]): Promise<ReaderTarget[]>;
  select?(provider: ReaderProvider, id: string): Promise<void>;
  read(provider: ReaderProvider, mode: CaptureMode): Promise<RenderedView>;
  epoch(provider: ReaderProvider): number;
  close(provider: ReaderProvider): Promise<void>;
}
// Deterministic DOM reader. No cookies, tokens, browser storage, provider APIs or send controls are read.
export class EdgeReader implements ReaderDriver {
  private chatOffset = 0;
  private openGeneration = new Map<ReaderProvider, number>();
  private navigation = new Map<
    string,
    { provider: ReaderProvider; label: string; locator?: Locator; search?: string; home?: boolean }
  >();
  private sessions = new Map<
    ReaderProvider,
    { context: BrowserContext; page: Page; epoch: number }
  >();
  constructor(private root: string) {}
  async open(provider: ReaderProvider, options: { background?: boolean } = {}) {
    const existing = this.sessions.get(provider);
    if (existing && !existing.page.isClosed()) {
      if (!options.background) await existing.page.bringToFront();
      return;
    }
    if (existing) await this.close(provider);
    const generation = (this.openGeneration.get(provider) || 0) + 1;
    this.openGeneration.set(provider, generation);
    const directory = path.join(this.root, provider);
    await mkdir(directory, { recursive: true });
    const context = await chromium.launchPersistentContext(directory, {
      channel: 'msedge',
      headless: false,
      acceptDownloads: false,
      viewport: null,
      args: ['--no-first-run', '--restore-last-session'],
    });
    if (this.openGeneration.get(provider) !== generation) {
      await context.close();
      throw new ReaderError(
        'NEEDS_SELECTION',
        'The reader was closed while its browser was starting.',
      );
    }
    context.setDefaultTimeout(5000);
    const page =
      context.pages().find((p) => allowedReaderUrl(provider, p.url())) ||
      context.pages()[0] ||
      (await context.newPage());
    const session = { context, page, epoch: 0 };
    this.sessions.set(provider, session);
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) session.epoch++;
    });
    context.on('close', () => {
      if (this.sessions.get(provider) === session) this.sessions.delete(provider);
    });
    if (!allowedReaderUrl(provider, page.url()))
      await page.goto(readerUrls[provider], { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!options.background) await page.bringToFront();
  }
  async targets(provider: ReaderProvider, numbers: string[]): Promise<ReaderTarget[]> {
    const page = this.sessions.get(provider)?.page;
    if (!page || !allowedReaderUrl(provider, page.url()))
      throw new ReaderError('NEEDS_SIGN_IN', 'Complete Microsoft sign-in in the dedicated reader.');
    for (const [id, target] of this.navigation)
      if (target.provider === provider) this.navigation.delete(id);
    const result: ReaderTarget[] = [];
    const add = (target: { label: string; locator?: Locator; search?: string; home?: boolean }) => {
      const id = crypto.randomUUID();
      this.navigation.set(id, { provider, ...target });
      result.push({ id, label: target.label });
    };
    if (provider === 'outlook') {
      add({ label: 'Outlook inbox previews', home: true });
      for (const number of numbers.slice(0, 7))
        add({ label: 'Outlook project ' + number, search: number });
      return result;
    }
    // Only provider navigation elements are eligible, never links/buttons inside message text.
    const sidebar = page.locator('[role="tree"] [role="treeitem"].fui-TreeItem').first();
    await sidebar.waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
    const back = page.getByRole('button', { name: 'Return to list', exact: true });
    if (
      (await back.count()) === 1 &&
      (await back
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left >= 0 &&
            r.right <= innerWidth &&
            r.top >= 0 &&
            r.bottom <= innerHeight &&
            !el.closest('[data-message-id],[data-tid="chat-pane-message"],[role="textbox"]')
          );
        })
        .catch(() => false))
    )
      await back.click({ timeout: 15000 });
    await page.waitForTimeout(1000);
    if (!(await sidebar.isVisible().catch(() => false)))
      for (const selector of [
        '[role="navigation"] button[aria-label="Chat"]',
        '[data-tid="app-bar"] [aria-label="Chat"]',
        'button[data-tid="chat-app-button"]',
      ]) {
        const nav = page.locator(selector).first();
        if (await nav.isVisible().catch(() => false)) {
          if ((await nav.getAttribute('aria-pressed')) !== 'true')
            await nav.click({ timeout: 15000 });
          break;
        }
      }
    await page.waitForTimeout(1500);
    const selectors = [
      '[role="tree"] [role="treeitem"].fui-TreeItem:not(:has([role="treeitem"]))',
      '[data-tid="chat-list-item"]',
      '[data-tid="chat-list-item-wrapper"]',
      '[data-tid="chat-list"] [role="treeitem"]',
      '[data-tid="chat-list-container"] [role="treeitem"]',
      '[aria-label="Chats"] [role="treeitem"]',
      '[aria-label="Chat list"] [role="treeitem"]',
    ];
    let rows: Locator[] = [];
    for (const selector of selectors) {
      const found = await page.locator(selector).all();
      const visible: Locator[] = [];
      for (const row of found.slice(0, 40)) if (await row.isVisible()) visible.push(row);
      if (visible.length) {
        rows = visible;
        break;
      }
    }
    const items = [];
    for (const locator of rows) {
      try {
        const label = (
          (
            (await locator.getAttribute('aria-label', { timeout: 1500 })) ||
            (await locator.innerText({ timeout: 1500 }))
          )
            .trim()
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line && !/^(Unread|Muted|Pinned)$/i.test(line)) || ''
        ).slice(0, 300);
        if (
          label &&
          !/^(Copilot|Mentions|Drafts|Saved|Favorites|Chats|Channels|Teams and channels|See all teams)$/i.test(
            label,
          )
        )
          items.push({ locator, label });
      } catch {
        /* A live sidebar can replace a row while the navigation list loads. */
      }
    }
    items.sort(
      (a, b) =>
        Number(numbers.some((n) => b.label.includes(n))) -
        Number(numbers.some((n) => a.label.includes(n))),
    );
    const priority = items.filter((item) => numbers.some((n) => item.label.includes(n)));
    const others = items.filter((item) => !priority.includes(item));
    const start = others.length ? this.chatOffset % others.length : 0;
    for (const item of [...priority, ...others.slice(start), ...others.slice(0, start)].slice(0, 8))
      add(item);
    this.chatOffset += Math.max(1, 8 - priority.length);
    if (!result.length) {
      const view = await extractRenderedView(page, 'teams', 'SELECTED');
      if (view.scope && view.messages.length) add({ label: view.scope });
    }
    if (!result.length)
      throw new ReaderError(
        'NEEDS_SELECTION',
        'Teams chat navigation has not loaded or could not be identified. The team will retry; no all-chat review is claimed.',
      );
    return result;
  }
  async select(provider: ReaderProvider, id: string) {
    const target = this.navigation.get(id),
      page = this.sessions.get(provider)?.page;
    if (!target || target.provider !== provider || !page || !allowedReaderUrl(provider, page.url()))
      throw new ReaderError('NEEDS_SIGN_IN', 'The reader target or Microsoft session changed.');
    if (provider === 'outlook') {
      if (target.home) {
        const inbox = page.getByRole('treeitem', { name: /Inbox/i }).first();
        await inbox.waitFor({ state: 'visible', timeout: 20000 });
        await inbox.click({ timeout: 15000 });
        await page
          .getByRole('heading', { name: 'Results', exact: true })
          .waitFor({ state: 'hidden', timeout: 15000 });
      } else if (target.search) {
        let search: Locator | undefined;
        for (const selector of [
          'input#topSearchInput',
          'input[role="searchbox"]',
          'input[aria-label="Search"]',
          'input[placeholder="Search"]',
          '[role="search"] input',
        ]) {
          const input = page.locator(selector).first();
          if (await input.isVisible().catch(() => false)) {
            search = input;
            break;
          }
        }
        if (!search)
          throw new ReaderError(
            'NEEDS_SELECTION',
            'Outlook search is not available yet. The team will retry the approved project search.',
          );
        await search.fill(target.search);
        await search.press('Enter');
        await page
          .getByRole('heading', { name: 'Results', exact: true })
          .waitFor({ state: 'visible', timeout: 15000 });
      }
    } else if (target.locator) await target.locator.click({ timeout: 12000 });
    await page.waitForTimeout(1200);
    if (!allowedReaderUrl(provider, page.url()))
      throw new ReaderError(
        'NEEDS_SIGN_IN',
        'Microsoft needs sign-in or consent before the team can continue.',
      );
    let first = await extractRenderedView(
      page,
      provider,
      provider === 'outlook' ? 'LIST' : 'SELECTED',
    );
    let second = first,
      stable = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.waitForTimeout(500);
      second = await extractRenderedView(
        page,
        provider,
        provider === 'outlook' ? 'LIST' : 'SELECTED',
      );
      if (second.login) break;
      if (
        second.messages.length &&
        first.scope === second.scope &&
        JSON.stringify(first.messages) === JSON.stringify(second.messages)
      ) {
        stable = true;
        break;
      }
      first = second;
    }
    if (first.login || second.login)
      throw new ReaderError('NEEDS_SIGN_IN', 'Complete the Microsoft sign-in prompt yourself.');
    if (!stable)
      throw new ReaderError(
        'NEEDS_SELECTION',
        'The message view is still loading. It will be checked on the next cycle.',
      );
    if (provider === 'teams' && target.locator) {
      const norm = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!second.scope || !norm(target.label).includes(norm(second.scope)))
        throw new ReaderError(
          'NEEDS_SELECTION',
          'Teams has not confirmed the selected conversation heading. No messages were attributed to this target.',
        );
    }
  }
  epoch(provider: ReaderProvider) {
    return this.sessions.get(provider)?.epoch ?? -1;
  }
  async read(provider: ReaderProvider, mode: CaptureMode): Promise<RenderedView> {
    const session = this.sessions.get(provider);
    if (!session || session.page.isClosed())
      throw new ReaderError(
        'NEEDS_SELECTION',
        'Open the managed browser, sign in and select the message or chat first.',
      );
    const page = session.page,
      sourceUrl = page.url();
    if (!allowedReaderUrl(provider, sourceUrl))
      throw new ReaderError(
        'NEEDS_SIGN_IN',
        'Complete sign-in in the managed browser. Login pages are never captured.',
      );
    const result = await extractRenderedView(page, provider, mode);
    if (page.url() !== sourceUrl || !allowedReaderUrl(provider, page.url()))
      throw new ReaderError(
        'NEEDS_SELECTION',
        'The browser changed views during capture. Select the view again.',
      );
    if (result.login)
      throw new ReaderError(
        'NEEDS_SIGN_IN',
        'Complete the provider sign-in or access prompt. No login form was captured.',
      );
    if (!result.scope || !result.messages.length)
      throw new ReaderError(
        'NEEDS_SELECTION',
        'No readable message panel was identified. Open a mail message or a Teams chat; no inbox-wide result is claimed.',
      );
    return {
      sourceUrl,
      scope: result.scope,
      mode,
      messages: result.messages,
      truncated: result.truncated,
    };
  }
  async close(provider: ReaderProvider) {
    this.openGeneration.set(provider, (this.openGeneration.get(provider) || 0) + 1);
    const session = this.sessions.get(provider);
    this.sessions.delete(provider);
    await session?.context.close();
  }
}
export async function extractRenderedView(page: Page, provider: ReaderProvider, mode: CaptureMode) {
  const domSource = readFileSync(new URL('./dom-extractor.mjs', import.meta.url), 'utf8').replace(
    'export const capture',
    'const capture',
  );
  return page.evaluate(
    '(() => {' + domSource + '; return capture(' + JSON.stringify({ provider, mode }) + '); })()',
  ) as Promise<{ login: boolean; scope: string; messages: RenderedMessage[]; truncated: boolean }>;
}
