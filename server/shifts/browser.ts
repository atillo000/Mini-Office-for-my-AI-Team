import { chromium, type BrowserContext, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { AttendancePunch } from '../../shared/shifts';
import { validSproutUrl } from './attendance';
export interface SproutDriver {
  open(url: string): Promise<void>;
  read(url: string): Promise<{ punches: AttendancePunch[]; sourceUrl: string; rowsSeen: number }>;
  close(): Promise<void>;
}
export function sameSproutTenant(configured: string, current: string) {
  try {
    const base = new URL(configured),
      url = new URL(current);
    return (
      validSproutUrl(base.toString()) &&
      url.protocol === 'https:' &&
      [base.hostname.split('.')[0], base.hostname.split('.')[0] + '-v2'].includes(
        url.hostname.split('.')[0],
      ) &&
      (url.hostname.endsWith('.hrhub.ph') || url.hostname.endsWith('.sprout.ph'))
    );
  } catch {
    return false;
  }
}
export function sproutDate(value: string, time = '') {
  const text = (value + ' ' + time).trim();
  const match =
    /^(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(
      text,
    );
  if (!match)
    throw new Error(
      'Sprout date/time format is not recognized. Open My Biologs with complete dates and times.',
    );
  const year = match[1] || match[6],
    month = match[2] || match[4].padStart(2, '0'),
    day = match[3] || match[5].padStart(2, '0');
  let hour = Number(match[7]);
  if (match[10]) {
    if (hour < 1 || hour > 12) throw new Error('Invalid attendance hour.');
    hour = (hour % 12) + (match[10].toUpperCase() === 'PM' ? 12 : 0);
  }
  if (hour > 23 || Number(match[8]) > 59 || Number(match[9] || 0) > 59)
    throw new Error('Invalid attendance time.');
  const date = year + '-' + month + '-' + day;
  const at = Date.parse(
    date +
      'T' +
      String(hour).padStart(2, '0') +
      ':' +
      match[8] +
      ':' +
      (match[9] || '00') +
      '+08:00',
  );
  if (!Number.isFinite(at) || new Date(at + 8 * 3600000).toISOString().slice(0, 10) !== date)
    throw new Error('Invalid attendance date.');
  return at;
}
export function parseSproutRows(rows: Record<string, string>[]): AttendancePunch[] {
  const punches: AttendancePunch[] = [];
  for (const row of rows) {
    const normalized = Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[^a-z]/g, ''), v.trim()]),
    );
    const date = normalized.date || normalized.logdate || normalized.attendancedate;
    const type = normalized.type || normalized.logtype || normalized.inout || normalized.tagging;
    const time = normalized.time || normalized.logtime;
    if (date && type && time) {
      if (!/^(?:clock\s*)?(?:in|out)$/i.test(type))
        throw new Error('Unknown Sprout punch type. No shift inferred.');
      punches.push({
        at: sproutDate(date, time),
        type: /out$/i.test(type) ? 'OUT' : 'IN',
        source: 'Sprout My Biologs',
      });
    } else if (date && (normalized.timein || normalized.clockin)) {
      const clockIn = normalized.timein || normalized.clockin,
        clockOut = normalized.timeout || normalized.clockout;
      punches.push({ at: sproutDate(date, clockIn), type: 'IN', source: 'Sprout My Biologs' });
      if (clockOut && clockOut !== '-')
        punches.push({ at: sproutDate(date, clockOut), type: 'OUT', source: 'Sprout My Biologs' });
    }
  }
  if (!punches.length)
    throw new Error(
      'No structured Sprout punches found. Open your My Biologs table; a page title or clock icon is not attendance evidence.',
    );
  return punches;
}
export class SproutBrowser implements SproutDriver {
  private context?: BrowserContext;
  private page?: Page;
  constructor(private root: string) {}
  async open(url: string) {
    if (!validSproutUrl(url)) throw new Error('Invalid Sprout URL.');
    if (this.page && !this.page.isClosed()) {
      await this.page.bringToFront();
      return;
    }
    await this.close();
    await mkdir(this.root, { recursive: true });
    this.context = await chromium.launchPersistentContext(this.root, {
      channel: 'msedge',
      headless: false,
      acceptDownloads: false,
      viewport: null,
      args: ['--no-first-run', '--restore-last-session'],
    });
    this.page =
      this.context.pages().find((p) => {
        try {
          return sameSproutTenant(url, p.url());
        } catch {
          return false;
        }
      }) ||
      this.context.pages()[0] ||
      (await this.context.newPage());
    if (!sameSproutTenant(url, this.page.url()))
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.bringToFront();
  }
  async read(url: string) {
    const pages = this.context?.pages() || [];
    const page =
      pages.find(
        (p) =>
          sameSproutTenant(url, p.url()) &&
          /mybiologs|myattendance/i.test(new URL(p.url()).pathname),
      ) ||
      [...pages].reverse().find((p) => sameSproutTenant(url, p.url())) ||
      this.page;
    if (!page || page.isClosed())
      throw new Error('Open the Sprout browser, sign in and select My Biologs.');
    const sourceUrl = page.url();
    if (!sameSproutTenant(url, sourceUrl))
      throw new Error(
        'Complete Sprout sign-in in the managed window. Current host: ' +
          new URL(sourceUrl).hostname,
      );
    const script = readFileSync(new URL('./sprout-dom.mjs', import.meta.url), 'utf8').replace(
      'export const readAttendance',
      'const readAttendance',
    );
    const extract = () =>
      page.evaluate('(() => {' + script + '; return readAttendance();})()') as Promise<{
        login: boolean;
        selfView: boolean;
        rows: Record<string, string>[];
      }>;
    let data = await extract();
    if (data.selfView && !data.login) {
      const dates = page.locator('input[placeholder="MM/DD/YYYY"]:visible');
      const search = page.locator('button:visible').filter({ hasText: 'Search' });
      if (
        (await dates.count()) === 2 &&
        (await search.count()) === 1 &&
        (await search.isVisible())
      ) {
        const format = (at: number) =>
          new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Manila',
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
          }).format(at);
        try {
          for (const [index, value] of [
            format(Date.now() - 2 * 86400000),
            format(Date.now()),
          ].entries()) {
            await dates.nth(index).click();
            await dates.nth(index).press('ControlOrMeta+A');
            await dates.nth(index).pressSequentially(value);
            await dates.nth(index).press('Enter');
            await dates.nth(index).press('Tab');
            if ((await dates.nth(index).inputValue()) !== value)
              throw new Error('Date selection was not accepted.');
          }
        } catch {
          throw new Error(
            'Set a recent date range in Sprout manually; its date control could not be updated.',
          );
        }
        await search.click();
        await page.waitForTimeout(1200);
        const expand = page.locator('button:visible').filter({ hasText: 'Expand All' });
        if ((await expand.count()) === 1 && (await expand.isVisible())) await expand.click();
        await page.waitForTimeout(300);
        data = await extract();
      }
    }
    if (data.login || !data.selfView || page.url() !== sourceUrl)
      throw new Error('Open your own My Biologs attendance table after signing in.');
    const safe = new URL(sourceUrl);
    safe.search = '';
    safe.hash = '';
    return {
      punches: parseSproutRows(data.rows),
      sourceUrl: safe.toString(),
      rowsSeen: data.rows.length,
    };
  }
  async close() {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
  }
}
