import type { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('Partner',t=>{t.string('publisherLinkBase',2048).nullable();t.timestamp('publisherLinkVerifiedAt',{useTz:true}).nullable();});
  await db.schema.alterTable('PartnerMaterial', t => {
    t.text('content').notNullable().defaultTo('');
    t.integer('revision').notNullable().defaultTo(1);
  });
  await db.schema.createTable('PartnerMaterialFile', t => {
    t.string('id',32).primary();
    t.string('tenantId',32).notNullable();
    t.string('partnerId',32).notNullable();
    t.string('materialId',32).notNullable();
    t.string('name',255).notNullable();
    t.string('contentType',100).notNullable();
    t.integer('size').notNullable();
    t.text('data').notNullable();
    t.timestamp('createdAt',{useTz:true}).notNullable().defaultTo(db.fn.now());
    t.foreign(['tenantId','partnerId','materialId']).references(['tenantId','partnerId','id']).inTable('PartnerMaterial').onDelete('CASCADE');
    t.index(['tenantId','partnerId','materialId']);
  });
  await db.schema.createTable('PublisherAccount', t => {
    t.string('id',32).primary();
    t.string('tenantId',32).notNullable();
    t.string('partnerId',32).notNullable();
    t.string('name',120).notNullable();
    t.string('url',2048).notNullable();
    t.string('editorUrl',2048).notNullable();
    t.string('platformId',100).notNullable();
    t.string('platformName',120).notNullable();
    t.text('instructions').notNullable().defaultTo('');
    t.string('status',30).notNullable().defaultTo('new');
    t.timestamp('createdAt',{useTz:true}).notNullable().defaultTo(db.fn.now());
    t.timestamp('updatedAt',{useTz:true}).notNullable().defaultTo(db.fn.now());
    t.unique(['tenantId','partnerId','id']);
    t.foreign(['tenantId','partnerId']).references(['tenantId','id']).inTable('Partner').onDelete('CASCADE');
  });
  await db.schema.createTable('PublicationJob', t => {
    t.string('id',32).primary();
    t.string('tenantId',32).notNullable();
    t.string('partnerId',32).notNullable();
    t.string('programId',32).notNullable();
    t.string('materialId',32).notNullable();
    t.string('accountId',32).notNullable();
    t.string('sourceId',32).notNullable();
    t.string('status',30).notNullable().defaultTo('queued');
    t.jsonb('data').notNullable();
    t.string('publicationUrl',2048).nullable();
    t.string('message',500).nullable();
    t.timestamp('startedAt',{useTz:true}).nullable();
    t.timestamp('finishedAt',{useTz:true}).nullable();
    t.timestamp('createdAt',{useTz:true}).notNullable().defaultTo(db.fn.now());
    t.unique(['tenantId','partnerId','materialId','accountId']);
    t.foreign(['tenantId','partnerId','materialId']).references(['tenantId','partnerId','id']).inTable('PartnerMaterial').onDelete('CASCADE');
    t.foreign(['tenantId','partnerId','accountId']).references(['tenantId','partnerId','id']).inTable('PublisherAccount');
    t.foreign(['tenantId','partnerId','sourceId']).references(['tenantId','partnerId','id']).inTable('PartnerLinkSource');
    t.index(['status','createdAt']);
  });
  for(const table of ['PartnerMaterialFile','PublisherAccount','PublicationJob']){
    await db.raw('alter table ?? enable row level security',[table]);
    await db.raw('alter table ?? force row level security',[table]);
    await db.raw(`create policy tenant_isolation on ?? using ("tenantId"=current_setting('app.tenant_id',true)) with check ("tenantId"=current_setting('app.tenant_id',true))`,[table]);
    await db.raw(`do $$ begin if exists(select 1 from pg_roles where rolname='openpartner_app') then execute 'grant select, insert, update, delete on "${table}" to openpartner_app'; end if; end $$;`);
  }
}
export async function down():Promise<void>{throw new Error('Publication history is preserved; restore a backup instead.');}
