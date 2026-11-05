import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
const image = process.env.AGENT_IMAGE || 'little-company-agent:local';
const volume = process.env.CODEX_AUTH_VOLUME || 'little-company-codex-auth';
if (!/^[a-zA-Z0-9][\w.-]{0,100}$/.test(volume)) throw new Error('Invalid named auth volume');
function docker(args, interactive = false) {
  const result = spawnSync(process.env.DOCKER_BIN || 'docker', args, {
    shell: false,
    windowsHide: !interactive,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('Codex authentication setup failed');
}
docker(['volume', 'create', volume]);
if (process.argv.includes('--from-local-login')) {
  const auth = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
  if (!existsSync(auth)) throw new Error('No local Codex login found. Run codex login first.');
  // Credentials never pass through JavaScript, stdout, arguments, or the project workspace.
  docker([
    'run',
    '--rm',
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--mount',
    `type=bind,source=${auth},target=/login.json,readonly`,
    '--mount',
    `type=volume,source=${volume},target=/home/node/.codex`,
    image,
    'node',
    '-e',
    "const fs=require('node:fs');fs.copyFileSync('/login.json','/home/node/.codex/auth.json',fs.constants.COPYFILE_EXCL);fs.chmodSync('/home/node/.codex/auth.json',0o600)",
  ]);
} else {
  docker(
    [
      'run',
      '--rm',
      '--interactive',
      '--tty',
      '--mount',
      `type=volume,source=${volume},target=/home/node/.codex`,
      image,
      'codex',
      'login',
      '--device-auth',
    ],
    true,
  );
}
console.log(
  `Set CODEX_AUTH_VOLUME=${volume} in your local .env. Use this login only for private, trusted projects.`,
);
