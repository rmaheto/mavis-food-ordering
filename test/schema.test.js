import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, runMigrations } from '../src/db.js';

const tables = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);

test('migrations create every entity table from empty', () => {
  const db = openDatabase(':memory:');
  const names = tables(db);
  for (const t of [
    'category',
    'food_item',
    'customer_order',
    'order_line',
    'admin_user',
    'settings',
    'schema_migrations',
  ]) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
  db.close();
});

test('migrations are idempotent', () => {
  const db = openDatabase(':memory:');
  const before = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
  assert.deepEqual(runMigrations(db), []);
  const after = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
  assert.equal(before, after);
  assert.ok(before >= 1);
  db.close();
});

test('migrations work on a local file database and can be re-run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mavis-'));
  const file = path.join(dir, 'test.sqlite');
  try {
    const db = openDatabase(file);
    db.close();
    const again = openDatabase(file);
    assert.deepEqual(runMigrations(again), []);
    assert.ok(tables(again).includes('customer_order'));
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('foreign keys are enabled', () => {
  const db = openDatabase(':memory:');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  db.close();
});

test('categories are flat: no parent column', () => {
  const db = openDatabase(':memory:');
  const cols = db.prepare('PRAGMA table_info(category)').all().map((c) => c.name);
  assert.ok(!cols.some((c) => /parent/i.test(c)));
  db.close();
});

test('settings holds a single row defaulting to accepting orders', () => {
  const db = openDatabase(':memory:');
  const rows = db.prepare('SELECT * FROM settings').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accepting_orders, 1);
  assert.throws(() => db.prepare('INSERT INTO settings (id, accepting_orders) VALUES (2, 1)').run());
  db.close();
});
