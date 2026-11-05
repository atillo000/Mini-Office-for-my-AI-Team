import limits from '../../shared/workspace-limits.json';
import type { Runner } from '../process';
export function validateSourceEntry(size: number, name: string, count: number, total: number) {
  if (count > limits.maxFiles)
    throw new Error(
      `Repository contains more than ${limits.maxFiles.toLocaleString()} tracked files. Use a smaller dedicated source repository.`,
    );
  if (size > limits.maxFileBytes)
    throw new Error(
      `Tracked file ${JSON.stringify(name)} is ${(size / 1048576).toFixed(1)} MiB; the per-file limit is ${limits.maxFileBytes / 1048576} MiB. Move large media out of the coding source before committing.`,
    );
  if (total > limits.maxTotalBytes)
    throw new Error(
      `Committed source exceeds ${limits.maxTotalBytes / 1048576} MiB. Use a smaller dedicated source repository.`,
    );
}
export async function preflightSource(
  runner: Runner,
  source: string,
  commit: string,
  signal: AbortSignal,
) {
  let count = 0,
    bytes = 0;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const entry = /^(\d+)\s+(blob|commit)\s+[a-f0-9]+\s+(\d+|-)\t(.+)$/.exec(line);
    if (!entry) throw new Error('Cannot validate the committed source tree.');
    let name = entry[4];
    if (name.startsWith('"')) {
      try {
        name = JSON.parse(name);
      } catch {
        /* Keep Git's quoted spelling for diagnostics. */
      }
    }
    if (entry[1] === '160000' || entry[2] === 'commit')
      throw new Error(
        `Git submodule ${JSON.stringify(name)} is not supported in isolated source exports.`,
      );
    if (entry[1] === '120000')
      throw new Error(
        `Tracked symlink ${JSON.stringify(name)} is not supported in isolated source exports.`,
      );
    const size = Number(entry[3]);
    count++;
    bytes += size;
    validateSourceEntry(size, name, count, bytes);
  };
  const result = await runner(
    'git',
    [
      '-C',
      source,
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.quotePath=false',
      'ls-tree',
      '-r',
      '--long',
      commit,
    ],
    { signal, timeout: 20000, onStdoutLine: consume },
  );
  if (result.code !== 0) throw new Error('Cannot inspect the approved source commit.');
  // Injected test runners can return complete output instead of streaming it.
  if (!count && result.output.trim()) result.output.trimEnd().split('\n').forEach(consume);
  return { files: count, bytes };
}
