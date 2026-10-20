import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requirePartnerOrAdmin, grantScope } from '../auth.js';
import { tenantOf } from '../tenancy.js';
import { createMaterial, materialSource, materialView, ownedMaterial } from '../materials-service.js';
import { calculateCoachForecast } from '../coach/forecast-adapter.js';
import { LinkError } from '../links-service.js';
import { CoachError, safePublicationUrl } from '../coach/schemas.js';
import { assertPartner, assertProgram } from '../coach/policy.js';
import {analyticsSourceOptions} from '../analytics-source-options.js';
import {createPublication} from '../publications-service.js';

export const materialsRouter=Router();
const read=[requireAuth,requirePartnerOrAdmin('id')];
const write=[...read,grantScope('links:write')];
const platformSchema=z.object({id:z.string().trim().min(1).max(100),name:z.string().trim().min(1).max(120)}).strict();

materialsRouter.get('/partners/:id/material-catalog',...read,async(req,res)=>{
  const {db,tenantId}=tenantOf(req),partnerId=req.params.id!;
  const programId=z.string().min(1).optional().parse(req.query.programId);
  if(programId)await assertProgram(db,tenantId,partnerId,programId,false);
  const model=await calculateCoachForecast({});
  const options=await analyticsSourceOptions(db,tenantId,[partnerId],programId);
  const definitions=db('CoachForecastSnapshot').where({tenantId,partnerId,status:'confirmed'}).modify(q=>{if(programId)q.where({programId});})
    .select('programId','createdAt',db.raw("COALESCE(data->>'scenarioId',id) as id"),db.raw("COALESCE(NULLIF(data->>'scenarioName',''),'Сценарий') as name"));
  const scenarios=await db.from(definitions.as('definitions')).distinctOn('programId','id')
    .select('programId','id','name').orderBy('programId').orderBy('id').orderBy('createdAt','desc');
  res.json({formats:options.formats,platforms:options.platforms.map(p=>({...p,formats:model.channels.find((item:{id:string})=>item.id===p.id)?.formats})),scenarios});
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
  const input=z.object({id:z.string().min(1).max(32).optional(),programId:z.string().min(1),scenarioId:z.string().min(1).max(100).nullable().optional(),title:z.string().trim().min(1).max(200),formatId:z.string().min(1),platforms:z.array(platformSchema).max(30).optional()}).strict().parse(req.body);
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
  await db('PartnerMaterial').where({tenantId,partnerId,id:material.id}).update({title:input.title,customTitle:true,updatedAt:new Date()});
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
  const source=await db('PartnerLinkSource').where({tenantId,partnerId,id:req.params.sourceId!}).first();
  if(!source?.materialId)throw new LinkError('source_not_found',404,'Размещение не найдено.');
  await assertPartner(db,tenantId,partnerId);await assertProgram(db,tenantId,partnerId,source.programId,false);
  const patch:Record<string,unknown>={};
  if(input.publicationUrl!==undefined)patch.publicationUrl=input.publicationUrl?safePublicationUrl(input.publicationUrl):null;
  if(input.channelName!==undefined)patch.channelName=input.channelName||null;
  if(input.published!==undefined)patch.publishedAt=input.published?(source.publishedAt??new Date()):null;
  if(Object.keys(patch).length)await db('PartnerLinkSource').where({tenantId,partnerId,id:source.id}).update(patch);
  res.json({ok:true});
});
materialsRouter.use((error:Error,_req:Request,res:Response,next:NextFunction)=>{
  if(error instanceof z.ZodError){res.status(400).json({error:'invalid_body',detail:'Проверьте заполненные поля.'});return;}
  if(error instanceof LinkError||error instanceof CoachError){res.status(error.status).json({error:error.code,detail:error.message});return;}
  next(error);
});
