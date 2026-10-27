import type {Knex} from 'knex';

/** Remove only the retired calendar reminder feature. Publication schedules stay intact. */
export async function up(db:Knex):Promise<void>{
  await db('CoachNotification')
    .whereRaw('left("dedupeKey", 9) = ?', ['calendar:'])
    .whereRaw("data->>'kind' = ?", ['calendar_publication'])
    .del();
  const prefix='calendar_reminders:';
  await db('Config').whereRaw('left(key, ?) = ?', [prefix.length,prefix]).del();
  if(await db.schema.hasColumn('PartnerMaterial','reminderEnabled')){
    await db.schema.alterTable('PartnerMaterial',table=>{table.dropColumn('reminderEnabled');});
  }
}

export async function down():Promise<void>{
  throw new Error('Retired reminder settings and notifications cannot be restored by rollback.');
}
