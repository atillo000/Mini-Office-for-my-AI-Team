import { setTimeout as delay } from 'node:timers/promises';

export function backendTarget(env: Record<string, string | undefined>) {
  const host = env.HOST === '0.0.0.0' || env.HOST === '::' ? '127.0.0.1' : env.HOST || '127.0.0.1';
  const authority = host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host;
  const url = new URL(env.API_URL || 'http://' + authority + ':' + (env.PORT || '3001'));
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'API_URL must be an HTTP(S) backend address without credentials, query or fragment.',
    );
  return url.toString().replace(/\/$/, '');
}

export async function waitForBackend(
  target: string,
  options: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal } = {},
) {
  const deadline = performance.now() + (options.timeoutMs ?? 60000);
  while (performance.now() < deadline) {
    options.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(
      Math.max(1, Math.min(1500, Math.ceil(deadline - performance.now()))),
    );
    try {
      const response = await fetch(target + '/api/health', {
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        redirect: 'error',
      });
      if (response.ok) {
        const health = await response.json();
        if (health.ok === true && typeof health.authRequired === 'boolean') return;
      } else await response.body?.cancel();
    } catch {
      options.signal?.throwIfAborted();
    }
    const remaining = deadline - performance.now();
    if (remaining > 0)
      await delay(Math.min(options.pollMs ?? 250, remaining), undefined, {
        signal: options.signal,
      });
  }
  throw new Error(
    'API did not become ready at ' +
      target +
      '. Check the [API] output, or run npm run dev:server separately to see its error.',
  );
}
