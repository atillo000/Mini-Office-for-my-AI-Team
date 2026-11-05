// Trusted image utility. Never imports or executes project code during inspection.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const hash = (data) => createHash('sha256').update(data).digest('hex');
const [mode, phase] = process.argv.slice(2);
const limits = JSON.parse(
  fs.readFileSync(new URL('./workspace-limits.json', import.meta.url), 'utf8'),
);
function command(program, args, cwd = '/tmp', timeout = limits.utilityTimeoutMs, accepted = [0]) {
  const step = `${program} ${args.includes('add') ? 'index source' : args.includes('commit') ? 'save baseline' : args[0] || ''}`;
  console.error(`[workspace] ${step}`);
  const r = spawnSync(program, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16000000,
    shell: false,
  });
  if (r.error?.code === 'ETIMEDOUT')
    throw new Error(
      `${step} timed out after ${timeout / 1000}s. ${mode === 'extract' ? 'Windows bind-mount indexing can be slow for large repositories. No agent has run.' : 'Workspace changes are retained; artifact verification did not complete.'}`,
    );
  if (r.error || !accepted.includes(r.status))
    throw new Error(`${step} failed: ${r.stderr || r.error || `exit ${r.status}`}`);
  return r;
}
if (mode === 'extract') {
  if (
    command('tar', [
      '-xf',
      '/source.tar',
      '--no-same-owner',
      '--no-same-permissions',
      '-C',
      '/workspace',
    ]).status !== 0
  )
    throw new Error('Extraction failed');
  // A source archive has no Git config. Keep hooks/filters and line-ending conversion disabled.
  command('git', ['-c', 'init.templateDir=', 'init', '/workspace']);
  command('git', ['-C', '/workspace', 'config', 'core.autocrlf', 'false']);
  command(
    'git',
    [
      '-C',
      '/workspace',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsync=none',
      '-c',
      'gc.auto=0',
      'add',
      '--all',
      '--force',
    ],
    '/tmp',
    limits.gitIndexTimeoutMs,
  );
  command('git', [
    '-C',
    '/workspace',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsync=none',
    '-c',
    'gc.auto=0',
    '-c',
    'user.name=Job runner',
    '-c',
    'user.email=runner@localhost',
    'commit',
    '--allow-empty',
    '-m',
    'Approved source',
  ]);
  console.log('{"ok":true}');
} else if (mode === 'capture' && ['baseline', 'after', 'tested', 'post'].includes(phase)) {
  const dest = `/artifacts/${phase}`;
  fs.mkdirSync(dest); // Refuse to overwrite saved evidence.
  const files = [];
  let total = 0;
  function walk(relative = '') {
    for (const name of fs.readdirSync(path.join('/workspace', relative)).sort()) {
      if (['.git', 'node_modules'].includes(name)) continue;
      const file = path.posix.join(relative, name);
      const source = path.join('/workspace', file);
      const info = fs.lstatSync(source);
      if (info.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${file}`);
      if (info.isDirectory()) {
        walk(file);
        continue;
      }
      if (!info.isFile()) throw new Error(`Unsupported file: ${file}`);
      if (
        /^(?:\.npmrc$|\.env(?:$|\.(?!(?:example|sample|template)$))|auth\.json$|id_rsa$|id_ed25519$|credentials$)|\.(?:pem|p12|pfx)$/i.test(
          name,
        )
      )
        throw new Error(`Sensitive file excluded; remove it from the committed source: ${file}`);
      total += info.size;
      if (
        info.size > limits.maxFileBytes ||
        total > limits.maxTotalBytes ||
        files.length >= limits.maxFiles
      )
        throw new Error(
          `Workspace exceeds inspection limits (${limits.maxFiles} files / ${limits.maxTotalBytes / 1048576} MiB total / ${limits.maxFileBytes / 1048576} MiB per file)`,
        );
      const content = fs.readFileSync(source);
      files.push({ path: file, sha256: hash(content), size: content.length });
      const target = path.join(dest, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { mode: info.mode & 0o777 });
    }
  }
  walk();
  const pkgPath = path.join(dest, 'package.json');
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {};
  const scripts = Object.fromEntries(
    Object.entries(pkg.scripts || {}).filter(([, value]) => typeof value === 'string'),
  );
  const lockPath = path.join(dest, 'package-lock.json');
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : null;
  const dependencies = Object.entries(lock?.packages || {})
    .filter(([name]) => name)
    .map(([, entry]) => entry);
  const installAllowed =
    dependencies.length > 0 &&
    dependencies.every(
      (entry) =>
        typeof entry.resolved === 'string' &&
        /^https:\/\/registry\.npmjs\.org\//.test(entry.resolved) &&
        !entry.link,
    );
  const metadata = {
    sourceDigest: hash(JSON.stringify(files)),
    files,
    scripts,
    installAllowed,
    hasDependencies: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0,
    hasNodeModules: fs.existsSync('/workspace/node_modules'),
    nodeTests: files
      .map((f) => f.path)
      .filter((p) =>
        /(?:^|\/)(?:test|tests|__tests__)\/.*\.(?:js|cjs|mjs)$|(?:\.test|\.spec)\.(?:js|cjs|mjs)$/.test(
          p,
        ),
      ),
  };
  fs.writeFileSync(`/artifacts/${phase}.json`, JSON.stringify(metadata, null, 2));
  if (phase !== 'baseline') {
    const before = JSON.parse(fs.readFileSync('/artifacts/baseline.json', 'utf8'));
    const old = new Map(before.files.map((f) => [f.path, f.sha256]));
    const current = new Map(files.map((f) => [f.path, f.sha256]));
    const changes = files
      .filter((f) => old.get(f.path) !== f.sha256)
      .map((f) => ({
        path: f.path,
        sha256: f.sha256,
        change: old.has(f.path) ? 'modified' : 'added',
      }));
    for (const [file] of old)
      if (!current.has(file)) changes.push({ path: file, change: 'deleted' });
    fs.writeFileSync(`/artifacts/${phase}-changes.json`, JSON.stringify(changes, null, 2));
    const diff = command(
      'git',
      ['diff', '--no-index', '--binary', '--no-ext-diff', '--no-textconv', '--', 'baseline', phase],
      '/artifacts',
      limits.utilityTimeoutMs,
      [0, 1],
    );
    fs.writeFileSync(
      `/artifacts/${phase}.patch`,
      diff.stdout.replaceAll('a/baseline/', 'a/').replaceAll(`b/${phase}/`, 'b/'),
    );
    if (command('tar', ['-czf', `/artifacts/${phase}.tar.gz`, '-C', dest, '.']).status !== 0)
      throw new Error('Bundle failed');
  }
  console.log(JSON.stringify(metadata));
} else throw new Error('Unknown worker operation');
