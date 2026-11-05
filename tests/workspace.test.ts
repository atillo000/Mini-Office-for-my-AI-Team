import { describe, expect, it } from 'vitest';
import limits from '../shared/workspace-limits.json';
import { preflightSource } from '../server/agents/preflight';
import { CodexAdapter } from '../server/agents/codex';
import type { Runner } from '../server/process';
const signal = () => new AbortController().signal;
const entry = (name: string, size: number, mode = '100644') =>
  `${mode} ${mode === '160000' ? 'commit' : 'blob'} ${'a'.repeat(40)} ${mode === '160000' ? '-' : size}\t${name}\n`;
describe('workspace preparation', () => {
  it('permits the affected repository size including its media file', async () => {
    const output =
      entry('uploads/video.mp4', 24186108) +
      entry('other-assets.bin', 30 * 1048576) +
      entry('more-assets.bin', 30 * 1048576) +
      entry('remaining-assets.bin', 25 * 1048576);
    const runner: Runner = async () => ({ code: 0, output });
    const result = await preflightSource(runner, '/approved', 'a'.repeat(40), signal());
    expect(result.bytes).toBeGreaterThan(100 * 1048576);
    expect(result.files).toBe(4);
  });
  it('rejects oversized files before archiving or starting Docker', async () => {
    const calls: string[] = [];
    const runner: Runner = async (command) => {
      calls.push(command);
      return { code: 0, output: entry('too-large.mp4', limits.maxFileBytes + 1) };
    };
    await expect(preflightSource(runner, '/approved', 'a'.repeat(40), signal())).rejects.toThrow(
      'per-file limit',
    );
    expect(calls).toEqual(['git']);
  });
  it('enforces total-byte and file-count limits on streamed listings', async () => {
    const totalRunner: Runner = async (_command, _args, options) => {
      for (let i = 0; i < 9; i++)
        options?.onStdoutLine?.(entry(`asset-${i}`, limits.maxFileBytes).trimEnd());
      return { code: 0, output: '' };
    };
    await expect(
      preflightSource(totalRunner, '/approved', 'a'.repeat(40), signal()),
    ).rejects.toThrow('Committed source exceeds');
    const countRunner: Runner = async (_command, _args, options) => {
      for (let i = 0; i <= limits.maxFiles; i++)
        options?.onStdoutLine?.(entry(`file-${i}`, 1).trimEnd());
      return { code: 0, output: '' };
    };
    await expect(
      preflightSource(countRunner, '/approved', 'a'.repeat(40), signal()),
    ).rejects.toThrow('tracked files');
  });
  it('rejects unsupported symlinks and submodules early', async () => {
    for (const mode of ['120000', '160000']) {
      const runner: Runner = async () => ({ code: 0, output: entry('external', 10, mode) });
      await expect(preflightSource(runner, '/approved', 'a'.repeat(40), signal())).rejects.toThrow(
        mode === '120000' ? 'symlink' : 'submodule',
      );
    }
  });
  it('handles quoted and Unicode filenames without executing their text', async () => {
    const runner: Runner = async () => ({
      code: 0,
      output: entry('"tab\\tname $(literal).txt"', 10) + entry('résumé.txt', 20),
    });
    expect(await preflightSource(runner, '/approved', 'a'.repeat(40), signal())).toEqual({
      files: 2,
      bytes: 30,
    });
  });
  it('gives preparation a bounded larger deadline while retaining network isolation', async () => {
    const calls: { args: string[]; timeout?: number }[] = [];
    const runner: Runner = async (_command, args, options) => {
      calls.push({ args, timeout: options?.timeout });
      return { code: 0, output: '' };
    };
    const adapter = new CodexAdapter(runner);
    await adapter.container(
      'job',
      'prepare',
      '/isolated',
      ['node', '/opt/office/worker.mjs', 'extract'],
      signal(),
      () => {},
      ['--network=none'],
    );
    expect(calls[0].args).toContain(String(limits.prepareTimeoutSeconds));
    expect(calls[0].timeout).toBe((limits.prepareTimeoutSeconds + 10) * 1000);
    expect(calls[0].args).toContain('--network=none');
    expect(calls[0].args).toContain('--cap-drop=ALL');
    expect(calls[0].args).not.toContain('CODEX_API_KEY');
    expect(adapter.policy().workspaceLimits).toEqual(limits);
  });
});
