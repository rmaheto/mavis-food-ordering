import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from './db.js';

const target = process.argv[2] || process.env.DATABASE_PATH || path.join('data', 'local.sqlite');

if (target !== ':memory:') {
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
}

const db = openDatabase(target, { migrate: false });
try {
  const { runMigrations } = await import('./db.js');
  const applied = runMigrations(db);
  if (applied.length === 0) {
    console.log(`Database ${target} is up to date.`);
  } else {
    console.log(`Database ${target}: applied ${applied.join(', ')}`);
  }
} finally {
  db.close();
}
