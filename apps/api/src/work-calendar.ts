import type {Knex} from 'knex';
import {ulid} from 'ulid';
import {LinkError} from './links-service.js';
import {ownedMaterial,assertMaterialActive} from './materials-service.js';
import {assertPartner,assertProgram} from './coach/policy.js';
import {localDay} from './coach/daily-plan.js';

export const MATERIAL_FILE_LIMIT=100*1024*1024;
export const MATERIAL_TOTAL_LIMIT=250*1024*1024;
export const MATERIAL_FILE_TYPES=['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','audio/mpeg','audio/ogg','application/pdf','text/plain'];
export function validateMaterialFile(name:string,type:string,body:Buffer){
  if(!name.trim()||name.length>255||/[\x00-\x1f\\/]/.test(name))throw new LinkError('invalid_filename',422,'Недопустимое имя файла.');
  if(!body.length||body.length>MATERIAL_FILE_LIMIT)throw new LinkError('file_size',422,'Размер файла: от 1 байта до 100 МБ.');
  const starts=(bytes:number[])=>bytes.every((value,index)=>body[index]===value);
  const valid=type==='image/jpeg'?starts([255,216,255]):type==='image/png'?starts([137,80,78,71,13,10,26,10]):type==='image/gif'?/^GIF8[79]a/.test(body.subarray(0,6).toString()):type==='image/webp'?body.subarray(0,4).toString()==='RIFF'&&body.subarray(8,12).toString()==='WEBP':type==='video/mp4'?body.subarray(4,8).toString()==='ftyp':type==='video/webm'?starts([26,69,223,163]):type==='application/pdf'?body.subarray(0,5).toString()==='%PDF-':type==='audio/ogg'?body.subarray(0,4).toString()==='OggS':type==='audio/mpeg'?body.subarray(0,3).toString()==='ID3'||body[0]===255&&((body[1]??0)&224)===224:type==='text/plain'?(()=>{try{new TextDecoder('utf-8',{fatal:true}).decode(body);return !body.includes(0);}catch{return false;}})():false;
  if(!valid)throw new LinkError('file_type',422,'Формат или содержимое файла не поддерживается.');
}

export async function workCalendar(db:Knex,tenantId:string,partnerId:string,programId:string,scenarioId?:string){
  await assertProgram(db,tenantId,partnerId,programId,false);
  const scope={tenantId,partnerId,programId};
  const materials:Array<{id:string;title:string;formatId:string;formatName:string;scenarioId:string|null;platforms:Array<{id:string;name:string}>;revision:number;preparedAt:Date|null;updatedAt:Date;scheduledDay:string|null;scheduledTime:string|null;hasContent:boolean}>=await db('PartnerMaterial').where(scope).whereNull('archivedAt').modify(q=>{
    if(scenarioId==='__none__')q.whereNull('scenarioId');else if(scenarioId)q.where({scenarioId});
  }).select('id','title','formatId','formatName','scenarioId','platforms','revision','preparedAt','updatedAt','scheduledTime',db.raw('to_char("scheduledDay",\'YYYY-MM-DD\') as "scheduledDay"'),db.raw('length(content)>0 as "hasContent"')).orderBy('scheduledDay').orderBy('createdAt');
  const ids=materials.map(m=>m.id);
  const [sources,files,tasks,profile,plans]=await Promise.all([
    ids.length?db('PartnerLinkSource').where(scope).whereIn('materialId',ids).select('id','materialId','platformId','publishedAt'):[],
    ids.length?db('PartnerMaterialFile').where({tenantId,partnerId}).whereIn('materialId',ids).select('materialId').count('* as count').groupBy('materialId'):[],
    ids.length?db('CoachTask').where(scope).whereNot('status','cancelled').whereRaw("COALESCE(data->>'materialId',id) = ANY(?::text[])",[ids]).select('id','status','data'):[],
    db('CoachProfile').where({tenantId,partnerId}).first(),
    db('CoachPlan').where({...scope,status:'active'}).whereRaw("data->>'source' = 'calculator_schedule_v1'").select('id','data'),
  ]);
  const today=localDay(new Date(),profile?.data?.timezone??'Europe/Moscow');
  return {today,plans:plans.map(plan=>({id:plan.id,startDate:plan.data.startDate,days:plan.data.days,scenarioId:plan.data.scenarioId,scenarioName:plan.data.scenarioName})),materials:materials.map(material=>{
    const placements=sources.filter(s=>s.materialId===material.id),completed=tasks.some(t=>(t.data.materialId??t.id)===material.id&&t.status==='completed');
    const published=placements.filter(s=>s.publishedAt).length,total=placements.length+material.platforms.filter(p=>!placements.some(s=>s.platformId===p.id)).length;
    const ready=!!material.preparedAt||completed||published>0;
    const status=total>0&&published>=total?'published':published>0?'partial':material.scheduledDay&&material.scheduledDay<today?'overdue':ready?'waiting':'draft';
    return {...material,ready,status,publishedPlacements:published,totalPlacements:total,fileCount:Number(files.find(f=>f.materialId===material.id)?.count??0)};
  })};
}

