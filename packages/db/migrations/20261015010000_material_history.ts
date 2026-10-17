import type { Knex } from 'knex';

export async function up(db:Knex):Promise<void> {
  await db.schema.alterTable('PartnerMaterial',t=>{
    t.boolean('customTitle').notNullable().defaultTo(false);
    t.dropForeign(['tenantId','partnerId']);
    t.foreign(['tenantId','partnerId']).references(['tenantId','id']).inTable('Partner').onDelete('CASCADE');
  });
  await db.raw(`UPDATE "PartnerMaterial" SET title=regexp_replace(title,' · [0-9]{4}-[0-9]{2}-[0-9]{2} · ([0-9]+)$',' · ' || to_char("scheduledDay",'DD.MM.YYYY') || ' · №\\1')
    WHERE "scheduledDay" IS NOT NULL AND title ~ ' · [0-9]{4}-[0-9]{2}-[0-9]{2} · [0-9]+$'`);
}

export async function down():Promise<void> {
  throw new Error('Material history must be preserved.');
}
