import type { ViteDevServer } from 'vite';
import { backendTarget, waitForBackend } from './dev-support';

const controller = new AbortController();
let server: ViteDevServer | undefined;
const shutdown = async () => {
  controller.abort();
  await server?.close();
};
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });

try {
  const target = backendTarget(process.env);
  console.log('Waiting for API at ' + target + '...');
  await waitForBackend(target, { signal: controller.signal });
  process.env.API_URL = target;
  const { createServer } = await import('vite');
  controller.signal.throwIfAborted();
  const port = process.env.DEV_UI_PORT ? Number(process.env.DEV_UI_PORT) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error('DEV_UI_PORT must be a port between 1 and 65535.');
  server = await createServer({
    server: { host: '127.0.0.1', ...(port ? { port, strictPort: true } : {}) },
  });
  await server.listen();
  console.log('API ready. Starting office UI.');
  server.printUrls();
} catch (error) {
  if (!controller.signal.aborted) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
  await server?.close();
}