export async function updateMaterialWorkspace(db:Knex,tenantId:string,partnerId:string,id:string,input:{revision:number;title?:string;content?:string;scheduledDay?:string|null;scheduledTime?:string|null;ready?:boolean}){
  await assertPartner(db,tenantId,partnerId);
  // Match the legacy completion route's lock order before touching a task.
  await db('Partner').where({tenantId,id:partnerId}).forUpdate().first();
  const material=await ownedMaterial(db,tenantId,partnerId,id) as Awaited<ReturnType<typeof ownedMaterial>>&{revision:number;content:string;preparedAt:Date|null};
  await assertProgram(db,tenantId,partnerId,material.programId,false);
  const row=await db('PartnerMaterial').where({tenantId,partnerId,id}).forUpdate().first();
  if(row.assignedToMaterialId)throw new LinkError('material_assigned',409,'Заготовка уже прикреплена. Откройте задачу в плане.');
  assertMaterialActive(row);
  if(row.revision!==input.revision)throw new LinkError('revision_conflict',409,'Материал изменён в другой вкладке. Обновите карточку.');
  const published=await db('PartnerLinkSource').where({tenantId,partnerId,materialId:id}).whereNotNull('publishedAt').first();
  if(input.ready===false&&published)throw new LinkError('material_published',409,'У материала уже есть публикации. История готовности сохранена.');
  const patch:Record<string,unknown>={revision:row.revision+1,updatedAt:new Date()};
  if(input.title!==undefined){patch.title=input.title.trim();patch.customTitle=true;}
  if(input.content!==undefined)patch.content=input.content;
  if(input.scheduledDay!==undefined)patch.scheduledDay=input.scheduledDay;
  if(input.scheduledTime!==undefined)patch.scheduledTime=input.scheduledTime;
  if(input.title===undefined&&input.scheduledDay&&!row.customTitle&&/ · \d{2}\.\d{2}\.\d{4} · №\d+$/.test(row.title))patch.title=row.title.replace(/ · \d{2}\.\d{2}\.\d{4} · /,` · ${input.scheduledDay.split('-').reverse().join('.')} · `);
  if(input.ready===true||input.content!==undefined&&row.preparedAt&&input.ready!==false){
    const file=await db('PartnerMaterialFile').where({tenantId,partnerId,materialId:id}).first();
    if(!(input.content??row.content).trim()&&!file)throw new LinkError('material_empty',422,'Сначала добавьте текст или файл материала.');
    if(input.ready===true)patch.preparedAt=row.preparedAt??new Date();
  }else if(input.ready===false)patch.preparedAt=null;
  await db('PartnerMaterial').where({tenantId,partnerId,id}).update(patch);
  // Keep the old calculator tasks/homepage in sync without rebuilding a plan.
  const tasks=await db('CoachTask').where({tenantId,partnerId,programId:material.programId}).whereNot('status','cancelled').whereRaw("COALESCE(data->>'materialId',id)=?",[id]).forUpdate().select('*');
  for(const task of tasks){
    const data={...task.data};const taskPatch:Record<string,unknown>={version:task.version+1,updatedAt:new Date()};
    if(input.scheduledDay!==undefined){data.scheduledDay=input.scheduledDay;data.day=input.scheduledDay;taskPatch.dueAt=input.scheduledDay?new Date(input.scheduledDay+'T18:00:00Z'):null;}
    if(patch.title)data.title=patch.title;
    if(input.ready!==undefined){taskPatch.status=input.ready?'completed':'planned';data.completion=input.ready?(data.completion??{at:new Date().toISOString(),verificationLevel:'partner_self_report'}):null;}
    taskPatch.data=JSON.stringify(data);await db('CoachTask').where({tenantId,partnerId,id:task.id}).update(taskPatch);
  }
  return {ok:true,revision:row.revision+1};
}

/** Remove from the workspace without destroying attribution or recorded work. */
export async function deleteCalendarMaterial(db:Knex,tenantId:string,partnerId:string,id:string,revision:number){
  await assertPartner(db,tenantId,partnerId);
  await db('Partner').where({tenantId,id:partnerId}).forUpdate().first();
  const material=await db('PartnerMaterial').where({tenantId,partnerId,id}).forUpdate().first();
  if(!material)throw new LinkError('material_not_found',404,'Материал не найден.');
  await assertProgram(db,tenantId,partnerId,material.programId,false);
  if(material.assignedToMaterialId)throw new LinkError('material_assigned',409,'Заготовка уже прикреплена. Откройте задачу в плане.');
  if(material.archivedAt)return {ok:true};
  if(material.revision!==revision)throw new LinkError('revision_conflict',409,'Материал изменён в другой вкладке. Обновите карточку.');
  const now=new Date();
  await db('PartnerMaterial').where({tenantId,partnerId,id}).update({archivedAt:now,revision:material.revision+1,updatedAt:now});
  await db('CoachTask').where({tenantId,partnerId,programId:material.programId}).whereNot('status','cancelled')
    .whereRaw("COALESCE(data->>'materialId',id)=?",[id]).update({status:'cancelled',version:db.raw('version + 1'),updatedAt:now});
  return {ok:true};
}

