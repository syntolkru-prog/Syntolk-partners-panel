import type {Knex} from 'knex';
export async function up(db:Knex):Promise<void>{
  await db.schema.alterTable('PartnerMaterial',table=>{
    table.string('scheduledTime',5).nullable();
    table.boolean('reminderEnabled').notNullable().defaultTo(true);
    table.string('assignedToMaterialId',32).nullable();
  });
}
export async function down():Promise<void>{throw new Error('Calendar scheduling and assignment history must be preserved.');}
