import '../apps/api/src/env.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDb, DEFAULT_TENANT_ID, COACH_TABLES } from '../packages/db/src/index.js';
import { EXPORT_TABLES, exportTable, tableColumnTypes, buildSqlDump, SCHEMA_VERSION, type ColumnTypeMap } from '../apps/api/src/export.js';

// Generates a recoverable core-data artifact; never prints connection credentials.
const source = process.env.DATABASE_URL;
if (!source) throw new Error('DATABASE_URL is required');
const testName = 'syntolk_coach_test_20261012';
const sourceUrl = new URL(source);
if (sourceUrl.pathname.slice(1) === testName) throw new Error('Source must not be the test database');
if (!['localhost','127.0.0.1'].includes(sourceUrl.hostname)) throw new Error('Only the local source database is supported');
const db = await createDb({ connectionString: source, bypassRls: true });
try {
  const dir = resolve('work/coach-baseline-20261012-verified');
  await mkdir(dir, { recursive: true });
  const columnTypes: ColumnTypeMap = {};
  const bundle = await db.transaction(async trx => {
    await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const tables: Record<string, unknown[]> = {};
    for (const {table} of EXPORT_TABLES) {
      // This backup is deliberately usable before the new migration exists.
      if ((COACH_TABLES as readonly string[]).includes(table) && !await trx.schema.hasTable(table)) continue;
      tables[table] = await exportTable(trx,table,DEFAULT_TENANT_ID);
      columnTypes[table] = await tableColumnTypes(trx,table);
    }
    return tables;
  });
  await writeFile(resolve(dir, 'core-before-coach.json'), JSON.stringify({ schemaVersion: SCHEMA_VERSION, exportedAt: new Date(), tables: bundle }, null, 2), { flag: 'wx' });
  await writeFile(resolve(dir, 'core-before-coach.sql'), buildSqlDump(bundle, { sourceTenantId: DEFAULT_TENANT_ID, columnTypes }), { flag: 'wx' });
  const exists = await db.raw('select 1 from pg_database where datname = ?', [testName]);
  if (!exists.rows.length) await db.raw(`create database "${testName}"`);
  console.log(JSON.stringify({ backupDirectory: dir, coreTableCount: Object.keys(bundle).length, rowCount: Object.values(bundle).reduce((sum, rows) => sum + rows.length, 0), testDatabase: testName }));
} finally { await db.destroy(); }
