import {up as removeCalendarReminders} from '../../../../../packages/db/migrations/20261025020000_remove_calendar_reminders.js';
import {afterAll,beforeEach,describe,expect,it} from 'vitest';
import request from 'supertest';
import {ulid} from 'ulid';
import {DEFAULT_TENANT_ID as tenantId} from '@openpartner/db';
import {createApp} from '../../app.js';
import {db,appDb} from '../../db.js';
import {generateApiKey} from '../../auth.js';
import {assertIsolatedCoachDatabase} from '../test-guard.js';
import {validateMaterialFile,assignCalendarMaterial} from '../../work-calendar.js';
import {materialSource,ownedMaterial} from '../../materials-service.js';
import {calculatorCurrentValues} from '../../calculator-current-values.js';
import {calculatorPlanView} from '../calculator-plan.js';
assertIsolatedCoachDatabase(process.env.DATABASE_URL!,process.env.COACH_WORKING_DB);
const app=createApp({enableLogger:false});
let partnerId:string,otherId:string,programId:string,key:string,materialId:string,planId:string;
const auth=(r:request.Test)=>r.set('Authorization',`Bearer ${key}`);
const path=()=>`/partners/${partnerId}/materials/${materialId}`;
const patch=(body:object)=>auth(request(app).patch(path()+'/workspace')).send(body);
const calendar=()=>auth(request(app).get(`/partners/${partnerId}/work-calendar?programId=${programId}`));
const upload=(id=ulid(),body=Buffer.from('Prepared post'),name='post.txt',type='text/plain')=>auth(request(app).post(path()+'/files')).set('Content-Type',type).set('X-File-Name',encodeURIComponent(name)).set('X-Upload-Id',id).send(body);
beforeEach(async()=>{
  partnerId=ulid();otherId=ulid();programId=ulid();materialId=ulid();planId=ulid();const credential=generateApiKey();key=credential.plaintext;
  await db('Partner').insert([partnerId,otherId].map(id=>({id,tenantId,name:'Calendar fixture',email:`${id}@example.test`,activatedAt:new Date()})));
  await db('Program').insert({id:programId,tenantId,name:'Calendar fixture',destinationUrl:'https://syntolk.ru',commissionRule:JSON.stringify({type:'percent',value:20})});
  await db('PartnerProgram').insert({id:ulid(),tenantId,partnerId,programId,source:'admin'});
  await db('ApiKey').insert({id:ulid(),tenantId,partnerId,prefix:credential.prefix,keyHash:credential.hash});
  await db('PartnerMaterial').insert({id:materialId,tenantId,partnerId,programId,title:'Prepare a post',formatId:'post',formatName:'Пост',scheduledDay:'2026-11-02',platforms:JSON.stringify([{id:'vk',name:'ВКонтакте'},{id:'youtube',name:'YouTube'}])});
});
afterAll(async()=>{await db.destroy();await appDb.destroy();});
describe('work calendar, private preparation and manual publication',()=>{
  it('removes a planned material from both calendar and legacy tasks without recreating it on reads',async()=>{
    await db('CoachPlan').insert({id:planId,tenantId,partnerId,programId,status:'active',weekStart:'2026-11-02',data:JSON.stringify({source:'calculator_schedule_v1',timezone:'Europe/Moscow',startDate:'2026-11-02',days:7})});
    await db('CoachTask').insert({id:materialId,tenantId,partnerId,programId,planId,status:'planned',data:JSON.stringify({materialId,kind:'content',scheduledDay:'2026-11-02'})});
    const remove=()=>auth(request(app).delete(path())).send({revision:1});
    expect((await remove()).status).toBe(200);expect((await remove()).status).toBe(200);
    for(let i=0;i<2;i++){
      expect((await calendar()).body.materials).toHaveLength(0);
      expect((await calculatorPlanView(db,tenantId,partnerId,programId)).tasks).toHaveLength(0);
    }
    const material=await db('PartnerMaterial').where({id:materialId}).first();expect(material.archivedAt).not.toBeNull();expect(material.revision).toBe(2);
    expect(await db('CoachTask').where({id:materialId}).first()).toMatchObject({status:'cancelled',version:2});
    expect(await db('CoachPlan').where({id:planId}).first()).toMatchObject({status:'active'});
    expect((await patch({revision:2,scheduledDay:'2026-11-03'})).status).toBe(409);
    expect((await upload()).status).toBe(409);
    expect((await auth(request(app).patch(path())).send({title:'Revived'})).status).toBe(409);
  });
  it('deletes undated stock and preserves existing publication links, files and recorded statistics',async()=>{
    await db('PartnerMaterial').where({id:materialId}).update({scheduledDay:null,content:'Saved content',preparedAt:new Date('2026-10-01T12:00:00Z')});
    const file=ulid();expect((await upload(file)).status).toBe(201);
    const linkId=ulid(),sourceId=ulid();await db('Link').insert({id:linkId,tenantId,partnerId,programId,linkKey:ulid()});
    await db('PartnerLinkSource').insert({id:sourceId,tenantId,partnerId,programId,linkId,sourceKey:ulid(),materialId,platformId:'vk',platformName:'ВКонтакте',formatId:'post',formatName:'Пост',publishedAt:new Date('2026-10-01T13:00:00Z')});
    const filters={programId,since:new Date('2026-09-01T00:00:00Z'),until:new Date('2026-10-02T00:00:00Z')};
    const before=await calculatorCurrentValues(db,tenantId,partnerId,filters);
    expect((await auth(request(app).delete(path())).send({revision:1})).status).toBe(200);
    expect((await calendar()).body.materials).toHaveLength(0);
    const after=await calculatorCurrentValues(db,tenantId,partnerId,filters);expect(after.content).toEqual(before.content);expect(after.content.publishedMaterials).toBe(1);
    expect(await db('PartnerLinkSource').where({id:sourceId}).first()).toMatchObject({linkId,materialId});expect(await db('Link').where({id:linkId}).first()).toBeTruthy();
    expect((await auth(request(app).get(`${path()}/files/${file}`))).status).toBe(200);
    expect((await auth(request(app).post(path()+'/placements')).send({linkId,platform:{id:'vk',name:'ВКонтакте'},requestId:'new-request'})).status).toBe(409);
    expect((await auth(request(app).patch(`/partners/${partnerId}/link-sources/${sourceId}`)).send({published:true})).status).toBe(409);
  });
  it('requires the current revision and material ownership before deleting anything',async()=>{
    expect((await request(app).delete(path()).send({revision:1})).status).toBe(401);
    expect((await auth(request(app).delete(path())).send({})).status).toBe(400);
    expect((await patch({revision:1,content:'Newer edit'})).status).toBe(200);
    expect((await auth(request(app).delete(path())).send({revision:1})).status).toBe(409);
    const foreign=ulid();await db('PartnerMaterial').insert({id:foreign,tenantId,partnerId:otherId,programId,title:'Other owner',formatId:'post',formatName:'Пост'});
    expect((await auth(request(app).delete(`/partners/${partnerId}/materials/${foreign}`)).send({revision:1})).status).toBe(404);
    expect((await calendar()).body.materials).toHaveLength(1);expect((await db('PartnerMaterial').where({id:foreign}).first()).archivedAt).toBeNull();
  });
  it('keeps readiness and daily tasks consistent when a material is published directly',async()=>{
    await db('CoachPlan').insert({id:planId,tenantId,partnerId,programId,status:'active',weekStart:'2026-11-02',data:JSON.stringify({source:'calculator_schedule_v1',startDate:'2026-11-02',days:7})});
    await db('CoachTask').insert({id:materialId,tenantId,partnerId,programId,planId,status:'planned',data:JSON.stringify({source:'calculator_schedule_v1',kind:'content',materialId,scheduledDay:'2026-11-02'})});
    const linkId=ulid(),sourceId=ulid();await db('Link').insert({id:linkId,tenantId,partnerId,programId,linkKey:ulid()});
    await db('PartnerLinkSource').insert({id:sourceId,tenantId,partnerId,programId,linkId,sourceKey:ulid(),materialId,platformId:'vk',platformName:'ВКонтакте',formatId:'post',formatName:'Пост'});
    const publish=await auth(request(app).patch(`/partners/${partnerId}/link-sources/${sourceId}`)).send({published:true});expect(publish.status,publish.text).toBe(200);
    expect((await calendar()).body.materials[0].ready).toBe(true);
    const task=await db('CoachTask').where({id:materialId}).first();expect(task.status).toBe('completed');
    const material=await db('PartnerMaterial').where({id:materialId}).first();expect(material.preparedAt).not.toBeNull();
    const unpublish=await auth(request(app).patch(`/partners/${partnerId}/link-sources/${sourceId}`)).send({published:false});expect(unpublish.status).toBe(200);
    expect((await calendar()).body.materials[0]).toMatchObject({ready:true,publishedPlacements:0});
  });
  it('creates a standalone dated material without a calculator plan and safely retries creation',async()=>{
    const body={id:ulid(),programId,title:'Мой пост',formatId:'post',content:'Текст',scheduledDay:'2026-11-01'};
    const create=()=>auth(request(app).post(`/partners/${partnerId}/materials`)).send(body);
    expect((await create()).status).toBe(201);expect((await create()).status).toBe(201);
    const result=await calendar();expect(result.status,result.text).toBe(200);expect(result.body.materials).toHaveLength(2);
    expect(result.body.materials.find((m:{id:string})=>m.id===body.id)).toMatchObject({scheduledDay:'2026-11-01',hasContent:true,ready:false});
    expect(await db('CoachPlan').where({partnerId})).toHaveLength(0);
  });
  it('stores only metadata in views, downloads privately, and reuses the upload request',async()=>{
    const id=ulid(),body=Buffer.from('Saved material text');
    expect((await upload(id,body)).status).toBe(201);expect((await upload(id,body)).status).toBe(201);
    expect(await db('PartnerMaterialFile').where({partnerId,materialId})).toHaveLength(1);
    const view=await auth(request(app).get(path()));expect(view.body.files[0]).toMatchObject({id,name:'post.txt',size:body.length});expect(view.body.files[0].data).toBeUndefined();
    const download=await auth(request(app).get(`${path()}/files/${id}`));expect(download.status).toBe(200);expect(download.text).toBe(body.toString());expect(download.headers['cache-control']).toBe('private, no-store');expect(download.headers['content-disposition']).toContain('attachment');
    expect((await request(app).get(`${path()}/files/${id}`)).status).toBe(401);
    expect((await upload(id,Buffer.from('Different bytes'))).status).toBe(409);
    expect((await calendar()).body.materials[0]).toMatchObject({fileCount:1,ready:false,publishedPlacements:0});
    expect(await db('PartnerLinkSource').where({partnerId})).toHaveLength(0);
  });
  it('rejects disguised executables, malformed names, empty files and invalid dates',async()=>{
    expect((await upload(ulid(),Buffer.from('MZ not a PNG'),'fake.png','image/png')).status).toBe(422);
    expect((await upload(ulid(),Buffer.from('a'),'../evil.txt')).status).toBe(422);
    expect((await upload(ulid(),Buffer.alloc(0))).status).toBe(422);
    expect((await patch({revision:1,scheduledDay:'2026-02-30'})).status).toBe(400);
    expect(await db('PartnerMaterialFile').where({partnerId})).toHaveLength(0);
  });
  it('allows removing a draft attachment but protects the only ready attachment',async()=>{
    const id=ulid();expect((await upload(id)).status).toBe(201);
    expect((await patch({revision:1,ready:true})).status).toBe(200);
    expect((await auth(request(app).delete(`${path()}/files/${id}`))).status).toBe(409);
    expect((await patch({revision:2,ready:false})).status).toBe(200);
    expect((await auth(request(app).delete(`${path()}/files/${id}`))).status).toBe(200);
    expect((await auth(request(app).get(`${path()}/files/${id}`))).status).toBe(404);
  });
  it('enforces attachment count without losing an idempotent retry at the limit',async()=>{
    const ids=Array.from({length:12},()=>ulid());
    for(const id of ids)expect((await upload(id)).status).toBe(201);
    expect((await upload(ids[0]!)).status).toBe(201);expect((await upload()).status).toBe(422);
    expect(await db('PartnerMaterialFile').where({partnerId})).toHaveLength(12);
  });
  it('updates only generated dated titles when a calendar material is moved',async()=>{
    await db('PartnerMaterial').where({id:materialId}).update({title:'Пост · 02.11.2026 · №1',customTitle:false});
    expect((await patch({revision:1,scheduledDay:'2026-11-05'})).status).toBe(200);
    expect((await auth(request(app).get(path()))).body.material.title).toBe('Пост · 05.11.2026 · №1');
    await db('PartnerMaterial').where({id:materialId}).update({title:'Мой авторский заголовок',customTitle:true});
    expect((await patch({revision:2,scheduledDay:'2026-11-06'})).status).toBe(200);
    expect((await auth(request(app).get(path()))).body.material.title).toBe('Мой авторский заголовок');
  });
  it('requires text or a file before ready and does not count readiness as publication',async()=>{
    expect((await patch({revision:1,ready:true})).status).toBe(422);
    const saved=await patch({revision:1,content:'Ready post',ready:true});expect(saved.status,saved.text).toBe(200);
    expect((await patch({revision:2,content:''})).status).toBe(422);
    expect((await calendar()).body.materials[0]).toMatchObject({ready:true,publishedPlacements:0});
    const facts=await calculatorCurrentValues(db,tenantId,partnerId,{programId,since:new Date('2020-01-01'),until:new Date('2040-01-01')});
    expect(facts.content).toMatchObject({preparedMaterials:1,publishedMaterials:0,publishedPlacements:0});expect(facts.counts.clicks).toBe(0);
  });
  it('moves dates and readiness into legacy calculator tasks without rebuilding the plan',async()=>{
    await db('CoachPlan').insert({id:planId,tenantId,partnerId,programId,status:'active',weekStart:'2026-11-02',data:JSON.stringify({source:'calculator_schedule_v1',startDate:'2026-11-02',days:7})});
    await db('CoachTask').insert({id:materialId,tenantId,partnerId,programId,planId,status:'planned',data:JSON.stringify({source:'calculator_schedule_v1',kind:'content',materialId,scheduledDay:'2026-11-02'})});
    expect((await patch({revision:1,scheduledDay:'2026-11-06',content:'Prepared',ready:true})).status).toBe(200);
    const task=await db('CoachTask').where({id:materialId}).first();expect(task.data.scheduledDay).toBe('2026-11-06');expect(task.data.day).toBe('2026-11-06');expect(task.status).toBe('completed');expect(task.version).toBe(2);
    expect((await patch({revision:2,scheduledDay:null,ready:false})).status).toBe(200);
    const updated=await db('CoachTask').where({id:materialId}).first();expect(updated.data.scheduledDay).toBeNull();expect(updated.status).toBe('planned');
    expect((await calendar()).body.materials[0]).toMatchObject({scheduledDay:null,ready:false,status:'draft'});
    expect(await db('CoachPlan').where({partnerId})).toHaveLength(1);
    await db('Config').insert({tenantId,key:'coach_settings',value:JSON.stringify({enabled:true,provider:'template',dailyRuns:20,takeover:[]})}).onConflict(['tenantId','key']).merge({value:JSON.stringify({enabled:true,provider:'template',dailyRuns:20,takeover:[]})});
    const legacy=(version:number,completed:boolean)=>auth(request(app).post(`/coach/me/calculator-plan/tasks/${materialId}/complete`)).send({version,completed});
    expect((await legacy(3,true)).status).toBe(200);expect((await calendar()).body.materials[0].ready).toBe(true);
    expect((await legacy(4,false)).status).toBe(200);expect((await calendar()).body.materials[0].ready).toBe(false);
  });
  it('rejects stale concurrent edits and increments revision for legacy title edits',async()=>{
    expect((await patch({revision:1,content:'Version 2'})).status).toBe(200);
    expect((await patch({revision:1,content:'Lost update'})).status).toBe(409);
    expect((await auth(request(app).patch(path())).send({title:'Renamed'})).status).toBe(200);
    expect((await patch({revision:2,content:'Stale drawer'})).status).toBe(409);
    expect((await auth(request(app).get(path()))).body.material).toMatchObject({content:'Version 2',revision:3,title:'Renamed'});
  });
  it('counts missing expected platforms plus additional placements, never declares a partial material published',async()=>{
    const linkId=ulid();await db('Link').insert({id:linkId,tenantId,partnerId,programId,linkKey:'calendar-'+ulid()});
    for(let i=0;i<2;i++)await db('PartnerLinkSource').insert({id:ulid(),tenantId,partnerId,programId,linkId,sourceKey:ulid(),materialId,platformId:'vk',platformName:'ВКонтакте',formatId:'post',formatName:'Пост',publishedAt:new Date()});
    expect((await calendar()).body.materials[0]).toMatchObject({status:'partial',totalPlacements:3,publishedPlacements:2});
    expect((await patch({revision:1,ready:false})).status).toBe(409);
    await db('PartnerLinkSource').insert({id:ulid(),tenantId,partnerId,programId,linkId,sourceKey:ulid(),materialId,platformId:'youtube',platformName:'YouTube',formatId:'post',formatName:'Пост',publishedAt:new Date()});
    expect((await calendar()).body.materials[0]).toMatchObject({status:'published',totalPlacements:3,publishedPlacements:3});
  });
  it('isolates ownership and scopes scenarios including unassigned content',async()=>{
    expect((await auth(request(app).get(`/partners/${otherId}/work-calendar?programId=${programId}`))).status).toBe(403);
    const foreignId=ulid();await db('PartnerMaterial').insert({id:foreignId,tenantId,partnerId:otherId,programId,title:'Private other material',formatId:'post',formatName:'Пост',platforms:'[]'});
    expect((await auth(request(app).get(`/partners/${partnerId}/materials/${foreignId}`))).status).toBe(404);
    expect((await auth(request(app).patch(`/partners/${partnerId}/materials/${foreignId}/workspace`)).send({revision:1,content:'x'})).status).toBe(404);
    expect((await auth(request(app).get(`/partners/${partnerId}/work-calendar?programId=${ulid()}`))).status).toBe(403);
    const none=await auth(request(app).get(`/partners/${partnerId}/work-calendar?programId=${programId}&scenarioId=__none__`));expect(none.body.materials).toHaveLength(1);
    const absent=await auth(request(app).get(`/partners/${partnerId}/work-calendar?programId=${programId}&scenarioId=unknown`));expect(absent.body.materials).toHaveLength(0);
  });
  it('validates file magic and UTF-8 without trusting a filename or supplied mime',()=>{
    expect(()=>validateMaterialFile('файл.txt','text/plain',Buffer.from('Текст поста'))).not.toThrow();
    expect(()=>validateMaterialFile('a.png','image/png',Buffer.from([137,80,78,71,13,10,26,10]))).not.toThrow();
    for(const [name,type,body] of [['a.html','text/html',Buffer.from('<script>')],['a.txt','text/plain',Buffer.from([255])],['a.txt','text/plain',Buffer.from([0])]] as const)expect(()=>validateMaterialFile(name,type,body)).toThrow();
  });
});

