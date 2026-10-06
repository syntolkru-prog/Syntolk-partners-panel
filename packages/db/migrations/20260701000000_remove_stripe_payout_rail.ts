import type { Knex } from 'knex';

/**
 * Stripe is no longer an active payout rail in Syntolk. Existing tenants
 * that still carry the old preference are deliberately converted to manual;
 * historical payout rows and Stripe-era columns remain untouched for audit
 * and import compatibility.
 */
export async function up(knex: Knex): Promise<void> {
  await knex('Tenant').where({ payoutRailPreference: 'stripe_connect' }).update({ payoutRailPreference: 'manual' });
  await knex.raw('alter table "Tenant" drop constraint if exists "Tenant_payoutRailPreference_check"');
  await knex.raw(
    `alter table "Tenant" add constraint "Tenant_payoutRailPreference_check" check ("payoutRailPreference" is null or "payoutRailPreference" in ('auto', 'manual'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('alter table "Tenant" drop constraint if exists "Tenant_payoutRailPreference_check"');
  await knex.raw(
    `alter table "Tenant" add constraint "Tenant_payoutRailPreference_check" check ("payoutRailPreference" is null or "payoutRailPreference" in ('auto', 'stripe_connect', 'manual'))`,
  );
}
