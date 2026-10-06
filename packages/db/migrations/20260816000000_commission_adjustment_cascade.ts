import type { Knex } from 'knex';

/** CommissionAdjustment is a compensating sidecar of Commission. If a
 * maintenance/import operation removes a derived commission row, its
 * adjustments must not leave an orphaned foreign-key row behind. Normal
 * production flows never delete commissions; refunds still append entries. */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('alter table "CommissionAdjustment" drop constraint if exists "commissionadjustment_commissionid_foreign"');
  await knex.raw(
    'alter table "CommissionAdjustment" add constraint "commissionadjustment_commissionid_foreign" foreign key ("commissionId") references "Commission"("id") on delete cascade',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('alter table "CommissionAdjustment" drop constraint if exists "commissionadjustment_commissionid_foreign"');
  await knex.raw(
    'alter table "CommissionAdjustment" add constraint "commissionadjustment_commissionid_foreign" foreign key ("commissionId") references "Commission"("id")',
  );
}
