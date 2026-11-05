import { mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, closeSync } from 'node:fs';
import path from 'node:path';
export function acquireServerLock(
  database = process.env.COMPANY_DB || path.resolve('.data/company.sqlite'),
) {
  const file = path.resolve(database + '.lock');
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    const pid = Number(readFileSync(file, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1)
      throw new Error('Invalid service lock; inspect it before restarting.');
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      else throw error;
    }
    if (alive) throw new Error('Another execution service already owns this database.');
    unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const fd = openSync(file, 'wx');
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  return () => {
    try {
      if (readFileSync(file, 'utf8') === String(process.pid)) unlinkSync(file);
    } catch {
      /* Already released. */
    }
  };
}
