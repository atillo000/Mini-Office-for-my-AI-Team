import path from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import type { Runner } from '../process';
import { run } from '../process';
import type { Job, Project, Subtask, TestPlan } from '../../shared/types';
import { initialEmployees } from '../../shared/seed';
import { Artifacts, digest } from './artifacts';
import { CodexStream } from './protocol';
import { preflightSource } from './preflight';
import workspaceLimits from '../../shared/workspace-limits.json';
const image = () => process.env.AGENT_IMAGE || 'little-company-agent:local';
const docker = () => process.env.DOCKER_BIN || 'docker';
export const planSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    subtasks: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          agentId: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'agentId', 'dependsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'subtasks'],
  additionalProperties: false,
};
export class CodexAdapter {
  constructor(
    public runner: Runner = run,
    public root = path.resolve('.data/workspaces'),
    public artifacts = new Artifacts(),
  ) {}
  policy() {
    return {
      image: image(),
      seccompHash: digest(readFileSync(path.resolve('server/agents/seccomp.json'))),
      workspaceLimits,
      sandbox: 'Codex filesystem + network restrictions; credentials hidden from tools',
    };
  }
  private sandboxOptions() {
    return ['--security-opt', `seccomp=${path.resolve('server/agents/seccomp.json')}`];
  }
  private permissions(readOnly: boolean) {
    return [
      '-c',
      'default_permissions="office"',
      '-c',
      `permissions.office.extends="${readOnly ? ':read-only' : ':workspace'}"`,
      '-c',
      'permissions.office.filesystem={"/home/node/.codex"="deny","/proc"="deny"}',
      '-c',
      'permissions.office.network.enabled=false',
    ];
  }
  private limits() {
    return [
      '--init',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=128',
      '--memory=1g',
      '--cpus=1',
      '--tmpfs',
      '/tmp:rw,nosuid,size=256m',
    ];
  }
  private auth() {
    const volume = process.env.CODEX_AUTH_VOLUME;
    if (volume) {
      if (!/^[a-zA-Z0-9][\w.-]{0,100}$/.test(volume))
        throw new Error('CODEX_AUTH_VOLUME must be a Docker named volume.');
      return ['--mount', `type=volume,source=${volume},target=/home/node/.codex`];
    }
    return ['--tmpfs', '/home/node/.codex:rw,nosuid,size=64m', '--env', 'CODEX_API_KEY'];
  }
  async stop(jobId: string) {
    await Promise.all(
      ['agent', 'test', 'install', 'inspect', 'prepare'].map((kind) =>
        this.runner(docker(), ['rm', '-f', `office-${kind}-${jobId}`], { timeout: 15000 }).catch(
          () => undefined,
        ),
      ),
    );
  }
  async health() {
    try {
      const result = await this.runner(
        docker(),
        ['run', '--rm', '--network=none', ...this.limits(), image(), 'codex', 'exec', '--help'],
        { timeout: 20000 },
      );
      if (result.code !== 0 || !result.output.includes('--ignore-user-config'))
        throw new Error('Build the current agent image: npm run agent:build');
      for (const readonly of [false, true]) {
        const probe = await this.runner(
          docker(),
          [
            'run',
            '--rm',
            ...this.limits(),
            ...this.sandboxOptions(),
            '--tmpfs',
            '/outside:rw,mode=1777,size=1m',
            '--tmpfs',
            '/workspace:rw,mode=1777,size=1m',
            '--tmpfs',
            '/home/node/.codex:rw,mode=1777,size=8m',
            '--workdir',
            '/workspace',
            image(),
            'codex',
            ...this.permissions(readonly),
            'sandbox',
            '-P',
            'office',
            '--',
            'node',
            '/opt/office/sandbox-probe.mjs',
            ...(readonly ? ['read-only'] : []),
          ],
          { timeout: 20000 },
        );
        if (probe.code !== 0)
          throw new Error(
            'Codex sandbox preflight failed. Rebuild the worker and check Docker namespace support.',
          );
      }
      if (!process.env.CODEX_API_KEY && !process.env.CODEX_AUTH_VOLUME)
        throw new Error('Configure CODEX_API_KEY or an explicitly provisioned CODEX_AUTH_VOLUME.');
      if (process.env.CODEX_AUTH_VOLUME) {
        const login = await this.runner(
          docker(),
          [
            'run',
            '--rm',
            '--network=none',
            ...this.limits(),
            ...this.auth(),
            image(),
            'codex',
            'login',
            'status',
          ],
          { timeout: 15000 },
        );
        if (login.code !== 0)
          throw new Error('The isolated Codex login is unavailable. Run npm run agent:login.');
      }
      return {
        available: true,
        version: 'Isolated Codex CLI',
        executionReady: true,
        detail: 'Container ready; account access is checked when a task runs.',
      };
    } catch (error) {
      return {
        available: false,
        version: 'Isolated runner unavailable',
        executionReady: false,
        detail: (error as Error).message,
      };
    }
  }
  async source(project: Project) {
    if (!project.approved) throw new Error('Project is not approved');
    const canonical = await realpath(project.path);
    if (canonical !== project.path)
      throw new Error('Project path changed. Reconnect its canonical path.');
    const head = await this.runner(
      'git',
      [
        '-C',
        canonical,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.hooksPath=',
        'rev-parse',
        '--verify',
        'HEAD^{commit}',
      ],
      { timeout: 10000 },
    );
    if (head.code !== 0 || !/^[a-f0-9]{40,64}$/.test(head.output.trim()))
      throw new Error('Project requires a committed Git revision.');
    return { path: canonical, commit: head.output.trim(), testCommand: project.testCommand };
  }
  async isolate(project: Project, job: Job, signal: AbortSignal, log: (text: string) => void) {
    const source = await this.source(project);
    if (!job.source || JSON.stringify(source) !== JSON.stringify(job.source))
      throw new Error('Approved source changed. Create a new task or approve a retry.');
    this.artifacts.init(job);
    const sourceSize = await preflightSource(this.runner, source.path, source.commit, signal);
    log(
      `Preparing ${sourceSize.files} committed files (${(sourceSize.bytes / 1048576).toFixed(1)} MiB). Git indexing has a ${workspaceLimits.gitIndexTimeoutMs / 1000}s limit.`,
    );
    const target = path.join(this.root, `${job.id}-${job.attempts}`);
    await mkdir(target, { recursive: true });
    const archive = path.join(this.artifacts.directory(job), 'source.tar');
    const exported = await this.runner(
      'git',
      [
        '-C',
        source.path,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.hooksPath=',
        'archive',
        '--format=tar',
        '--output',
        archive,
        source.commit,
      ],
      { timeout: 60000, signal },
    );
    if (exported.code !== 0) throw new Error('Unable to export approved source commit.');
    const prepared = await this.container(
      job.id,
      'prepare',
      target,
      ['node', '/opt/office/worker.mjs', 'extract'],
      signal,
      log,
      ['--network=none', '--mount', `type=bind,source=${archive},target=/source.tar,readonly`],
    );
    if (prepared.code !== 0)
      throw new Error(
        'Isolated workspace preparation failed. The preceding [workspace] log identifies the failed step; no agent has run.',
      );
    job.baseCommit = source.commit;
    job.workspace = target;
    await this.capture(job, 'baseline', signal, log);
    this.artifacts.write(job, 'source.json', source);
    return target;
  }
  async container(
    jobId: string,
    kind: string,
    workspace: string,
    command: string[],
    signal: AbortSignal,
    log: (text: string) => void,
    extra: string[] = [],
    readonly = false,
  ) {
    const name = `office-${kind}-${jobId}`;
    const seconds = kind === 'prepare' ? workspaceLimits.prepareTimeoutSeconds : 180;
    const cancel = () => {
      void this.runner(docker(), ['rm', '-f', name], { timeout: 15000 }).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      return await this.runner(
        docker(),
        [
          'run',
          '--rm',
          '--name',
          name,
          ...this.limits(),
          ...extra,
          '--mount',
          `type=bind,source=${workspace},target=/workspace${readonly ? ',readonly' : ''}`,
          '--workdir',
          '/workspace',
          image(),
          'timeout',
          String(seconds),
          ...command,
        ],
        { timeout: (seconds + 10) * 1000, signal, onData: log },
      );
    } finally {
      signal.removeEventListener('abort', cancel);
      await this.runner(docker(), ['rm', '-f', name], { timeout: 15000 }).catch(() => {});
    }
  }
  async capture(
    job: Job,
    phase: 'baseline' | 'after' | 'tested' | 'post',
    signal: AbortSignal,
    log: (text: string) => void,
  ) {
    const result = await this.container(
      job.id,
      'inspect',
      job.workspace,
      ['node', '/opt/office/worker.mjs', 'capture', phase],
      signal,
      () => {},
      [
        '--network=none',
        '--mount',
        `type=bind,source=${this.artifacts.directory(job)},target=/artifacts`,
      ],
      true,
    );
    if (result.code !== 0) {
      log(result.output);
      throw new Error('Artifact inspection failed; no verified success is claimed.');
    }
    return this.artifacts.manifest(job, phase);
  }
  async inspectDigest(job: Job, signal: AbortSignal, log: (text: string) => void) {
    return (await this.capture(job, 'post', signal, log)).sourceDigest;
  }
  async execute(
    workspace: string,
    prompt: string,
    signal: AbortSignal,
    log: (text: string) => void,
    jobId: string,
    readOnly = false,
    schemaFile?: string,
    skipGitCheck = false,
  ) {
    const name = `office-agent-${jobId}`;
    const stream = new CodexStream();
    const startedAt = Date.now();
    const extra = schemaFile
      ? ['--mount', `type=bind,source=${schemaFile},target=/output-schema.json,readonly`]
      : [];
    const args = [
      'run',
      '--interactive',
      '--rm',
      '--name',
      name,
      ...this.limits(),
      ...this.sandboxOptions(),
      ...this.auth(),
      ...extra,
      '--mount',
      `type=bind,source=${workspace},target=/workspace${readOnly ? ',readonly' : ''}`,
      '--workdir',
      '/workspace',
      image(),
      'timeout',
      '600',
      'codex',
      '--ask-for-approval',
      'never',
      'exec',
      '--ignore-user-config',
      '--ignore-rules',
      ...this.permissions(readOnly),
      '--json',
      '--color',
      'never',
      '--ephemeral',
      ...(skipGitCheck ? ['--skip-git-repo-check'] : []),
      '-c',
      'shell_environment_policy.inherit="none"',
      '-c',
      'projects={"/workspace"={trust_level="untrusted"}}',
      '-c',
      'web_search="disabled"',
      ...(schemaFile ? ['--output-schema', '/output-schema.json'] : []),
      '-',
    ];
    const cancel = () => {
      void this.runner(docker(), ['rm', '-f', name], { timeout: 15000 }).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await this.runner(docker(), args, {
        input: prompt,
        timeout: 610000,
        signal,
        onData: log,
        onStdoutLine: (line) => stream.consume(line),
      });
      for (const line of result.output.split('\n')) stream.consume(line);
      return stream.result(result.code, startedAt);
    } finally {
      signal.removeEventListener('abort', cancel);
      await this.runner(docker(), ['rm', '-f', name], { timeout: 15000 }).catch(() => {});
    }
  }
  async tests(
    job: Job,
    plan: TestPlan,
    signal: AbortSignal,
    log: (text: string) => void,
    allowInstall: boolean,
  ) {
    if (plan.reason || !plan.args.length)
      throw new Error(plan.reason || 'No automated tests configured');
    if (plan.needsInstall) {
      if (!allowInstall || !plan.installAllowed)
        throw new Error('CEO approval is required for dependency downloads.');
      const installed = await this.container(
        job.id,
        'install',
        job.workspace,
        ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache=/tmp/npm'],
        signal,
        log,
        ['--env', 'CI=1', '--env', 'NPM_CONFIG_USERCONFIG=/dev/null'],
      );
      if (installed.code !== 0) throw new Error('Approved dependency installation failed.');
    }
    return this.container(
      job.id,
      'test',
      job.workspace,
      [plan.program, ...plan.args],
      signal,
      log,
      [
        '--network=none',
        '--env',
        'CI=1',
        '--env',
        'NPM_CONFIG_CACHE=/tmp/npm',
        '--env',
        'NPM_CONFIG_USERCONFIG=/dev/null',
      ],
    );
  }
}
export function validatePlan(subtasks: Subtask[], allowedIds = initialEmployees.map((e) => e.id)) {
  const seen = new Set<string>();
  for (const task of subtasks) {
    if (seen.has(task.id) || task.dependsOn.some((id) => !seen.has(id)))
      throw new Error('Plan has duplicate, forward or cyclic dependencies');
    if (!allowedIds.includes(task.agentId)) throw new Error('Unknown specialist in plan');
    seen.add(task.id);
  }
  return subtasks;
}
