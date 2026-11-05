import fs from 'node:fs';
import net from 'node:net';
const readonly = process.argv[2] === 'read-only';
let credentialsHidden = false;
try {
  fs.readdirSync('/home/node/.codex');
} catch (error) {
  credentialsHidden = ['EACCES', 'EPERM', 'ENOENT'].includes(error.code);
}
if (!credentialsHidden) throw new Error('Codex credential directory is readable by tools');
let blocked = false;
try {
  fs.writeFileSync('/outside/probe.txt', 'must not write');
} catch (error) {
  blocked = ['EACCES', 'EPERM', 'EROFS'].includes(error.code);
  console.log('Outside write denied:', error.code);
}
if (!blocked) throw new Error('Sandbox did not block writes outside the workspace');
let wrote = false;
try {
  fs.writeFileSync('/workspace/probe.txt', 'probe');
  wrote = true;
} catch (error) {
  if (!readonly || !['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw error;
}
if (wrote === readonly) throw new Error('Workspace permission check failed');
if (wrote) fs.unlinkSync('/workspace/probe.txt');
const socket = net.createConnection(80, '192.0.2.1');
socket.on('error', (error) => {
  if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
  console.log('Sandbox verified: workspace permissions and network denial enforced.');
  process.exit(0);
});
setTimeout(() => {
  socket.destroy();
  throw new Error('Sandbox did not deny network access');
}, 3000);