/** Move a private preparation into an existing empty slot; its identity/links stay intact. */
export async function assignCalendarMaterial(db:Knex,tenantId:string,partnerId:string,sourceId:string,input:{revision:number;targetId:string;targetRevision:number}){
  await assertPartner(db,tenantId,partnerId);
  await db('Partner').where({tenantId,id:partnerId}).forUpdate().first();
  const rows=await db('PartnerMaterial').where({tenantId,partnerId}).whereIn('id',[sourceId,input.targetId]).orderBy('id').forUpdate();
  const source=rows.find(row=>row.id===sourceId),target=rows.find(row=>row.id===input.targetId);
  if(!source||!target||source.id===target.id)throw new LinkError('material_not_found',404,'Выберите материал и задачу.');
  await assertProgram(db,tenantId,partnerId,target.programId,false);
  if(source.assignedToMaterialId===target.id)return {ok:true,materialId:target.id,revision:target.revision};
  if(source.archivedAt||target.archivedAt)throw new LinkError('material_not_found',404,'Материал больше не доступен.');
  if(source.programId!==target.programId||source.formatId!==target.formatId)throw new LinkError('incompatible_material',422,'Выберите задачу той же программы и формата.');
  if(source.revision!==input.revision||target.revision!==input.targetRevision)throw new LinkError('revision_conflict',409,'Материал изменён. Обновите карточку.');
  const sourceHistory=await db('PartnerLinkSource').where({tenantId,partnerId,materialId:source.id}).first();
  const sourceTask=await db('CoachTask').where({tenantId,partnerId}).whereRaw("COALESCE(data->>'materialId',id)=?",[source.id]).first();
  if(source.scheduledDay||sourceHistory||sourceTask)throw new LinkError('material_has_history',409,'У материала уже есть план или ссылки. Назначьте ему день отдельно.');
  const targetFiles=await db('PartnerMaterialFile').where({tenantId,partnerId,materialId:target.id}).first();
  const targetPublished=await db('PartnerLinkSource').where({tenantId,partnerId,materialId:target.id}).whereNotNull('publishedAt').first();
  if(!target.scheduledDay||target.content?.trim()||target.preparedAt||targetFiles||targetPublished)throw new LinkError('slot_not_empty',409,'Эта задача уже подготовлена. Выберите пустую задачу.');
  await db('PartnerMaterialFile').where({tenantId,partnerId,materialId:source.id}).update({materialId:target.id});
  const result=await updateMaterialWorkspace(db,tenantId,partnerId,target.id,{revision:target.revision,content:source.content??'',...(source.preparedAt?{ready:true}:{}),...(!target.customTitle?{title:source.title}:{})});
  await db('PartnerMaterial').where({tenantId,partnerId,id:source.id}).update({archivedAt:new Date(),assignedToMaterialId:target.id,revision:source.revision+1,updatedAt:new Date()});
  return {...result,materialId:target.id};
}

export async function addMaterialFile(db:Knex,tenantId:string,partnerId:string,materialId:string,name:string,type:string,body:Buffer,id=ulid()){
  validateMaterialFile(name,type,body);
  const material=await ownedMaterial(db,tenantId,partnerId,materialId);
  await assertPartner(db,tenantId,partnerId);await assertProgram(db,tenantId,partnerId,material.programId,false);
  const locked=await db('PartnerMaterial').where({tenantId,partnerId,id:materialId}).forUpdate().first();
  if(locked?.assignedToMaterialId)throw new LinkError('material_assigned',409,'Заготовка уже прикреплена. Откройте задачу в плане.');
  assertMaterialActive(locked);
  const fields=['id','name','contentType','size','createdAt'];
  const existing=await db('PartnerMaterialFile').where({id,tenantId,partnerId,materialId}).select(fields).first();
  if(existing){
    const stored=await db('PartnerMaterialFile').where({id,tenantId,partnerId,materialId}).select('data').first();
    if(existing.name!==name||existing.contentType!==type||stored.data!==body.toString('base64'))throw new LinkError('file_request_conflict',409,'Этот запрос уже использован для другого файла.');
    return existing;
  }
  const used=await db('PartnerMaterialFile').where({tenantId,partnerId,materialId}).count('* as count').sum('size as size').first();
  if(Number(used?.count)>=12||Number(used?.size??0)+body.length>MATERIAL_TOTAL_LIMIT)throw new LinkError('material_file_limit',422,'Не более 12 файлов и 250 МБ на материал.');
  const [file]=await db('PartnerMaterialFile').insert({id,tenantId,partnerId,materialId,name,contentType:type,size:body.length,data:body.toString('base64')}).returning(fields);
  return file;
}
