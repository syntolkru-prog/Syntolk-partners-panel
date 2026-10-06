import type { Knex } from 'knex';

/** Append-only legal acceptance history plus provider-neutral payout fields.
 * CloudPayments (or another licensed payout service) can fill the provider
 * operation later without changing the commission ledger. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('Payout', (t) => {
    t.string('providerOperationId', 160).nullable();
    t.string('providerStatus', 40).nullable();
  });

  await knex.schema.createTable('PartnerTermsAcceptance', (t) => {
    t.string('id', 32).primary();
    t.string('tenantId', 32).notNullable().references('id').inTable('Tenant').onDelete('CASCADE');
    t.string('partnerId', 32).notNullable().references('id').inTable('Partner').onDelete('CASCADE');
    t.string('version', 80).notNullable();
    t.timestamp('acceptedAt', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenantId', 'partnerId', 'acceptedAt']);
  });
  await knex.raw('alter table "PartnerTermsAcceptance" enable row level security');
  await knex.raw('alter table "PartnerTermsAcceptance" force row level security');
  await knex.raw(`
    create policy tenant_isolation on "PartnerTermsAcceptance"
      using ("tenantId" = current_setting('app.tenant_id', true))
      with check ("tenantId" = current_setting('app.tenant_id', true))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('drop policy if exists tenant_isolation on "PartnerTermsAcceptance"');
  await knex.schema.dropTableIfExists('PartnerTermsAcceptance');
  await knex.schema.alterTable('Payout', (t) => {
    t.dropColumn('providerStatus');
    t.dropColumn('providerOperationId');
  });
}
