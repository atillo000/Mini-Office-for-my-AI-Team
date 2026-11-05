import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { run } from '../process';
export interface Secrets {
  get<T>(name: string): Promise<T | undefined>;
  set(name: string, value: unknown): Promise<void>;
  remove(name: string): Promise<void>;
}
// For tests only; production never stores plaintext credentials in SQLite.
export class MemorySecrets implements Secrets {
  values = new Map<string, unknown>();
  async get<T>(name: string) {
    return this.values.get(name) as T | undefined;
  }
  async set(name: string, value: unknown) {
    this.values.set(name, value);
  }
  async remove(name: string) {
    this.values.delete(name);
  }
}
export class CredentialVault implements Secrets {
  private keyPromise?: Promise<Buffer>;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private root = path.resolve('.data/credentials')) {}
  private async key() {
    this.keyPromise ??= (async () => {
      mkdirSync(this.root, { recursive: true });
      if (process.env.OFFICE_VAULT_KEY) {
        const key = Buffer.from(process.env.OFFICE_VAULT_KEY, 'base64');
        if (key.length !== 32)
          throw new Error('OFFICE_VAULT_KEY must be a base64 encoded 32-byte key.');
        return key;
      }
      if (process.platform !== 'win32')
        throw new Error(
          'Configure OFFICE_VAULT_KEY to enable encrypted account connections on this platform.',
        );
      const file = path.join(this.root, 'windows-key.dpapi');
      const existing = existsSync(file);
      const input = existing ? readFileSync(file, 'utf8') : randomBytes(32).toString('base64');
      const operation = existing ? 'Unprotect' : 'Protect';
      const script =
        'Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::' +
        operation +
        '($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($r))';
      const result = await run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { input, timeout: 15000 },
      );
      if (result.code !== 0)
        throw new Error('Windows could not unlock the account vault for this user.');
      if (existing) return Buffer.from(result.output.trim(), 'base64');
      writeFileSync(file, result.output.trim(), { mode: 0o600, flag: 'wx' });
      return Buffer.from(input, 'base64');
    })();
    return this.keyPromise;
  }
  private records(): Record<string, string> {
    const file = path.join(this.root, 'secrets.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  }
  async get<T>(name: string): Promise<T | undefined> {
    await this.pending;
    const value = this.records()[name];
    if (!value) return undefined;
    const bytes = Buffer.from(value, 'base64'),
      key = await this.key();
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
    );
  }
  private mutate(work: (values: Record<string, string>, key: Buffer) => void) {
    const next = this.pending
      .catch(() => undefined)
      .then(async () => {
        const key = await this.key(),
          values = this.records();
        work(values, key);
        const file = path.join(this.root, 'secrets.json'),
          temporary = file + '.tmp';
        writeFileSync(temporary, JSON.stringify(values), { mode: 0o600 });
        renameSync(temporary, file);
      });
    this.pending = next;
    return next;
  }
  async set(name: string, value: unknown) {
    await this.mutate((values, key) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(name));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      values[name] = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
    });
  }
  async remove(name: string) {
    await this.mutate((values) => {
      delete values[name];
    });
  }
}
