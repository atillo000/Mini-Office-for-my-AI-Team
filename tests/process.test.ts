import { describe, it, expect } from 'vitest';
import { run } from '../server/process';
describe('bounded process output', () => {
  it('redacts a secret even when process output splits across chunks', async () => {
    const logs: string[] = [];
    const result = await run(
      process.execPath,
      [
        '-e',
        'process.stdout.write("api_key=super-");setTimeout(()=>process.stdout.write("secret-value\\n"),25);',
      ],
      { timeout: 5000, onData: (text) => logs.push(text) },
    );
    expect(result.code).toBe(0);
    expect(result.output).toContain('[REDACTED]');
    expect(result.output).not.toContain('super-secret-value');
    expect(logs.join('')).not.toContain('super-secret-value');
  });
  it('passes shell metacharacters literally instead of executing them', async () => {
    const literal = '$(echo secret) & echo should-not-run';
    const result = await run(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1])', literal],
      { timeout: 5000 },
    );
    expect(result.output).toBe(literal);
  });
  it('rejects cleanly if durable log capture fails', async () => {
    await expect(
      run(process.execPath, ['-e', 'console.log("output");setTimeout(()=>{},5000)'], {
        timeout: 7000,
        onData: () => {
          throw new Error('Artifact disk is unavailable');
        },
      }),
    ).rejects.toThrow('Artifact disk is unavailable');
  });
});
