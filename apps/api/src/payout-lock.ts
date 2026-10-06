import type { Knex } from 'knex';

/** Stable advisory-lock key shared by the admin action and scheduler. */
export function payoutLockKey(tenantId: string): [number, number] {
  let hash = 0;
  for (let i = 0; i < tenantId.length; i += 1) hash = ((hash << 5) - hash + tenantId.charCodeAt(i)) | 0;
  return [0x50415946, hash];
}

export async function tryTenantPayoutLock(trx: Knex.Transaction, tenantId: string): Promise<boolean> {
  const [classId, objectId] = payoutLockKey(tenantId);
  const result = (await trx.raw('select pg_try_advisory_xact_lock(?, ?) as locked', [classId, objectId])) as {
    rows: Array<{ locked: boolean }>;
  };
  return !!result.rows[0]?.locked;
}
