import type { Knex } from 'knex';
import { ulid } from 'ulid';
import { createHash } from 'node:crypto';
import { trackingSourceParams, type LinkRow, type PartnerMaterialRow, type PartnerLinkSourceRow } from '@openpartner/db';
import { LinkError } from './links-service.js';
import { assertPartner, assertProgram } from './coach/policy.js';
import {analyticsSourceOptions} from './analytics-source-options.js';

export const materialFormats = [
  {id:'post',name:'Пост'},{id:'short',name:'Короткое видео'},{id:'long',name:'Длинное видео'},
  {id:'article',name:'Статья'},{id:'circle',name:'Кружочек'},
];

export function calendarMaterialTitle(formatId:string,formatName:string,day:string,ordinal:number) {
  return `${formatName||materialFormats.find(f=>f.id===formatId)?.name||formatId} · ${day.split('-').reverse().join('.')} · №${ordinal}`;
}

export async function ownedMaterial(db:Knex,tenantId:string,partnerId:string,id:string) {
  const material:PartnerMaterialRow|undefined=await db<PartnerMaterialRow>('PartnerMaterial').where({tenantId,partnerId,id}).select('*',db.raw('to_char("scheduledDay",\'YYYY-MM-DD\') as "scheduledDay"')).first();
  if(!material)throw new LinkError('material_not_found',404,'Материал не найден.');
  return material;
}

export function assertMaterialActive(material:Pick<PartnerMaterialRow,'archivedAt'>){
  if(material.archivedAt)throw new LinkError('material_archived',409,'Материал удалён из календаря. История ссылок и статистика сохранены.');
}

export async function materialView(db:Knex,tenantId:string,partnerId:string,id:string) {
  const material=await ownedMaterial(db,tenantId,partnerId,id);
  const placements=await db('PartnerLinkSource as s').join('Link as l',function(){this.on('l.id','=','s.linkId').andOn('l.tenantId','=','s.tenantId').andOn('l.partnerId','=','s.partnerId');})
    .where({'s.tenantId':tenantId,'s.partnerId':partnerId,'s.materialId':id}).select('s.*','l.linkKey').orderBy('s.createdAt');
  const files=await db('PartnerMaterialFile').where({tenantId,partnerId,materialId:id}).select('id','name','contentType','size','createdAt').orderBy('createdAt');
  const tasks=await db('CoachTask').where({tenantId,partnerId}).whereRaw("COALESCE(data->>'materialId',id)=?",[id]).orderBy('createdAt','desc').select('status','data');
  // Older materials omitted URLs, but their calculator tasks retained the saved placements.
  const plannedPlatforms=tasks.flatMap(task=>Array.isArray(task.data?.placements)?task.data.placements:[]);
  const platforms=material.platforms.map(platform=>{
    const saved=plannedPlatforms.find(item=>item.id===platform.id);
    return {...platform,...(!platform.url&&typeof saved?.url==='string'?{url:saved.url}:{})};
  });
  return {material:{...material,platforms,ready:!!material.preparedAt||tasks.some(task=>task.status==='completed')||placements.some(p=>p.publishedAt)},files,placements:placements.map(source=>({...source,params:trackingSourceParams(source)}))};
}

/** Publishing also proves preparation; keep the calendar and daily tasks in sync. */
export async function recordMaterialPublication(db:Knex,tenantId:string,partnerId:string,id:string,publishedAt:Date){
  await db('Partner').where({tenantId,id:partnerId}).forUpdate().first();
  let material=await db<PartnerMaterialRow>('PartnerMaterial').where({tenantId,partnerId,id}).forUpdate().first();
  if(!material)throw new LinkError('material_not_found',404,'Материал не найден.');
  assertMaterialActive(material);
  if(!material.preparedAt){
    [material]=await db<PartnerMaterialRow>('PartnerMaterial').where({tenantId,partnerId,id}).update({preparedAt:publishedAt,revision:db.raw('revision + 1'),updatedAt:new Date()}).returning('*');
  }
  const tasks=await db('CoachTask').where({tenantId,partnerId,programId:material!.programId})
    .whereNotIn('status',['completed','cancelled']).whereRaw("COALESCE(data->>'materialId',id)=?",[id]).forUpdate();
  for(const task of tasks)await db('CoachTask').where({tenantId,partnerId,id:task.id}).update({status:'completed',version:task.version+1,updatedAt:new Date(),data:JSON.stringify({...task.data,completion:{at:publishedAt.toISOString(),verificationLevel:'partner_self_report'}})});
  return material!;
}

