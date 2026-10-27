import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { Knex } from 'knex';
import { trackingSourceParams, type LinkRow, type PartnerLinkSourceRow, type PartnerMaterialRow } from '@openpartner/db';
import { LinkError } from './links-service.js';
import { calculateCoachForecast } from './coach/forecast-adapter.js';
import { materialSource } from './materials-service.js';

export const trackingSourceSchema = z.object({
  scenarioId: z.string().min(1).max(100), formatId: z.string().min(1).max(100),
  platformId: z.string().min(1).max(100), materialId: z.string().min(1).max(32).optional(),
}).strict();

export async function partnerTrackingSources(db: Knex, tenantId: string, partnerId: string, programId?: string, scenarioId?: string) {
  const sources=await db('PartnerLinkSource as s')
    .leftJoin('PartnerMaterial as m',function(){this.on('m.id','=','s.materialId').andOn('m.tenantId','=','s.tenantId').andOn('m.partnerId','=','s.partnerId').andOn('m.programId','=','s.programId');})
    .leftJoin('Link as l',function(){this.on('l.id','=','s.linkId').andOn('l.tenantId','=','s.tenantId').andOn('l.partnerId','=','s.partnerId').andOn('l.programId','=','s.programId');})
    .where({'s.tenantId':tenantId,'s.partnerId':partnerId})
    .modify(q=>{if(programId)q.where('s.programId',programId);if(scenarioId)q.where('s.scenarioId',scenarioId);})
    .select('s.*','l.linkKey','m.archivedAt as materialArchivedAt',db.raw('COALESCE(m.title,s."materialTitle") as "materialTitle"'),db.raw('s."materialId" IS NOT NULL AND m.id IS NULL AS "materialDeleted"'))
    .orderBy('s.createdAt','desc') as Array<PartnerLinkSourceRow&{linkKey:string|null;materialArchivedAt:Date|null}>;
  return sources.map(source=>({...source,params:trackingSourceParams(source)}));
}

export async function createTrackingSource(db: Knex, tenantId: string, partnerId: string, linkId: string, input: z.infer<typeof trackingSourceSchema>) {
  const link = await db<LinkRow>('Link').where({ id: linkId, tenantId, partnerId }).first();
  if (!link) throw new LinkError('link_not_found', 404, 'Ссылка не найдена.');
  const sourceKey = createHash('sha256').update(JSON.stringify([partnerId, link.programId, linkId, input.scenarioId, input.formatId, input.platformId, input.materialId ?? ''])).digest('hex');
  const existing = await db<PartnerLinkSourceRow>('PartnerLinkSource').where({ tenantId, sourceKey }).first();
  if (existing) return { source: existing, params: trackingSourceParams(existing) };

  const partner = await db('Partner').where({ id: partnerId, tenantId }).first();
  if (partner?.revokedAt) throw new LinkError('partner_revoked', 403, 'Доступ партнёра отозван.');
  if(input.materialId){
    const material=await db<PartnerMaterialRow>('PartnerMaterial').where({id:input.materialId,tenantId,partnerId,programId:link.programId}).first();
    if(material){
      const platform=material.platforms.find(p=>p.id===input.platformId);
      if((material.scenarioId??'__none__')!==input.scenarioId||material.formatId!==input.formatId||!platform)throw new LinkError('material_not_found',404,'Материал не относится к выбранной площадке.');
      return materialSource(db,tenantId,partnerId,linkId,material,platform);
    }
  }
  const snapshot = await db('CoachForecastSnapshot').where({ tenantId, partnerId, programId: link.programId, status: 'confirmed' })
    .whereRaw("COALESCE(data->>'scenarioId', id) = ?", [input.scenarioId]).orderBy('createdAt', 'desc').first();
  if (!snapshot) throw new LinkError('scenario_not_found', 404, 'Сохранённый сценарий не найден.');
  let settings = snapshot.data.settings;
  let materialTitle: string | null = null;
  if (input.materialId) {
    const task = await db('CoachTask as t').join('CoachPlan as p', 'p.id', 't.planId')
      .where({ 't.id': input.materialId, 't.tenantId': tenantId, 't.partnerId': partnerId, 't.programId': link.programId, 'p.tenantId': tenantId, 'p.partnerId': partnerId })
      .select('t.data', 'p.data as planData').first();
    if (!task || String(task.planData.scenarioId ?? task.planData.snapshotId) !== input.scenarioId || task.data.kind !== 'content' || task.data.format !== input.formatId || !task.data.placements?.some((p: { id: string }) => p.id === input.platformId)) {
      throw new LinkError('material_not_found', 404, 'Материал не относится к выбранному сценарию и площадке.');
    }
    settings = task.planData.settings;
    materialTitle = `${task.data.scheduledDay} · ${task.data.title}`;
  }
  const forecast = await calculateCoachForecast(settings);
  const format = forecast.formats.find((f: { id: string }) => f.id === input.formatId);
  const platform = forecast.channels.find((p: { id: string }) => p.id === input.platformId);
  const configured = forecast.settings.channels[input.platformId];
  if (!format || !platform || !configured?.enabled || !configured.formats.includes(input.formatId) || !(forecast.settings.frequency[input.formatId] > 0)) {
    throw new LinkError('source_not_selected', 422, 'Этот формат и площадка не выбраны в сохранённом сценарии.');
  }
  await db<PartnerLinkSourceRow>('PartnerLinkSource').insert({
    id: ulid(), tenantId, partnerId, programId: link.programId, linkId, sourceKey,
    scenarioId: input.scenarioId, formatId: input.formatId, platformId: input.platformId, materialId: input.materialId ?? null,
    scenarioName: String(snapshot.data.scenarioName ?? 'Сценарий').slice(0, 120),
    formatName: String(format.name).slice(0, 120), platformName: String(platform.name).slice(0, 120), materialTitle: materialTitle?.slice(0, 200) ?? null,
  }).onConflict(['tenantId', 'sourceKey']).ignore();
  const source = (await db<PartnerLinkSourceRow>('PartnerLinkSource').where({ tenantId, sourceKey }).first())!;
  return { source, params: trackingSourceParams(source) };
}
