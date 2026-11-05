import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { backendTarget, waitForBackend } from '../scripts/dev-support';

describe('Development startup readiness', () => {
  it('uses the configured backend port and normalizes bind-only hosts for the proxy', () => {
    expect(backendTarget({})).toBe('http://127.0.0.1:3001');
    expect(backendTarget({ PORT: '4100', HOST: '0.0.0.0' })).toBe('http://127.0.0.1:4100');
    expect(backendTarget({ PORT: '4100', HOST: '::1' })).toBe('http://[::1]:4100');
    expect(backendTarget({ API_URL: 'https://example.invalid/office/', PORT: '4100' })).toBe(
      'https://example.invalid/office',
    );
    expect(() => backendTarget({ API_URL: 'https://user:secret@example.invalid/' })).toThrow(
      'credentials',
    );
  });
  it('waits through an unavailable API and rejects an unrelated successful HTTP page', async () => {
    let attempts = 0;
    const server = createServer((_request, response) => {
      attempts++;
      if (attempts === 1) {
        response.writeHead(503).end();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(attempts === 2 ? { ok: true } : { ok: true, authRequired: false }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await waitForBackend('http://127.0.0.1:' + (server.address() as AddressInfo).port, {
        pollMs: 5,
        timeoutMs: 2000,
      });
      expect(attempts).toBe(3);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('reports readiness failure and supports cancellation without starting the UI', async () => {
    const server = createServer((_request, response) => response.writeHead(503).end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const target = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    try {
      await expect(waitForBackend(target, { pollMs: 5, timeoutMs: 30 })).rejects.toThrow(
        'dev:server',
      );
      const controller = new AbortController();
      controller.abort();
      await expect(waitForBackend(target, { signal: controller.signal })).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