export async function createMaterial(db:Knex,tenantId:string,partnerId:string,input:{id?:string;programId:string;scenarioId?:string|null;title:string;formatId:string;platforms?:Array<{id:string;name:string}>;content?:string;scheduledDay?:string|null}) {
  await assertPartner(db,tenantId,partnerId);
  await assertProgram(db,tenantId,partnerId,input.programId);
  if(input.scenarioId&&!await db('CoachForecastSnapshot').where({tenantId,partnerId,programId:input.programId,status:'confirmed'}).whereRaw("COALESCE(data->>'scenarioId',id)=?",[input.scenarioId]).first())throw new LinkError('scenario_not_found',404,'Сценарий не найден.');
  const catalog=await analyticsSourceOptions(db,tenantId,[partnerId],input.programId,input.scenarioId?[input.scenarioId]:[]);
  const format=catalog.formats.find(f=>f.id===input.formatId);
  if(!format)throw new LinkError('invalid_format',422,'Выберите формат материала.');
  const id=input.id??ulid();
  const existing=await db<PartnerMaterialRow>('PartnerMaterial').where({id,tenantId,partnerId}).first();
  if(existing){
    assertMaterialActive(existing);
    if(existing.title!==input.title||existing.programId!==input.programId||existing.formatId!==input.formatId||existing.scenarioId!==(input.scenarioId??null))throw new LinkError('request_conflict',409,'Этот запрос уже использован для другого материала.');
    return existing;
  }
  const platforms=(input.platforms??[]).map(platform=>{const url=catalog.platforms.find(item=>item.id===platform.id)?.url;return {...platform,...(url?{url}:{})};});
  const [material]=await db<PartnerMaterialRow>('PartnerMaterial').insert({id,tenantId,partnerId,programId:input.programId,scenarioId:input.scenarioId??null,title:input.title,customTitle:true,formatId:format.id,formatName:format.name,platforms:JSON.stringify(platforms) as any,content:input.content??'',scheduledDay:input.scheduledDay??null}).returning('*');
  return material!;
}

/** A default placement is reusable; an explicit additional placement gets its own key. */
export async function materialSource(db:Knex,tenantId:string,partnerId:string,linkId:string,material:PartnerMaterialRow,platform:{id:string;name:string},requestId?:string) {
  // Serialize first source creation with assigning an undated preparation.
  await db('Partner').where({tenantId,id:partnerId}).forUpdate().first();
  const current=await db<PartnerMaterialRow>('PartnerMaterial').where({tenantId,partnerId,id:material.id}).forUpdate().first();
  if(!current)throw new LinkError('material_not_found',404,'Материал не найден.');
  if(current.assignedToMaterialId)throw new LinkError('material_assigned',409,'Заготовка уже прикреплена. Откройте задачу в плане.');
  assertMaterialActive(current);
  material=current;
  const link=await db<LinkRow>('Link').where({id:linkId,tenantId,partnerId,programId:material.programId}).first();
  if(!link)throw new LinkError('link_not_found',404,'Выберите ссылку этой программы.');
  const identity=[partnerId,material.programId,linkId,material.scenarioId??'__none__',material.formatId,platform.id,material.id];
  if(requestId)identity.push(requestId);
  const sourceKey=createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const existing=await db<PartnerLinkSourceRow>('PartnerLinkSource').where({tenantId,sourceKey}).first();
  if(existing)return {source:existing,params:trackingSourceParams(existing)};
  await assertPartner(db,tenantId,partnerId);
  await assertProgram(db,tenantId,partnerId,material.programId);
  const snapshot=material.scenarioId?await db('CoachForecastSnapshot').where({tenantId,partnerId,programId:material.programId}).whereRaw("COALESCE(data->>'scenarioId',id)=?",[material.scenarioId]).orderBy('createdAt','desc').first():null;
  await db<PartnerLinkSourceRow>('PartnerLinkSource').insert({id:ulid(),tenantId,partnerId,programId:material.programId,linkId,sourceKey,
    scenarioId:material.scenarioId,scenarioName:snapshot?.data.scenarioName??null,formatId:material.formatId,formatName:material.formatName,
    platformId:platform.id,platformName:platform.name,materialId:material.id,materialTitle:material.title,
  }).onConflict(['tenantId','sourceKey']).ignore();
  const source=(await db<PartnerLinkSourceRow>('PartnerLinkSource').where({tenantId,sourceKey}).first())!;
  return {source,params:trackingSourceParams(source)};
}
