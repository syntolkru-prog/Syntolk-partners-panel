import type { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('PartnerMessage', t => {
    t.string('id', 32).primary();
    t.string('tenantId', 32).notNullable().references('id').inTable('Tenant').onDelete('CASCADE');
    t.string('partnerId', 32).notNullable();
    t.string('senderRole', 16).notNullable();
    t.string('clientMessageId', 100).notNullable();
    t.text('body').notNullable();
    t.timestamp('createdAt', { useTz: true }).notNullable().defaultTo(db.fn.now());
    t.timestamp('readAt', { useTz: true }).nullable();
    t.foreign(['tenantId', 'partnerId']).references(['tenantId', 'id']).inTable('Partner').onDelete('CASCADE');
    t.unique(['tenantId', 'partnerId', 'senderRole', 'clientMessageId']);
    t.index(['tenantId', 'partnerId', 'id']);
    t.check("\"senderRole\" in ('partner', 'admin')");
    t.check('char_length(body) between 1 and 8000');
  });
  await db.raw('create index "PartnerMessage_unread" on "PartnerMessage" ("tenantId", "senderRole", "partnerId") where "readAt" is null');
  await db.raw('alter table "PartnerMessage" enable row level security');
  await db.raw('alter table "PartnerMessage" force row level security');
  await db.raw(`create policy tenant_isolation on "PartnerMessage" using ("tenantId" = current_setting('app.tenant_id', true)) with check ("tenantId" = current_setting('app.tenant_id', true))`);
  await db.raw(`do $$ begin if exists(select 1 from pg_roles where rolname='openpartner_app') then execute 'grant select, insert, update, delete on "PartnerMessage" to openpartner_app'; end if; end $$;`);
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTable('PartnerMessage');
}
