import type { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.raw(`do $$ declare c record; begin
    for c in select conname from pg_constraint where conrelid = '"PartnerMessage"'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%char_length(body)%'
    loop execute format('alter table "PartnerMessage" drop constraint %I', c.conname); end loop;
  end $$`);
  await db.raw('alter table "PartnerMessage" add constraint "PartnerMessage_body_length" check (char_length(body) between 0 and 8000)');
  await db.schema.alterTable('PartnerMessage', t => { t.unique(['tenantId', 'partnerId', 'id']); });
  await db.schema.createTable('PartnerMessageAttachment', t => {
    t.string('id', 32).primary();
    t.string('tenantId', 32).notNullable().references('id').inTable('Tenant').onDelete('CASCADE');
    t.string('partnerId', 32).notNullable();
    t.string('messageId', 32).nullable();
    t.string('uploaderRole', 16).notNullable();
    t.string('name', 255).notNullable();
    t.string('contentType', 100).notNullable();
    t.integer('size').notNullable();
    // Keeping bounded private attachments in the database also makes exports
    // self-contained, without public upload URLs or a separate storage service.
    t.text('data').notNullable();
    t.timestamp('createdAt', { useTz: true }).notNullable().defaultTo(db.fn.now());
    t.foreign(['tenantId', 'partnerId']).references(['tenantId', 'id']).inTable('Partner').onDelete('CASCADE');
    t.foreign(['tenantId', 'partnerId', 'messageId']).references(['tenantId', 'partnerId', 'id']).inTable('PartnerMessage').onDelete('CASCADE');
    t.index(['tenantId', 'partnerId', 'messageId']);
    t.check("\"uploaderRole\" in ('partner', 'admin')");
    t.check('size between 1 and 10485760');
    t.check('char_length(data) <= 13981016');
  });
  await db.raw('alter table "PartnerMessageAttachment" enable row level security');
  await db.raw('alter table "PartnerMessageAttachment" force row level security');
  await db.raw(`create policy tenant_isolation on "PartnerMessageAttachment" using ("tenantId" = current_setting('app.tenant_id', true)) with check ("tenantId" = current_setting('app.tenant_id', true))`);
  await db.raw(`do $$ begin if exists(select 1 from pg_roles where rolname='openpartner_app') then execute 'grant select, insert, update, delete on "PartnerMessageAttachment" to openpartner_app'; end if; end $$;`);
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTable('PartnerMessageAttachment');
  await db.schema.alterTable('PartnerMessage', t => { t.dropUnique(['tenantId', 'partnerId', 'id']); });
  await db.raw('alter table "PartnerMessage" drop constraint "PartnerMessage_body_length"');
  await db.raw('alter table "PartnerMessage" add constraint "PartnerMessage_body_length" check (char_length(body) between 1 and 8000)');
}
