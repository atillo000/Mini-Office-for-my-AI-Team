import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { initialEmployees } from '../shared/seed';
import type { Snapshot, Weather } from '../shared/types';
import { migrate } from './migrations';
export const offlineWeather: Weather = {
  city: 'Manila',
  temperature: 28,
  code: 2,
  condition: 'cloudy',
  fetchedAt: 0,
  source: 'offline',
  provider: 'Open-Meteo',
  timezone: 'Asia/Manila',
};
export class Store {
  db: DatabaseSync;
  constructor(
    public readonly file = process.env.COMPANY_DB || path.resolve('.data/company.sqlite'),
  ) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));',
    );
    migrate(this.db);
    if (!this.list('employees').length)
      initialEmployees.forEach((e) => this.put('employees', e.id, e));
  }
  list<T>(kind: string): T[] {
    return (
      this.db.prepare('SELECT data FROM records WHERE kind = ? ORDER BY rowid').all(kind) as {
        data: string;
      }[]
    ).map((r) => JSON.parse(r.data));
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare('SELECT data FROM records WHERE kind = ? AND id = ?')
      .get(kind, id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  put<T>(kind: string, id: string, value: T) {
    this.db
      .prepare(
        'INSERT INTO records (kind,id,data) VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
      )
      .run(kind, id, JSON.stringify(value));
    return value;
  }
  remove(kind: string, id: string) {
    this.db.prepare('DELETE FROM records WHERE kind = ? AND id = ?').run(kind, id);
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  snapshot(): Snapshot {
    return {
      employees: this.list('employees'),
      projects: this.list('projects'),
      jobs: this.list('jobs'),
      messages: this.list('messages'),
      meetings: this.list('meetings'),
      weather: this.get('settings', 'weather') || offlineWeather,
      simulation: this.get('settings', 'simulation') || {
        minute: 568,
        savedAt: Date.now(),
      },
      codex: { available: false, version: 'Not checked' },
      authRequired: false,
    };
  }
  close() {
    this.db.close();
  }
}
