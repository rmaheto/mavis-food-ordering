import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'db',
  'migrations',
);

/**
 * Apply any migration files not yet recorded in schema_migrations.
 * Idempotent: already-applied versions are skipped.
 * Returns the list of versions applied by this call.
 */
export function runMigrations(db, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     )`,
  );
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version),
  );
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort();
  const record = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
  const newlyApplied = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(file);
    })();
    newlyApplied.push(file);
  }
  return newlyApplied;
}

/**
 * Open a SQLite database (file path or ':memory:'), enable foreign keys
 * and (for files) WAL, then run migrations unless disabled.
 */
export function openDatabase(filename = ':memory:', { migrate = true, migrationsDir } = {}) {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== ':memory:' && filename !== '') {
    db.pragma('journal_mode = WAL');
  }
  if (migrate) {
    runMigrations(db, migrationsDir);
  }
  return db;
}
