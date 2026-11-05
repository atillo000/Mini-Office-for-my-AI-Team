// Interactive verification. Probe reads attendance; capture requests an explicitly authorized real AI draft review. Never submits Zoho logs.
import path from 'node:path';
import { SproutBrowser } from '../server/shifts/browser';
import { Store } from '../server/db';
import { JobQueue } from '../server/agents/queue';
import { Accounts } from '../server/connected/accounts';
import { ZohoService } from '../server/connected/zoho';
import { ActionService } from '../server/connected/actions';
import { ShiftService } from '../server/shifts/service';
import { shiftSettings } from '../server/shifts/attendance';
import { acquireServerLock } from '../server/lock';
import type { Job } from '../shared/types';
const release = acquireServerLock();
const store = new Store();
const queue = new JobQueue(store, () => {});
const accounts = new Accounts(store);
const driver = new SproutBrowser(
  path.resolve((process.env.COMPANY_DB || '.data/company.sqlite') + '.sprout-browser'),
);
const url = 'https://tecsurge.hrhub.ph/LogIn.aspx';
const service = new ShiftService(
  store,
  queue,
  new ActionService(store, accounts, new ZohoService(store, accounts), () => {}),
  () => {},
  driver,
  false,
);
const close = async () => {
  await service.shutdown();
  await queue.close();
  store.close();
  release();
};
await driver.open(url);
console.log('Sprout reader opened. Sign in yourself and open My Biologs.');
process.stdin.setEncoding('utf8');
let busy = false;
process.stdin.on('data', async (line: string) => {
  if (busy) return;
  busy = true;
  try {
    if (line.trim() === 'close') {
      await close();
      process.exit(0);
    }
    if (line.trim() === 'probe') {
      try {
        const data = await driver.read(url);
        console.log(
          JSON.stringify({
            renderedRows: data.rowsSeen,
            punches: data.punches.length,
            clockIns: data.punches.filter((p) => p.type === 'IN').length,
            clockOuts: data.punches.filter((p) => p.type === 'OUT').length,
          }),
        );
      } catch (error) {
        console.log((error as Error).message);
      }
    }
    if (line.trim() === 'capture') {
      const settings = shiftSettings(store);
      if (!settings.enabled || !settings.shareWithAI)
        await service.configure({ ...settings, enabled: true, shareWithAI: true });
      const data = await service.check();
      console.log(
        JSON.stringify({
          savedShifts: data.shifts.length,
          reviewJobs: data.jobs.map((j) => ({ id: j.id, state: j.state })),
          noZohoSubmission: true,
        }),
      );
    }
    if (line.trim() === 'jobs')
      console.log(
        JSON.stringify(
          store
            .list<Job>('jobs')
            .filter((j) => j.kind === 'shift-review')
            .map((j) => ({ id: j.id, state: j.state, result: j.result })),
        ),
      );
  } catch (error) {
    console.log((error as Error).message);
  } finally {
    busy = false;
  }
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await close();
    process.exit(0);
  });
