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
  return `${materialFormats.find(f=>f.id===formatId)?.name??formatName} · ${day.split('-').reverse().join('.')} · №${ordinal}`;
}

export async function ownedMaterial(db:Knex,tenantId:string,partnerId:string,id:string) {
  const material:PartnerMaterialRow|undefined=await db<PartnerMaterialRow>('PartnerMaterial').where({tenantId,partnerId,id}).select('*',db.raw('to_char("scheduledDay",\'YYYY-MM-DD\') as "scheduledDay"')).first();
  if(!material)throw new LinkError('material_not_found',404,'Материал не найден.');
  return material;
}

export async function materialView(db:Knex,tenantId:string,partnerId:string,id:string) {
  const material=await ownedMaterial(db,tenantId,partnerId,id);
  const placements=await db('PartnerLinkSource as s').join('Link as l',function(){this.on('l.id','=','s.linkId').andOn('l.tenantId','=','s.tenantId').andOn('l.partnerId','=','s.partnerId');})
    .where({'s.tenantId':tenantId,'s.partnerId':partnerId,'s.materialId':id}).select('s.*','l.linkKey').orderBy('s.createdAt');
  return {material,placements:placements.map(source=>({...source,params:trackingSourceParams(source)}))};
}

export async function createMaterial(db:Knex,tenantId:string,partnerId:string,input:{id?:string;programId:string;scenarioId?:string|null;title:string;formatId:string;platforms?:Array<{id:string;name:string}>}) {
  await assertPartner(db,tenantId,partnerId);
  await assertProgram(db,tenantId,partnerId,input.programId);
  if(input.scenarioId&&!await db('CoachForecastSnapshot').where({tenantId,partnerId,programId:input.programId,status:'confirmed'}).whereRaw("COALESCE(data->>'scenarioId',id)=?",[input.scenarioId]).first())throw new LinkError('scenario_not_found',404,'Сценарий не найден.');
  const format=materialFormats.find(f=>f.id===input.formatId)??(await analyticsSourceOptions(db,tenantId,[partnerId],input.programId)).formats.find(f=>f.id===input.formatId);
  if(!format)throw new LinkError('invalid_format',422,'Выберите формат материала.');
  const id=input.id??ulid();
  const existing=await db<PartnerMaterialRow>('PartnerMaterial').where({id,tenantId,partnerId}).first();
  if(existing){
    if(existing.title!==input.title||existing.programId!==input.programId||existing.formatId!==input.formatId||existing.scenarioId!==(input.scenarioId??null))throw new LinkError('request_conflict',409,'Этот запрос уже использован для другого материала.');
    return existing;
  }
  const [material]=await db<PartnerMaterialRow>('PartnerMaterial').insert({id,tenantId,partnerId,programId:input.programId,scenarioId:input.scenarioId??null,title:input.title,customTitle:true,formatId:format.id,formatName:format.name,platforms:JSON.stringify(input.platforms??[]) as any}).returning('*');
  return material!;
}

/** A default placement is reusable; an explicit additional placement gets its own key. */
export async function materialSource(db:Knex,tenantId:string,partnerId:string,linkId:string,material:PartnerMaterialRow,platform:{id:string;name:string},requestId?:string) {
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
