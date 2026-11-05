import type { DatabaseSync } from 'node:sqlite';
// Forward-only, additive migrations; preserve every existing record and execution job.
function migrateInitial(db: DatabaseSync) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(1);
  if (applied) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS records_work_updated ON records(kind, json_extract(data, '$.updatedAt')); CREATE INDEX IF NOT EXISTS records_work_created ON records(kind, json_extract(data, '$.createdAt'));",
    );
    const put = db.prepare('INSERT OR IGNORE INTO records(kind,id,data) VALUES (?,?,?)');
    for (const id of ['outlook', 'teams', 'zoho'])
      put.run(
        'integrations',
        id,
        JSON.stringify({
          id,
          mode: 'MANUAL_ONLY',
          apiAllowed: false,
          browserAllowed: false,
          policyConfirmedAt: null,
          version: 1,
          updatedAt: Date.now(),
          lastSuccessAt: null,
          lastSyncAt: null,
        }),
      );
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(1, Date.now());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function migrate(db: DatabaseSync) {
  migrateInitial(db);
  if (db.prepare('SELECT version FROM schema_migrations WHERE version=2').get()) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS records_mail_account ON records(kind, json_extract(data,'$.account'),json_extract(data,'$.receivedAt'));",
    );
    const rows = db.prepare("SELECT id,data FROM records WHERE kind='integrations'").all() as {
      id: string;
      data: string;
    }[];
    for (const row of rows) {
      const data = JSON.parse(row.data);
      if (data.mode === 'SIMULATION_ONLY')
        db.prepare("UPDATE records SET data=? WHERE kind='integrations' AND id=?").run(
          JSON.stringify({
            ...data,
            mode: 'MANUAL_ONLY',
            version: data.version + 1,
            updatedAt: Date.now(),
          }),
          row.id,
        );
    }
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(2,?)').run(Date.now());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
