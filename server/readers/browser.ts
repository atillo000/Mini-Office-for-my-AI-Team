import path from 'node:path';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type {
  CaptureMode,
  ReaderProvider,
  RenderedView,
  RenderedMessage,
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
  open(provider: ReaderProvider): Promise<void>;
  read(provider: ReaderProvider, mode: CaptureMode): Promise<RenderedView>;
  epoch(provider: ReaderProvider): number;
  close(provider: ReaderProvider): Promise<void>;
}
// Deterministic DOM reader. No cookies, tokens, browser storage, provider APIs or send controls are read.
export class EdgeReader implements ReaderDriver {
  private sessions = new Map<
    ReaderProvider,
    { context: BrowserContext; page: Page; epoch: number }
  >();
  constructor(private root: string) {}
  async open(provider: ReaderProvider) {
    const existing = this.sessions.get(provider);
    if (existing && !existing.page.isClosed()) {
      await existing.page.bringToFront();
      return;
    }
    if (existing) await this.close(provider);
    const directory = path.join(this.root, provider);
    await mkdir(directory, { recursive: true });
    const context = await chromium.launchPersistentContext(directory, {
      channel: 'msedge',
      headless: false,
      acceptDownloads: false,
      viewport: null,
      args: ['--no-first-run', '--restore-last-session'],
    });
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
    await page.bringToFront();
  }
  epoch(provider: ReaderProvider) {
    return this.sessions.get(provider)?.epoch ?? -1;
  }
  async diagnose(provider: ReaderProvider) {
    const page = this.sessions.get(provider)?.page;
    if (!page || !allowedReaderUrl(provider, page.url())) return { provider, signedInView: false };
    const structure = await page.evaluate(
      "({ tids: [...new Set([...document.querySelectorAll('[data-tid]')].map(e=>e.getAttribute('data-tid')).filter(v=>/message|chat|header|conversation|pane/i.test(v)))].slice(0,100), headingRoles: document.querySelectorAll('[role=heading]').length, messageIds: document.querySelectorAll('[data-message-id]').length })",
    );
    return { provider, signedInView: true, structure };
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
