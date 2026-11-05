import { createApp } from './app';
import { acquireServerLock } from './lock';
const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.CEO_TOKEN)
  throw new Error('CEO_TOKEN is required when binding to a remote interface');
const releaseLock = acquireServerLock();
process.on('exit', releaseLock);
const app = await createApp(undefined, { skipExternal: process.env.OFFICE_OFFLINE === '1' });
await app.listen({
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '127.0.0.1',
});
console.log(
  `Mini AI Office API ready at http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3001}`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
