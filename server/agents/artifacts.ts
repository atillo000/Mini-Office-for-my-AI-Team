import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import type { Job, JobEvidence, Project, TestEvidence, TestPlan } from '../../shared/types';
import { redact } from '../process';
export const digest = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
export interface Manifest {
  sourceDigest: string;
  files: { path: string; sha256: string; size: number }[];
  scripts: Record<string, string>;
  installAllowed: boolean;
  hasDependencies: boolean;
  hasNodeModules: boolean;
  nodeTests: string[];
}
export class Artifacts {
  constructor(public root = path.resolve('.data/jobs')) {}
  directory(job: Job) {
    if (!/^[\w-]{1,100}$/.test(job.id) || !Number.isInteger(job.attempts) || job.attempts < 1)
      throw new Error('Invalid job artifact identity');
    return path.join(this.root, job.id, `attempt-${job.attempts}`);
  }
  init(job: Job) {
    mkdirSync(this.directory(job), { recursive: true });
  }
  log(job: Job, text: string) {
    appendFileSync(
      path.join(this.directory(job), 'logs.jsonl'),
      JSON.stringify({ at: Date.now(), text: redact(text) }) + '\n',
    );
  }
  write(job: Job, name: string, value: unknown) {
    writeFileSync(path.join(this.directory(job), name), JSON.stringify(value, null, 2));
  }
  json<T>(job: Job, name: string): T {
    return JSON.parse(readFileSync(path.join(this.directory(job), name), 'utf8'));
  }
  hash(job: Job, name: string) {
    return digest(readFileSync(path.join(this.directory(job), name)));
  }
  manifest(job: Job, phase = 'after') {
    return this.json<Manifest>(job, `${phase}.json`);
  }
  changes(job: Job, phase = 'after') {
    return this.json<JobEvidence['changes']>(job, `${phase}-changes.json`);
  }
  testPlan(job: Job, profile: Project['testCommand']): TestPlan {
    const m = this.manifest(job);
    let program: TestPlan['program'] = 'node',
      args: string[] = [],
      reason: string | undefined;
    if (profile === 'none') reason = 'Tests are disabled for this project.';
    else if ((profile === 'auto' || profile === 'npm-test') && m.scripts.test) {
      program = 'npm';
      args = ['test'];
      if (/\bvitest\b/.test(m.scripts.test)) args.push('--', '--run');
      else if (/\bjest\b/.test(m.scripts.test)) args.push('--', '--runInBand', '--watchAll=false');
    } else if ((profile === 'auto' || profile === 'node-test') && m.nodeTests.length)
      args = ['--test', '--test-reporter=tap', ...m.nodeTests];
    else reason = 'No supported automated tests were found. Add a test script or Node tests.';
    const needsInstall = program === 'npm' && m.hasDependencies && !m.hasNodeModules;
    if (needsInstall && !m.installAllowed)
      reason =
        'Dependency installation requires a package-lock.json using registry.npmjs.org packages only.';
    return {
      program,
      args,
      label: args.length ? [program, ...args].join(' ') : 'No tests',
      sourceDigest: m.sourceDigest,
      needsInstall,
      installAllowed: m.installAllowed,
      reason,
      scripts: m.scripts,
    };
  }
  verify(job: Job) {
    const e = job.evidence;
    if (!e?.verified || e.tests.status !== 'passed' || !e.changes.length)
      throw new Error('This task has no verified implementation result.');
    if (
      this.hash(job, 'tested.json') !== e.manifestHash ||
      this.hash(job, 'tested.patch') !== e.patchHash ||
      this.hash(job, 'tested.tar.gz') !== e.bundleHash
    )
      throw new Error('Saved evidence changed. Acceptance is blocked.');
    return true;
  }
}
export function testCount(output: string) {
  const plain = stripVTControlCharacters(output);
  const matches = [...plain.matchAll(/^# pass (\d+)\s*$|^\s*Tests\b[^\n]*?\b(\d+)\s+passed\b/gm)];
  return matches.reduce((sum, m) => sum + Number(m[1] || m[2] || 0), 0);
}
export function testEvidence(
  code: number,
  output: string,
  command: string,
  startedAt: number,
): TestEvidence {
  const count = testCount(output);
  return {
    status: code !== 0 ? 'failed' : count > 0 ? 'passed' : 'no_tests',
    exitCode: code,
    count,
    output: redact(output),
    command,
    startedAt,
    finishedAt: Date.now(),
  };
}
