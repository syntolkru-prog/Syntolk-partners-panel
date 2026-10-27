import type {Knex} from 'knex';
export async function up(db:Knex):Promise<void>{
  await db.schema.alterTable('PartnerMaterial',table=>{table.timestamp('preparedAt',{useTz:true}).nullable();});
}
export async function down():Promise<void>{throw new Error('Material readiness history must be preserved.');}
