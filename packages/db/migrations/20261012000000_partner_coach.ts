import type { Knex } from 'knex';

export const COACH_TABLES = ['CoachProfile', 'CoachPlan', 'CoachTask', 'CoachPlacement', 'CoachMessage', 'CoachRun', 'CoachReview', 'CoachNotification', 'CoachAuditEvent', 'CoachKnowledgeItem', 'CoachForecastSnapshot'] as const;

export async function up(db: Knex): Promise<void> {
  for (const name of COACH_TABLES) {
    await db.schema.createTable(name, t => {
      t.string('id', 32).primary();
      t.string('tenantId', 32).notNullable().references('id').inTable('Tenant').onDelete('CASCADE');
      t.string('partnerId', 32).references('id').inTable('Partner').onDelete('CASCADE');
      t.string('programId', 32).references('id').inTable('Program');
      t.string('status', 32).notNullable();
      t.integer('version').notNullable().defaultTo(1);
      t.jsonb('data').notNullable().defaultTo('{}');
      t.timestamp('createdAt', { useTz: true }).notNullable().defaultTo(db.fn.now());
      t.timestamp('updatedAt', { useTz: true }).notNullable().defaultTo(db.fn.now());
      t.index(['tenantId', 'partnerId', 'createdAt']);
      if (name === 'CoachProfile') t.unique(['tenantId', 'partnerId']);
      if (name === 'CoachPlan') { t.date('weekStart').notNullable(); t.index(['tenantId', 'partnerId', 'status']); }
      if (name === 'CoachTask') {
        t.string('planId', 32).notNullable().references('id').inTable('CoachPlan').onDelete('CASCADE');
        t.integer('minutes').notNullable(); t.timestamp('dueAt', { useTz: true });
        t.index(['tenantId', 'partnerId', 'status', 'dueAt']);
      }
      if (name === 'CoachPlacement') {
        t.string('taskId', 32).notNullable().references('id').inTable('CoachTask').onDelete('CASCADE');
        t.string('linkId', 32).notNullable().references('id').inTable('Link');
        t.unique(['tenantId', 'partnerId', 'taskId']);
      }
      if (name === 'CoachMessage') { t.string('clientMessageId', 120); t.string('role', 24).notNullable(); t.unique(['tenantId', 'partnerId', 'clientMessageId']); }
      if (name === 'CoachRun') {
        t.string('kind', 24).notNullable(); t.string('dedupeKey', 120).notNullable();
        t.integer('attempts').notNullable().defaultTo(0); t.timestamp('availableAt', { useTz: true }).notNullable().defaultTo(db.fn.now());
        t.timestamp('leaseUntil', { useTz: true }); t.string('lockedBy', 64);
        t.unique(['tenantId', 'partnerId', 'dedupeKey']); t.index(['status', 'availableAt']);
      }
      if (name === 'CoachReview') { t.string('taskId', 32).notNullable().references('id').inTable('CoachTask').onDelete('CASCADE'); t.string('runId', 32).references('id').inTable('CoachRun'); t.unique(['runId']); }
      if (name === 'CoachNotification') { t.string('dedupeKey', 120).notNullable(); t.timestamp('scheduledAt', { useTz: true }).notNullable().defaultTo(db.fn.now()); t.unique(['tenantId', 'partnerId', 'dedupeKey']); }
    });
    await db.raw(`alter table "${name}" enable row level security`);
    await db.raw(`alter table "${name}" force row level security`);
    await db.raw(`create policy tenant_isolation on "${name}" using ("tenantId" = current_setting('app.tenant_id', true)) with check ("tenantId" = current_setting('app.tenant_id', true))`);
    await db.raw(`do $$ begin if exists(select 1 from pg_roles where rolname='openpartner_app') then execute 'grant select, insert, update, delete on "${name}" to openpartner_app'; end if; end $$;`);
    if (!['CoachKnowledgeItem', 'CoachAuditEvent'].includes(name)) await db.raw(`alter table "${name}" add check ("partnerId" is not null)`);
  }
  await db.raw('alter table "CoachTask" add check (minutes > 0 and minutes <= 240)');
  // New feature remains off until explicitly enabled for a tenant in its settings.
}

export async function down(db: Knex): Promise<void> {
  for (const name of [...COACH_TABLES].reverse()) await db.schema.dropTable(name);
}
