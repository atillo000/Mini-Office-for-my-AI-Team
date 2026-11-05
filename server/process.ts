import { spawn, type ChildProcess } from 'node:child_process';
export function redact(text: string) {
  let value = text
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[REDACTED_JWT]')
    .replace(/(authorization["'\s]*[:=]["'\s]*Bearer\s+)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(
      /\b(?:sk-[\w-]{8,}|gh[pousr]_[\w]{12,}|github_pat_[\w]+|AKIA[A-Z0-9]{16})\b/g,
      '[REDACTED]',
    )
    .replace(
      /((?:authorization|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)["'\s]*[:=]["'\s]*)([^\s,"'}]+)/gi,
      '$1[REDACTED]',
    );
  for (const [key, secret] of Object.entries(process.env))
    if (/TOKEN|SECRET|PASSWORD|API_KEY/.test(key) && secret && secret.length > 5)
      value = value.replaceAll(secret, '[REDACTED]');
  return value;
}
export interface RunOptions {
  cwd?: string;
  timeout?: number;
  signal?: AbortSignal;
  onData?: (text: string) => void;
  onStdoutLine?: (line: string) => void;
  input?: string;
  env?: NodeJS.ProcessEnv;
}
export interface RunResult {
  code: number;
  output: string;
}
export type Runner = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;
export const run: Runner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    let child: ChildProcess;
    let output = '';
    const pending = new Map<string, string>();
    let bytes = 0;
    let finished = false;
    let timedOut = false;
    const finish = (error?: Error, code = 1) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      try {
        for (const [stream, remaining] of pending.entries())
          if (remaining) {
            const safe = redact(remaining);
            output = (output + safe).slice(-1000000);
            options.onData?.(safe);
            if (stream === 'stdout') options.onStdoutLine?.(safe);
          }
      } catch (callbackError) {
        reject(callbackError);
        return;
      }
      if (error) reject(error);
      else resolve({ code, output });
    };
    const kill = () => {
      if (child?.pid) {
        if (process.platform === 'win32')
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
          });
        else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      }
    };
    const abort = () => {
      kill();
      finish(new Error('Execution cancelled'));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
      finish(new Error('Process exceeded its time limit'));
    }, options.timeout || 600000);
    if (options.signal?.aborted) {
      finish(new Error('Execution cancelled'));
      return;
    }
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: options.env || process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      finish(e as Error);
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    const data = (stream: string, chunk: Buffer) => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) {
        kill();
        finish(new Error('Output exceeded 4 MB limit'));
        return;
      }
      const lines = ((pending.get(stream) || '') + chunk.toString()).split('\n');
      pending.set(stream, lines.pop() || '');
      if (lines.length) {
        const safe = redact(lines.join('\n') + '\n');
        output = (output + safe).slice(-1000000);
        try {
          options.onData?.(safe);
          if (stream === 'stdout')
            for (const line of safe.trimEnd().split('\n')) options.onStdoutLine?.(line);
        } catch (error) {
          kill();
          finish(error as Error);
        }
      }
    };
    child.stdout!.on('data', (chunk: Buffer) => data('stdout', chunk));
    child.stderr!.on('data', (chunk: Buffer) => data('stderr', chunk));
    child.on('error', (e) => finish(e));
    child.on('close', (code) => {
      if (!timedOut) finish(undefined, code ?? 1);
    });
    child.stdin!.on('error', () => {});
    if (options.input) child.stdin!.write(options.input);
    child.stdin!.end();
  });
