import { Router, raw, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requirePartnerOrAdmin, grantScope } from '../auth.js';
import { tenantOf } from '../tenancy.js';
import { createMaterial, materialSource, materialView, ownedMaterial,recordMaterialPublication,assertMaterialActive } from '../materials-service.js';
import { LinkError } from '../links-service.js';
import { CoachError, safePublicationUrl } from '../coach/schemas.js';
import { assertPartner, assertProgram } from '../coach/policy.js';
import {analyticsSourceOptions} from '../analytics-source-options.js';
import {createPublication} from '../publications-service.js';
import {workCalendar,updateMaterialWorkspace,deleteCalendarMaterial,assignCalendarMaterial,addMaterialFile,MATERIAL_FILE_LIMIT} from '../work-calendar.js';

export const materialsRouter=Router();
const read=[requireAuth,requirePartnerOrAdmin('id')];
const write=[...read,grantScope('links:write')];
const platformSchema=z.object({id:z.string().trim().min(1).max(100),name:z.string().trim().min(1).max(120)}).strict();
const calendarDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(day=>{const date=new Date(day+'T12:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===day;});

materialsRouter.get('/partners/:id/work-calendar',...read,async(req,res)=>{
  const {db,tenantId}=tenantOf(req);
  const input=z.object({programId:z.string().min(1).max(100),scenarioId:z.string().min(1).max(100).optional()}).parse(req.query);
  res.json(await workCalendar(db,tenantId,req.params.id!,input.programId,input.scenarioId));
});
materialsRouter.patch('/partners/:id/materials/:materialId/workspace',...write,async(req,res)=>{
  const {db,tenantId}=tenantOf(req);
  const input=z.object({revision:z.number().int().positive(),title:z.string().trim().min(1).max(200).optional(),content:z.string().max(100000).optional(),scheduledDay:calendarDay.nullable().optional(),scheduledTime:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),ready:z.boolean().optional()}).strict().parse(req.body);
  res.json(await updateMaterialWorkspace(db,tenantId,req.params.id!,req.params.materialId!,input));
});
materialsRouter.delete('/partners/:id/materials/:materialId',...write,async(req,res)=>{
  const {db,tenantId}=tenantOf(req);
  const input=z.object({revision:z.number().int().positive()}).strict().parse(req.body);
  res.json(await deleteCalendarMaterial(db,tenantId,req.params.id!,req.params.materialId!,input.revision));
});
materialsRouter.post('/partners/:id/materials/:materialId/assign',...write,async(req,res)=>{
  const {db,tenantId}=tenantOf(req);
  const input=z.object({revision:z.number().int().positive(),targetId:z.string().min(1).max(32),targetRevision:z.number().int().positive()}).strict().parse(req.body);
  res.json(await assignCalendarMaterial(db,tenantId,req.params.id!,req.params.materialId!,input));
});
materialsRouter.post('/partners/:id/materials/:materialId/files',...write,raw({type:()=>true,limit:MATERIAL_FILE_LIMIT}),async(req,res)=>{
  const {db,tenantId}=tenantOf(req);
  let name:string;try{name=decodeURIComponent(req.get('X-File-Name')??'');}catch{throw new LinkError('invalid_filename',422,'Недопустимое имя файла.');}
  const fileId=z.string().regex(/^[a-zA-Z0-9_-]{16,32}$/).optional().parse(req.get('X-Upload-Id'));
  if(!Buffer.isBuffer(req.body))throw new LinkError('invalid_file',422,'Отправьте файл.');
  const type=(req.get('Content-Type')??'').split(';')[0]!.trim().toLowerCase();
  res.status(201).json({file:await addMaterialFile(db,tenantId,req.params.id!,req.params.materialId!,name,type,req.body,fileId)});
});
materialsRouter.get('/partners/:id/materials/:materialId/files/:fileId',...read,async(req,res)=>{
  const {db,tenantId}=tenantOf(req),partnerId=req.params.id!;
  const material=await ownedMaterial(db,tenantId,partnerId,req.params.materialId!);
  await assertProgram(db,tenantId,partnerId,material.programId,false);
  const file=await db('PartnerMaterialFile').where({id:req.params.fileId!,tenantId,partnerId,materialId:material.id}).first();
  if(!file)throw new LinkError('file_not_found',404,'Файл не найден.');
  res.set({'Content-Type':file.contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(Buffer.from(file.data,'base64'));
});
materialsRouter.delete('/partners/:id/materials/:materialId/files/:fileId',...write,async(req,res)=>{
  const {db,tenantId}=tenantOf(req),partnerId=req.params.id!,materialId=req.params.materialId!;
  await assertPartner(db,tenantId,partnerId);
  const material=await ownedMaterial(db,tenantId,partnerId,materialId);
  await assertProgram(db,tenantId,partnerId,material.programId,false);
  const locked=await db('PartnerMaterial').where({tenantId,partnerId,id:materialId}).forUpdate().first();
  assertMaterialActive(locked);
  const file=await db('PartnerMaterialFile').where({id:req.params.fileId!,tenantId,partnerId,materialId}).first();
  if(!file)throw new LinkError('file_not_found',404,'Файл не найден.');
  if(await db('PartnerLinkSource').where({tenantId,partnerId,materialId}).whereNotNull('publishedAt').first())throw new LinkError('material_published',409,'Файлы опубликованного материала сохранены в истории.');
  const other=await db('PartnerMaterialFile').where({tenantId,partnerId,materialId}).whereNot('id',file.id).first();
  if(material.preparedAt&&!material.content?.trim()&&!other)throw new LinkError('material_empty',409,'Сначала снимите отметку готовности или добавьте другой файл.');
  await db('PartnerMaterialFile').where({id:file.id,tenantId,partnerId,materialId}).del();
  res.json({ok:true});
});

materialsRouter.get('/partners/:id/material-catalog',...read,async(req,res)=>{
  const {db,tenantId}=tenantOf(req),partnerId=req.params.id!;
  const {programId,scenarioId}=z.object({programId:z.string().min(1).optional(),scenarioId:z.string().min(1).max(100).optional()}).parse(req.query);
  if(programId)await assertProgram(db,tenantId,partnerId,programId,false);
  const options=await analyticsSourceOptions(db,tenantId,[partnerId],programId,scenarioId&&scenarioId!=='all'?[scenarioId]:[]);
  const definitions=db('CoachForecastSnapshot').where({tenantId,partnerId,status:'confirmed'}).modify(q=>{if(programId)q.where({programId});})
    .select('programId','createdAt',db.raw("COALESCE(data->>'scenarioId',id) as id"),db.raw("COALESCE(NULLIF(data->>'scenarioName',''),'Сценарий') as name"));
  const scenarios=await db.from(definitions.as('definitions')).distinctOn('programId','id')
    .select('programId','id','name').orderBy('programId').orderBy('id').orderBy('createdAt','desc');
  res.json({formats:options.formats,platforms:options.platforms,scenarios});
});

materialsRouter.post('/partners/:id/publications',...write,async(req,res)=>{
  const {db,tenantId}=tenantOf(req);
  const input=z.object({requestId:z.string().regex(/^[a-zA-Z0-9_-]{16,32}$/),programId:z.string().min(1),
    title:z.string().trim().min(1).max(200),formatId:z.string().min(1).max(100),platform:platformSchema,
    scenarioId:z.string().min(1).max(100).nullable().optional(),linkId:z.string().min(1).max(32).optional(),
    channelName:z.string().trim().max(120).optional(),publicationUrl:z.string().trim().max(2048).optional(),published:z.boolean().optional(),
  }).strict().parse(req.body);
  res.status(201).json(await createPublication(db,tenantId,req.params.id!,input));
});

materialsRouter.post('/partners/:id/materials',...write,async(req,res)=>{
  const {db,tenantId}=tenantOf(req);
  const input=z.object({id:z.string().min(1).max(32).optional(),programId:z.string().min(1),scenarioId:z.string().min(1).max(100).nullable().optional(),title:z.string().trim().min(1).max(200),formatId:z.string().min(1),platforms:z.array(platformSchema).max(30).optional(),content:z.string().max(100000).optional(),scheduledDay:calendarDay.nullable().optional()}).strict().parse(req.body);
  const material=await createMaterial(db,tenantId,req.params.id!,input);
  res.status(201).json({material});
});
materialsRouter.get('/partners/:id/materials/:materialId',...read,async(req,res)=>{
  const {db,tenantId}=tenantOf(req);
  res.json(await materialView(db,tenantId,req.params.id!,req.params.materialId!));
});
materialsRouter.patch('/partners/:id/materials/:materialId',...write,async(req,res)=>{
  const {db,tenantId}=tenantOf(req),partnerId=req.params.id!;
  const input=z.object({title:z.string().trim().min(1).max(200)}).strict().parse(req.body);
  const material=await ownedMaterial(db,tenantId,partnerId,req.params.materialId!);
  await assertPartner(db,tenantId,partnerId);await assertProgram(db,tenantId,partnerId,material.programId,false);
  assertMaterialActive(await db('PartnerMaterial').where({tenantId,partnerId,id:material.id}).forUpdate().first());
  await db('PartnerMaterial').where({tenantId,partnerId,id:material.id}).update({title:input.title,customTitle:true,revision:db.raw('revision + 1'),updatedAt:new Date()});
  res.json({ok:true});
});
materialsRouter.post('/partners/:id/materials/:materialId/placements',...write,async(req,res)=>{
  const {db,tenantId}=tenantOf(req),partnerId=req.params.id!;
  const input=z.object({linkId:z.string().min(1),platform:platformSchema,requestId:z.string().min(8).max(100)}).strict().parse(req.body);
  const material=await ownedMaterial(db,tenantId,partnerId,req.params.materialId!);
  res.status(201).json(await materialSource(db,tenantId,partnerId,input.linkId,material,input.platform,input.requestId));
});
materialsRouter.patch('/partners/:id/link-sources/:sourceId',...write,async(req,res)=>{
  const {db,tenantId}=tenantOf(req),partnerId=req.params.id!;
  const input=z.object({publicationUrl:z.string().trim().max(2048).optional(),channelName:z.string().trim().max(120).optional(),published:z.boolean().optional()}).strict().parse(req.body);
  await db('Partner').where({tenantId,id:partnerId}).forUpdate().first();
  const source=await db('PartnerLinkSource').where({tenantId,partnerId,id:req.params.sourceId!}).first();
  if(!source?.materialId)throw new LinkError('source_not_found',404,'Размещение не найдено.');
  await assertPartner(db,tenantId,partnerId);await assertProgram(db,tenantId,partnerId,source.programId,false);
  const patch:Record<string,unknown>={};
  if(input.publicationUrl!==undefined)patch.publicationUrl=input.publicationUrl?safePublicationUrl(input.publicationUrl):null;
  if(input.channelName!==undefined)patch.channelName=input.channelName||null;
  if(input.published!==undefined)patch.publishedAt=input.published?(source.publishedAt??new Date()):null;
  if(input.published&&await db('PartnerMaterial').where({tenantId,partnerId,id:source.materialId}).first('id'))await recordMaterialPublication(db,tenantId,partnerId,source.materialId,new Date(patch.publishedAt as Date));
  if(Object.keys(patch).length)await db('PartnerLinkSource').where({tenantId,partnerId,id:source.id}).update(patch);
  res.json({ok:true});
});
materialsRouter.use((error:Error,_req:Request,res:Response,next:NextFunction)=>{
  if(error instanceof z.ZodError){res.status(400).json({error:'invalid_body',detail:'Проверьте заполненные поля.'});return;}
  if(error instanceof LinkError||error instanceof CoachError){res.status(error.status).json({error:error.code,detail:error.message});return;}
  next(error);
});
