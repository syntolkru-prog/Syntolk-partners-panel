import type { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('PartnerMaterial', t => {
    t.string('id',32).primary();
    t.string('tenantId',32).notNullable();
    t.string('partnerId',32).notNullable();
    t.string('programId',32).notNullable();
    t.string('scenarioId',100).nullable();
    t.string('title',200).notNullable();
    t.string('formatId',100).notNullable();
    t.string('formatName',120).notNullable();
    t.date('scheduledDay').nullable();
    t.jsonb('platforms').notNullable().defaultTo('[]');
    t.timestamp('archivedAt',{useTz:true}).nullable();
    t.timestamp('createdAt',{useTz:true}).notNullable().defaultTo(db.fn.now());
    t.timestamp('updatedAt',{useTz:true}).notNullable().defaultTo(db.fn.now());
    t.unique(['tenantId','partnerId','id']);
    t.foreign(['tenantId','partnerId']).references(['tenantId','id']).inTable('Partner');
    t.foreign(['tenantId','programId']).references(['tenantId','id']).inTable('Program');
    t.index(['tenantId','partnerId','programId','scenarioId']);
  });
  await db.raw('alter table "PartnerMaterial" enable row level security');
  await db.raw('alter table "PartnerMaterial" force row level security');
  await db.raw(`create policy tenant_isolation on "PartnerMaterial" using ("tenantId" = current_setting('app.tenant_id', true)) with check ("tenantId" = current_setting('app.tenant_id', true))`);
  await db.raw(`do $$ begin if exists(select 1 from pg_roles where rolname='openpartner_app') then execute 'grant select, insert, update, delete on "PartnerMaterial" to openpartner_app'; end if; end $$;`);
  await db.schema.alterTable('PartnerLinkSource', t => {
    t.string('scenarioId',100).nullable().alter();
    t.string('scenarioName',120).nullable().alter();
    t.string('publicationUrl',2048).nullable();
    t.string('channelName',120).nullable();
    t.timestamp('publishedAt',{useTz:true}).nullable();
  });
  // Keep legacy material IDs and all URL parameters unchanged.
  await db.raw(`INSERT INTO "PartnerMaterial" (id,"tenantId","partnerId","programId","scenarioId",title,"formatId","formatName","scheduledDay",platforms,"createdAt")
    SELECT id,"tenantId","partnerId","programId","scenarioId",
      CASE WHEN title ~ ' · материал [0-9]+$' THEN "formatName" || ' · ' || "scheduledDay" || ' · ' || ordinal ELSE title END,
      format,"formatName",NULLIF("scheduledDay",'')::date,platforms,"createdAt"
    FROM (SELECT t.id,t."tenantId",t."partnerId",t."programId",COALESCE(p.data->>'scenarioId',p.data->>'snapshotId') AS "scenarioId",
      t.data->>'title' AS title,t.data->>'format' AS format,
      CASE t.data->>'format' WHEN 'post' THEN 'Пост' WHEN 'short' THEN 'Короткое видео' WHEN 'long' THEN 'Длинное видео' WHEN 'article' THEN 'Статья' WHEN 'circle' THEN 'Кружочек' ELSE regexp_replace(t.data->>'title',' · материал [0-9]+$','') END AS "formatName",
      t.data->>'scheduledDay' AS "scheduledDay",COALESCE(t.data->'placements','[]'::jsonb) AS platforms,t."createdAt",
      row_number() OVER (PARTITION BY t."planId",t.data->>'scheduledDay',t.data->>'format' ORDER BY t."createdAt",t.id) AS ordinal
      FROM "CoachTask" t JOIN "CoachPlan" p ON p.id=t."planId" AND p."tenantId"=t."tenantId" AND p."partnerId"=t."partnerId"
      WHERE t.data->>'kind'='content' AND p.data->>'source'='calculator_schedule_v1'
      AND (t.status<>'cancelled' OR EXISTS(SELECT 1 FROM "PartnerLinkSource" s WHERE s."tenantId"=t."tenantId" AND s."partnerId"=t."partnerId" AND s."materialId"=t.id))) legacy
    ON CONFLICT (id) DO NOTHING`);
}

export async function down(): Promise<void> {
  throw new Error('Material history must be preserved; restore a backup instead of rolling back.');
}
