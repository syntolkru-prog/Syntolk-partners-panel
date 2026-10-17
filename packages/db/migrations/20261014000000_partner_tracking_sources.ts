import type { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('PartnerLinkSource', t => {
    t.string('id', 32).primary();
    t.string('tenantId', 32).notNullable().references('id').inTable('Tenant').onDelete('CASCADE');
    t.string('partnerId', 32).notNullable();
    t.string('programId', 32).notNullable();
    t.string('linkId', 32).notNullable();
    t.string('sourceKey', 64).notNullable();
    t.string('scenarioId', 100).notNullable();
    t.string('formatId', 100).notNullable();
    t.string('platformId', 100).notNullable();
    t.string('materialId', 32).nullable();
    t.string('scenarioName', 120).notNullable();
    t.string('formatName', 120).notNullable();
    t.string('platformName', 120).notNullable();
    t.string('materialTitle', 200).nullable();
    t.timestamp('createdAt', { useTz: true }).notNullable().defaultTo(db.fn.now());
    t.unique(['tenantId', 'sourceKey']);
    t.unique(['tenantId', 'partnerId', 'id']);
    t.foreign(['tenantId', 'partnerId']).references(['tenantId', 'id']).inTable('Partner').onDelete('CASCADE');
    t.foreign(['tenantId', 'programId']).references(['tenantId', 'id']).inTable('Program');
    t.foreign(['tenantId', 'partnerId', 'linkId']).references(['tenantId', 'partnerId', 'id']).inTable('Link');
    t.index(['tenantId', 'partnerId', 'programId', 'scenarioId']);
  });
  await db.raw('alter table "PartnerLinkSource" enable row level security');
  await db.raw('alter table "PartnerLinkSource" force row level security');
  await db.raw(`create policy tenant_isolation on "PartnerLinkSource" using ("tenantId" = current_setting('app.tenant_id', true)) with check ("tenantId" = current_setting('app.tenant_id', true))`);
  await db.raw(`do $$ begin if exists(select 1 from pg_roles where rolname='openpartner_app') then execute 'grant select, insert, update, delete on "PartnerLinkSource" to openpartner_app'; end if; end $$;`);
  await db.schema.alterTable('Click', t => {
    t.string('trackingSourceId', 32).nullable();
    t.foreign(['tenantId', 'partnerId', 'trackingSourceId']).references(['tenantId', 'partnerId', 'id']).inTable('PartnerLinkSource');
    t.index(['partnerId', 'trackingSourceId', 'ts']);
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('Click', t => { t.dropColumn('trackingSourceId'); });
  await db.schema.dropTable('PartnerLinkSource');
}
