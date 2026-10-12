import '../apps/api/src/env.js';
import { resolve } from 'node:path';
import { createDb } from '../packages/db/src/index.js';
import { assertIsolatedCoachDatabase } from '../apps/api/src/coach/test-guard.js';
const source = process.env.DATABASE_URL!;
const url = new URL(source);
url.pathname = '/syntolk_coach_test_20261012';
if (!['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Only local isolated DB is allowed');
assertIsolatedCoachDatabase(url.toString(),source);
const sourceDb = await createDb({connectionString:source,bypassRls:true});
try {
  const exists = await sourceDb.raw('select 1 from pg_database where datname = ?',['syntolk_coach_test_20261012']);
  if (!exists.rows.length) await sourceDb.raw('create database "syntolk_coach_test_20261012"');
} finally { await sourceDb.destroy(); }
const test = await createDb({ connectionString: url.toString(), bypassRls: true });
try {
  const [batch, files] = await test.migrate.latest({ directory: resolve('packages/db/migrations'), loadExtensions: ['.ts'], disableMigrationsListValidation: true });
  console.log(JSON.stringify({ database: url.pathname.slice(1), batch, migrationsApplied: files.length }));
} finally { await test.destroy(); }
