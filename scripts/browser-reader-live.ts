// Interactive live read-only check. Sign in manually; never prints message bodies or auth data.
import path from 'node:path';
import { EdgeReader } from '../server/readers/browser';
import { Store } from '../server/db';
import { JobQueue } from '../server/agents/queue';
import { ReaderService } from '../server/readers/service';
import { acquireServerLock } from '../server/lock';
import type { Job } from '../shared/types';
const release = acquireServerLock();
const store = new Store();
const queue = new JobQueue(store, () => {});
const driver = new EdgeReader(
  path.resolve((process.env.COMPANY_DB || '.data/company.sqlite') + '.browser'),
);
const readers = new ReaderService(store, driver, queue, () => {});
const close = async () => {
  await readers.shutdown();
  await queue.close();
  store.close();
  release();
};
for (const provider of ['outlook', 'teams'] as const) {
  try {
    await driver.open(provider);
    console.log(provider + ': managed Edge window opened. Sign in manually.');
  } catch (error) {
    console.log(provider + ': ' + (error as Error).message);
  }
}
console.log(
  'Ready for probe or close on stdin. Message bodies and sign-in tokens are never printed.',
);
let busy = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (line: string) => {
  if (busy) return;
  busy = true;
  try {
    if (line.trim() === 'close') {
      await close();
      process.exit(0);
    }
    if (line.trim() === 'diagnose')
      for (const provider of ['outlook', 'teams'] as const)
        console.log(JSON.stringify(await driver.diagnose(provider)));
    if (line.trim() === 'capture')
      for (const provider of ['outlook', 'teams'] as const) {
        try {
          const result = await readers.capture(
            provider,
            provider === 'outlook' ? 'LIST' : 'SELECTED',
            true,
          );
          console.log(
            JSON.stringify({
              provider,
              captureSaved: true,
              messages: result.snapshot.messageIds.length,
              jobId: result.jobId,
            }),
          );
        } catch (error) {
          console.log(provider + ': ' + (error as Error).message);
        }
      }
    if (line.trim() === 'jobs')
      console.log(
        JSON.stringify(
          store
            .list<Job>('jobs')
            .filter((j) => j.kind === 'communication-review')
            .map((j) => ({ id: j.id, state: j.state })),
        ),
      );
    if (line.trim() === 'probe')
      for (const provider of ['outlook', 'teams'] as const) {
        try {
          const result = await driver.read(provider, provider === 'outlook' ? 'LIST' : 'SELECTED');
          console.log(
            JSON.stringify({
              provider,
              renderedMessages: result.messages.length,
              scopeIdentified: !!result.scope,
              limitedCoverage: true,
            }),
          );
        } catch (error) {
          console.log(provider + ': ' + (error as Error).message);
        }
      }
  } finally {
    busy = false;
  }
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await close();
    process.exit(0);
  });
