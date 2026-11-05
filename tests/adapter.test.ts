import { describe, it, expect } from 'vitest';
import { CodexAdapter } from '../server/agents/codex';
import { CodexStream } from '../server/agents/protocol';
import { testCount } from '../server/agents/artifacts';
import type { Runner } from '../server/process';
const events = [
  JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
  JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'Inspected source.' },
  }),
  JSON.stringify({ type: 'turn.completed' }),
].join('\n');
describe('isolated Codex adapter', () => {
  it('passes prompts over stdin and enforces resource and mount boundaries', async () => {
    const calls: { command: string; args: string[]; input?: string }[] = [];
    const runner: Runner = async (command, args, options) => {
      calls.push({ command, args, input: options?.input });
      return { code: 0, output: events };
    };
    const adapter = new CodexAdapter(runner);
    const prompt = 'Review $(do-not-execute) and `literal text`';
    const result = await adapter.execute(
      '/isolated/project',
      prompt,
      new AbortController().signal,
      () => {},
      'test-job',
      true,
    );
    expect(result).toMatchObject({
      text: 'Inspected source.',
      completed: true,
      threadId: 'thread-1',
    });
    const call = calls[0];
    expect(call.command).toBe('docker');
    expect(call.input).toBe(prompt);
    expect(call.args).not.toContain(prompt);
    for (const flag of [
      '--interactive',
      '--memory=1g',
      '--pids-limit=128',
      '--cap-drop=ALL',
      '--ignore-user-config',
      '--ignore-rules',
      'type=bind,source=/isolated/project,target=/workspace,readonly',
      'permissions.office.extends=":read-only"',
    ])
      expect(call.args).toContain(flag);
    expect(call.args).not.toContain('--privileged');
    expect(call.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });
  it('rejects confident prose without a successful CLI turn', async () => {
    const runner: Runner = async () => ({
      code: 0,
      output: JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'All done! Tests passed!' },
      }),
    });
    await expect(
      new CodexAdapter(runner).execute(
        '/isolated',
        'test',
        new AbortController().signal,
        () => {},
        'test',
      ),
    ).rejects.toThrow('verifiable completed turn');
  });
  it('rejects failed events and a nonzero exit even with a final message', () => {
    const stream = new CodexStream();
    events.split('\n').forEach((e) => stream.consume(e));
    expect(() => stream.result(1, Date.now())).toThrow('exited');
    stream.consume(JSON.stringify({ type: 'turn.failed', error: { message: 'quota exceeded' } }));
    expect(() => stream.result(0, Date.now())).toThrow('quota exceeded');
  });
  it('runs approved tests without credentials, host env, or network', async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_command, args) => {
      calls.push(args);
      return { code: 0, output: '# tests 1' };
    };
    await new CodexAdapter(runner).tests(
      { id: 'test', workspace: '/isolated' } as never,
      { program: 'node', args: ['--test'], label: 'node --test', needsInstall: false } as never,
      new AbortController().signal,
      () => {},
      false,
    );
    expect(calls[0]).toContain('--network=none');
    expect(calls[0]).not.toContain('CODEX_API_KEY');
    expect(calls[0].join(' ')).not.toContain('/home/node/.codex');
  });
  it('blocks dependency installation without explicit CEO consent', async () => {
    const runner: Runner = async () => {
      throw new Error('must not execute');
    };
    await expect(
      new CodexAdapter(runner).tests(
        { id: 'test' } as never,
        { args: ['test'], needsInstall: true, installAllowed: true } as never,
        new AbortController().signal,
        () => {},
        false,
      ),
    ).rejects.toThrow('CEO approval');
  });
  it('counts supported test runner summaries, never generic success prose', () => {
    expect(testCount('# tests 2\n# pass 2')).toBe(2);
    expect(testCount('Tests  3 passed (3)')).toBe(3);
    expect(testCount('Tests: 2 passed, 2 total')).toBe(2);
    expect(testCount('Everything passed!')).toBe(0);
    expect(testCount('# tests 2\n# pass 0\n# skipped 2')).toBe(0);
    expect(testCount('Tests  2 skipped (2)')).toBe(0);
    expect(testCount('Tests: 2 skipped, 2 total')).toBe(0);
  });
});
