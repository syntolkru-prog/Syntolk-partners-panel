import { afterAll, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { DEFAULT_TENANT_ID as tenantId } from '@openpartner/db';
import { db, appDb } from '../../db.js';
import { importBundle } from '../../export.js';
import { assertIsolatedCoachDatabase } from '../test-guard.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!, process.env.COACH_WORKING_DB);
afterAll(async () => { await db.destroy(); await appDb.destroy(); });

it('imports more than 65,535 values atomically and keeps replay counts exact', async () => {
  const rows = Array.from({ length: 11_000 }, () => {
    const id = ulid();
    return { id, tenantId: 'source-tenant', name: `Импорт ${id}`, email: `${id}@example.test`, activatedAt: new Date().toISOString(), metadata: { source: 'large-import' } };
  });
  const rollback = new Error('Rollback isolated import fixture');
  await expect(db.transaction(async trx => {
    const first = await importBundle(trx, tenantId, { Partner: rows });
    expect(first).toEqual({ inserted: { Partner: rows.length }, skipped: { Partner: 0 } });
    const last = await trx('Partner').where({ tenantId, id: rows.at(-1)!.id }).first();
    expect(last).toMatchObject({ name: rows.at(-1)!.name, metadata: { source: 'large-import' } });
    const replay = await importBundle(trx, tenantId, { Partner: rows });
    expect(replay).toEqual({ inserted: { Partner: 0 }, skipped: { Partner: rows.length } });
    throw rollback;
  })).rejects.toBe(rollback);
  expect(await db('Partner').where({ id: rows[0].id }).first()).toBeUndefined();
});
