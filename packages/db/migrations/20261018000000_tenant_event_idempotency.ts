import type { Knex } from 'knex';

/** Add the tenant key; retain the global key for the original production API.
 * Knex runs this in a transaction. Fail quickly on a busy table so operators
 * can retry deployment rather than queue application writes indefinitely. */
export async function up(knex: Knex): Promise<void> {
  await knex.raw("set local lock_timeout = '5s'");
  await knex.schema.alterTable('Event', (table) => {
    table.unique(['tenantId', 'externalEventId'], { indexName: 'Event_tenant_external_unique' });
  });
  // Keep global uniqueness while the original production API shares this database.
}

export async function down(): Promise<void> {
  // Cross-tenant duplicate IDs become legitimate after up. Never delete or
  // rewrite them to restore the obsolete global constraint.
  throw new Error('Tenant event idempotency is forward-only; restore via a reviewed forward migration.');
}
