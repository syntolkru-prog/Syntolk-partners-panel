import type { Knex } from 'knex';

/** Syntolk partner-program fields that are needed before a real payment
 * provider is connected. They are nullable/defaulted so existing local
 * partners remain valid and keep their history. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('Partner', (t) => {
    t.string('phone', 40).nullable();
    t.timestamp('termsAcceptedAt', { useTz: true }).nullable();
    t.string('termsVersion', 80).nullable();
    t.string('cloudPaymentsStatus', 24).notNullable().defaultTo('not_connected');
    t.string('cloudPaymentsAccountId', 160).nullable();
    t.text('cloudPaymentsError').nullable();
    t.string('tier', 16).notNullable().defaultTo('standard');
  });

  await knex.schema.alterTable('Link', (t) => {
    t.string('label', 120).nullable();
    t.string('channel', 40).nullable();
  });

  await knex.raw(`
    alter table "Partner" add constraint "Partner_cloudPaymentsStatus_check"
      check ("cloudPaymentsStatus" in ('not_connected', 'connected', 'error'))
  `);
  await knex.raw(`
    alter table "Partner" add constraint "Partner_tier_check"
      check ("tier" in ('standard', 'pro', 'top'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('alter table "Partner" drop constraint if exists "Partner_cloudPaymentsStatus_check"');
  await knex.raw('alter table "Partner" drop constraint if exists "Partner_tier_check"');
  await knex.schema.alterTable('Link', (t) => {
    t.dropColumn('label');
    t.dropColumn('channel');
  });
  await knex.schema.alterTable('Partner', (t) => {
    t.dropColumn('tier');
    t.dropColumn('cloudPaymentsError');
    t.dropColumn('cloudPaymentsAccountId');
    t.dropColumn('cloudPaymentsStatus');
    t.dropColumn('termsVersion');
    t.dropColumn('termsAcceptedAt');
    t.dropColumn('phone');
  });
}