describe('calendar workflow: preparation and scheduling',()=>{
  async function stock(){
    const id=ulid();await db('PartnerMaterial').insert({id,tenantId,partnerId,programId,title:'Готовый пост',formatId:'post',formatName:'Пост',content:'Текст заготовки',preparedAt:new Date()});
    const file=ulid();await db('PartnerMaterialFile').insert({id:file,tenantId,partnerId,materialId:id,name:'post.txt',contentType:'text/plain',size:4,data:Buffer.from('text').toString('base64')});return {id,file};
  }
  it('assigns a stock material to a planned identity, keeping links and tasks; retry creates nothing',async()=>{
    const {id,file}=await stock(),linkId=ulid(),sourceId=ulid();
    await db('CoachPlan').insert({id:planId,tenantId,partnerId,programId,status:'active',weekStart:'2026-11-02',data:'{}'});
    await db('CoachTask').insert({id:materialId,tenantId,partnerId,programId,planId,status:'planned',data:JSON.stringify({materialId,scheduledDay:'2026-11-02'})});
    await db('Link').insert({id:linkId,tenantId,partnerId,programId,linkKey:ulid()});
    await db('PartnerLinkSource').insert({id:sourceId,tenantId,partnerId,programId,linkId,sourceKey:ulid(),materialId,platformId:'vk',platformName:'ВКонтакте',formatId:'post',formatName:'Пост'});
    const assign=()=>auth(request(app).post(`/partners/${partnerId}/materials/${id}/assign`)).send({revision:1,targetRevision:1,targetId:materialId});
    expect((await assign()).status).toBe(200);expect((await assign()).status).toBe(200);
    expect(await db('PartnerMaterialFile').where({id:file}).first()).toMatchObject({materialId});
    expect(await db('PartnerLinkSource').where({id:sourceId}).first()).toMatchObject({materialId,linkId});
    expect(await db('CoachTask').where({id:materialId}).first()).toMatchObject({status:'completed'});
    const result=await calendar();expect(result.body.materials).toHaveLength(1);expect(result.body.materials[0]).toMatchObject({id:materialId,ready:true,fileCount:1,publishedPlacements:0,scheduledDay:'2026-11-02'});
    expect(await db('PartnerMaterial').where({id}).first()).toMatchObject({assignedToMaterialId:materialId});
    expect((await auth(request(app).patch(`/partners/${partnerId}/materials/${id}/workspace`)).send({revision:2,content:'Старый черновик'})).status).toBe(409);
    expect((await auth(request(app).post(`/partners/${partnerId}/materials/${id}/files`)).set('Content-Type','text/plain').set('X-File-Name','late.txt').send(Buffer.from('late'))).status).toBe(409);
  });
  it('serializes source creation against assigning the same preparation',async()=>{
    const {id}=await stock(),linkId=ulid();await db('Link').insert({id:linkId,tenantId,partnerId,programId,linkKey:ulid()});
    const source=await ownedMaterial(db,tenantId,partnerId,id);
    const results=await Promise.allSettled([db.transaction(trx=>assignCalendarMaterial(trx,tenantId,partnerId,id,{revision:1,targetId:materialId,targetRevision:1})),db.transaction(trx=>materialSource(trx,tenantId,partnerId,linkId,source,{id:'vk',name:'ВКонтакте'}))]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const current=await db('PartnerMaterial').where({id}).first();const links=await db('PartnerLinkSource').where({partnerId,materialId:id});
    expect(!!current.assignedToMaterialId).toBe(links.length===0);
  });
  it('rejects occupied, stale and foreign targets without moving any files',async()=>{
    const {id,file}=await stock();const assign=(body:object)=>auth(request(app).post(`/partners/${partnerId}/materials/${id}/assign`)).send({revision:1,targetRevision:1,targetId:materialId,...body});
    expect((await assign({targetRevision:2})).status).toBe(409);
    await db('PartnerMaterial').where({id:materialId}).update({content:'Уже заполнено'});expect((await assign({})).status).toBe(409);
    const foreign=ulid();await db('PartnerMaterial').insert({id:foreign,tenantId,partnerId:otherId,programId,title:'Чужой',formatId:'post',formatName:'Пост',scheduledDay:'2026-11-02'});
    expect((await assign({targetId:foreign})).status).toBe(404);expect(await db('PartnerMaterialFile').where({id:file}).first()).toMatchObject({materialId:id});
    expect((await db('PartnerMaterial').where({id}).first()).archivedAt).toBeNull();
  });
  it('persists name/time with readiness in one revision and rejects bad clock values',async()=>{
    expect((await patch({revision:1,title:'Мой материал',content:'Готов',ready:true,scheduledTime:'14:30'})).status).toBe(200);
    const result=(await calendar()).body.materials[0];
    expect(result).toMatchObject({revision:2,title:'Мой материал',ready:true,scheduledTime:'14:30'});
    expect(result).not.toHaveProperty('reminderEnabled');
    expect((await patch({revision:2,scheduledTime:'25:00'})).status).toBe(400);
    expect((await patch({revision:1,content:'Старая версия'})).status).toBe(409);
  });
});

describe('retired calendar reminders',()=>{
  it('no longer exposes reminder routes',async()=>{
    const base=`/partners/${partnerId}/calendar-reminders`;
    expect((await auth(request(app).get(base))).status).toBe(404);
    expect((await auth(request(app).put(base)).send({enabled:true})).status).toBe(404);
    expect((await auth(request(app).post(base+'/notice/read'))).status).toBe(404);
  });
  it('removes only retired settings and notifications, preserving publication scheduling and other notices',async()=>{
    const key=`calendar_reminders:${partnerId}`,otherKey=`calendarXreminders:${partnerId}`,notice=ulid(),otherNotice=ulid();
    await db('Config').insert([{tenantId,key,value:JSON.stringify({enabled:true})},{tenantId,key:otherKey,value:JSON.stringify({keep:true})}]);
    await db('CoachNotification').insert([{id:notice,tenantId,partnerId,programId,status:'unread',dedupeKey:`calendar:${materialId}`,data:JSON.stringify({kind:'calendar_publication'})},{id:otherNotice,tenantId,partnerId,programId,status:'unread',dedupeKey:`calendar:review:${materialId}`,data:JSON.stringify({kind:'human_review'})}]);
    await db('PartnerMaterial').where({id:materialId}).update({scheduledTime:'14:30',content:'Сохранённый материал'});
    await db.transaction(trx=>removeCalendarReminders(trx));
    expect(await db('Config').where({tenantId,key}).first()).toBeUndefined();
    expect(await db('Config').where({tenantId,key:otherKey}).first()).toBeTruthy();
    expect(await db('CoachNotification').where({id:notice}).first()).toBeUndefined();
    expect(await db('CoachNotification').where({id:otherNotice}).first()).toBeTruthy();
    expect(await db('PartnerMaterial').where({id:materialId}).first()).toMatchObject({scheduledTime:'14:30',content:'Сохранённый материал'});
    expect(await db.schema.hasColumn('PartnerMaterial','reminderEnabled')).toBe(false);
  });
});
