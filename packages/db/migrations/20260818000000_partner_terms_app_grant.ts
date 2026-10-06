import type { Knex } from 'knex';

/** Complete the app-role grant for the legal acceptance history. The table
 * itself was created in the preceding migration so upgrades remain easy to
 * diagnose if a self-hosted install already has the role. */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'openpartner_app') then
        execute 'grant select, insert on "PartnerTermsAcceptance" to openpartner_app';
      end if;
    end
    $$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'openpartner_app') then
        execute 'revoke all privileges on "PartnerTermsAcceptance" from openpartner_app';
      end if;
    end
    $$;
  `);
}
