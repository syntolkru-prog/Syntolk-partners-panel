import type { Knex } from 'knex';
import { COACH_TABLES } from '../src/coach.js';
export async function up(db: Knex): Promise<void> {
  await db.raw('alter table "Partner" add constraint coach_partner_owner_unique unique ("tenantId", id)');
  await db.raw('alter table "Program" add constraint coach_program_owner_unique unique ("tenantId", id)');
  await db.raw('alter table "Link" add constraint coach_link_owner_unique unique ("tenantId", "partnerId", id)');
  for (const name of COACH_TABLES) {
    await db.raw(`alter table "${name}" add constraint "${name}_owner_unique" unique ("tenantId", "partnerId", id)`);
    await db.raw(`alter table "${name}" add constraint "${name}_partner_owner_fk" foreign key ("tenantId", "partnerId") references "Partner" ("tenantId", id) on delete cascade`);
    await db.raw(`alter table "${name}" add constraint "${name}_program_owner_fk" foreign key ("tenantId", "programId") references "Program" ("tenantId", id)`);
  }
  for (const [table,column,parent] of [['CoachTask','planId','CoachPlan'],['CoachPlacement','taskId','CoachTask'],['CoachPlacement','linkId','Link'],['CoachReview','taskId','CoachTask'],['CoachReview','runId','CoachRun']]) {
    await db.raw(`alter table "${table}" add constraint "${table}_${column}_owner_fk" foreign key ("tenantId", "partnerId", "${column}") references "${parent}" ("tenantId", "partnerId", id)`);
  }
}
export async function down(db: Knex): Promise<void> {
  for (const [table,column] of [['CoachTask','planId'],['CoachPlacement','taskId'],['CoachPlacement','linkId'],['CoachReview','taskId'],['CoachReview','runId']]) await db.raw(`alter table "${table}" drop constraint "${table}_${column}_owner_fk"`);
  for (const name of COACH_TABLES) for (const suffix of ['partner_owner_fk','program_owner_fk','owner_unique']) await db.raw(`alter table "${name}" drop constraint "${name}_${suffix}"`);
  await db.raw('alter table "Link" drop constraint coach_link_owner_unique');await db.raw('alter table "Program" drop constraint coach_program_owner_unique');await db.raw('alter table "Partner" drop constraint coach_partner_owner_unique');
}
