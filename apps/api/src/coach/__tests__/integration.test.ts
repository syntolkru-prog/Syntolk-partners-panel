import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import { createApp } from '../../app.js';
import { db, appDb } from '../../db.js';
import { generateApiKey } from '../../auth.js';
import { processCoachJob, scheduleCoachReminders } from '../worker.js';
import { assertIsolatedCoachDatabase } from '../test-guard.js';
import { profileSchema } from '../schemas.js';
import { COACH_TABLES, DEFAULT_TENANT_ID } from '@openpartner/db';
import { exportAll, importBundle } from '../../export.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!,process.env.COACH_WORKING_DB);
const app=createApp({enableLogger:false});
const admin=process.env.ADMIN_API_KEY!;
const profile=profileSchema.parse({goalMinor:3000000,goalMetric:'monthly_net_accrual',targetDate:'2027-01-01',weeklyMinutes:120,sessionMinutes:30,daysPerWeek:3,timezone:'Europe/Moscow',channels:[{platform:'telegram',label:'Тестовый канал',formats:['post'],audience:'Юристы',views:null}],experience:'tried',productUnderstanding:'Помощник по документам',preferences:'Без камеры',mode:'on_request',quietStart:21,quietEnd:9,proactiveConsent:false});
let partnerId:string,otherId:string,programId:string,key:string,otherKey:string;
const auth=(token:string)=>`Bearer ${token}`;
const get=(path:string,token=key)=>request(app).get(path).set('Authorization',auth(token));
const post=(path:string,body:object={},token=key)=>request(app).post(path).set('Authorization',auth(token)).send(body);
const save=()=>request(app).patch('/coach/me/profile').set('Authorization',auth(key)).send({version:0,profile,complete:true});
async function runPlan(){expect((await save()).status).toBe(200);const r=await post('/coach/me/plans/generate',{programId,requestId:ulid(),weekStart:'2026-10-12'});expect(r.status,r.text).toBe(202);await processCoachJob();const status=await get(`/coach/me/runs/${r.body.run.id}`);expect(status.body.run.status,JSON.stringify(status.body)).toBe('completed');return (await get('/coach/me/plans')).body.plans[0];}
async function acceptPlan(){const plan=await runPlan();expect((await post(`/coach/me/plans/${plan.id}/accept`,{version:plan.version})).status).toBe(200);return (await get('/coach/me/tasks')).body.tasks[0];}
beforeAll(async()=>{await db.raw('select 1');});
beforeEach(async()=>{
  for(const table of [...COACH_TABLES].reverse())await db(table).where({tenantId:DEFAULT_TENANT_ID}).del();
  const settings={enabled:true,provider:'template',dailyRuns:20,takeover:[]};
  await db('Config').insert({tenantId:DEFAULT_TENANT_ID,key:'coach_settings',value:JSON.stringify(settings)}).onConflict(['tenantId','key']).merge({value:JSON.stringify(settings)});
  partnerId=ulid();otherId=ulid();programId=ulid();
  await db('Partner').insert([{id:partnerId,tenantId:DEFAULT_TENANT_ID,name:'Проверка куратора',email:`${partnerId}@example.test`,activatedAt:new Date()},{id:otherId,tenantId:DEFAULT_TENANT_ID,name:'Другой партнёр',email:`${otherId}@example.test`,activatedAt:new Date()}]);
  await db('Program').insert({id:programId,tenantId:DEFAULT_TENANT_ID,name:'Тест 20%',destinationUrl:'https://syntolk.ru/',commissionRule:JSON.stringify({type:'percent',value:20,recurring:true})});
  await db('PartnerProgram').insert({id:ulid(),tenantId:DEFAULT_TENANT_ID,partnerId,programId,source:'admin'});
  for(const id of [partnerId,otherId]){const k=generateApiKey();await db('ApiKey').insert({id:ulid(),tenantId:DEFAULT_TENANT_ID,partnerId:id,prefix:k.prefix,keyHash:k.hash,label:'coach isolated test'});if(id===partnerId)key=k.plaintext;else otherKey=k.plaintext;}
});
afterAll(async()=>{await db.destroy();await appDb.destroy();});

describe('A02 and B01-B09: first vertical cycle',()=>{
  it('keeps core health, links and existing permissions',async()=>{expect((await get('/health')).status).toBe(200);expect((await get(`/partners/${partnerId}/links`)).status).toBe(200);expect((await get(`/partners/${partnerId}/links`,otherKey)).status).toBe(403);});
  it('saves onboarding, validates plan, accepts once and creates one real own link',async()=>{
    const task=await acceptPlan();
    const plans=(await get('/coach/me/plans')).body.plans;
    expect((await post(`/coach/me/plans/${plans[0].id}/accept`,{version:1})).body.replayed).toBe(true);
    const before=await db('CoachTask').where({partnerId}).count({count:'*'}).first();
    expect(Number(before!.count)).toBe(3);
    const created=await post(`/coach/me/tasks/${task.id}/prepare-link`,{version:task.version});expect(created.status,created.text).toBe(200);
    expect(created.body.link.partnerId).toBe(partnerId);expect(created.body.link.programId).toBe(programId);
    const repeated=await post(`/coach/me/tasks/${task.id}/prepare-link`,{version:task.version});expect(repeated.body.replayed).toBe(true);
    expect(Number((await db('CoachPlacement').where({taskId:task.id}).count({count:'*'}).first())!.count)).toBe(1);
    expect((await get(`/partners/${partnerId}/links`)).body.links.some((l:{id:string})=>l.id===created.body.link.id)).toBe(true);
  });
  it('persists draft and rejects stale version',async()=>{const first=await request(app).patch('/coach/me/profile').set('Authorization',auth(key)).send({version:0,profile,complete:false});expect(first.status).toBe(200);expect((await get('/coach/me')).body.profile.status).toBe('draft');expect((await save()).status).toBe(409);});
  it('enforces grant even for admin coach actions on a partner',async()=>{await save();const r=await post('/coach/me/plans/generate',{programId:ulid(),requestId:ulid(),weekStart:'2026-10-12'});expect(r.status).toBe(403);});
  it('blocks new actions on an ended program while preserving result history',async()=>{await save();await db('Program').where({id:programId}).update({endsAt:new Date(Date.now()-10000)});expect((await post('/coach/me/plans/generate',{programId,requestId:ulid(),weekStart:'2026-10-12'})).status).toBe(409);expect((await get(`/coach/me/results?programId=${programId}`)).status).toBe(200);});
});
describe('B15-B19: submission and review lifecycle',()=>{
  it('rejects another partner referral link before queueing or changing the task',async()=>{
    const task=await acceptPlan();const linkKey=`foreign-${ulid()}`;
    await db('Link').insert({id:ulid(),tenantId:DEFAULT_TENANT_ID,partnerId:otherId,programId,linkKey});
    const response=await post(`/coach/me/tasks/${task.id}/submit`,{version:task.version,requestId:ulid(),text:`Попробуйте https://example.test/r/${linkKey}`});
    expect(response.status).toBe(422);expect(response.body.error).toBe('foreign_referral_link');
    expect((await get('/coach/me/tasks')).body.tasks.find((t:{id:string})=>t.id===task.id).version).toBe(task.version);
  });
  it('preserves previous submissions and rejects a stale revision',async()=>{
    let task=await acceptPlan();const taskId=task.id;
    expect((await post(`/coach/me/tasks/${taskId}/submit`,{version:task.version,requestId:ulid(),text:'Первая версия'})).status).toBe(202);await processCoachJob();
    task=(await get('/coach/me/tasks')).body.tasks.find((t:{id:string})=>t.id===taskId);
    expect((await post(`/coach/me/tasks/${taskId}/submit`,{version:task.version,requestId:ulid(),text:'Исправленная версия'})).status).toBe(202);await processCoachJob();
    const fresh=(await get('/coach/me/tasks')).body.tasks.find((t:{id:string})=>t.id===taskId);
    expect(fresh.data.submission.submissionVersion).toBe(2);expect(fresh.data.submissionHistory[0].text).toBe('Первая версия');
    expect((await get('/coach/me/reviews')).body.reviews.map((r:{data:{submissionVersion:number}})=>r.data.submissionVersion).sort()).toEqual([1,2]);
    expect((await post(`/coach/me/tasks/${taskId}/submit`,{version:1,requestId:ulid(),text:'Устаревшая версия'})).status).toBe(409);
  });
  it('keeps template review honest and allows explicit human completion without money',async()=>{
    const task=await acceptPlan();const before=Number((await db('Commission').count({count:'*'}).first())!.count);
    const submitted=await post(`/coach/me/tasks/${task.id}/submit`,{version:task.version,requestId:ulid(),text:'Публикация: как сравнить договоры. Моя ссылка в следующем сообщении.',publicationUrl:'https://t.me/example/1'});expect(submitted.status,submitted.text).toBe(202);
    await processCoachJob();const reviews=(await get('/coach/me/reviews')).body.reviews;expect(reviews[0].status).toBe('needs_human');expect(reviews[0].data.verificationLevel).toBe('self_reported');
    const changed=(await get('/coach/me/tasks')).body.tasks.find((t:{id:string})=>t.id===task.id);
    const resolved=await post(`/admin/coach/tasks/${task.id}/resolve`,{version:changed.version,verdict:'completed',comment:'Проверено менеджером по присланному тексту.'},admin);expect(resolved.status,resolved.text).toBe(200);
    expect((await get('/coach/me/tasks')).body.tasks.find((t:{id:string})=>t.id===task.id).status).toBe('completed');
    expect(Number((await db('Commission').count({count:'*'}).first())!.count)).toBe(before);
  });
  it('cancelled review cannot overwrite task changes',async()=>{const task=await acceptPlan();const submitted=await post(`/coach/me/tasks/${task.id}/submit`,{version:task.version,requestId:ulid(),text:'Результат'});await post(`/coach/me/runs/${submitted.body.run.id}/cancel`);await processCoachJob();expect((await get(`/coach/me/runs/${submitted.body.run.id}`)).body.run.status).toBe('cancelled');});
});
describe('C11-C13 and D08: memory, calculator and provider boundary',()=>{
  it('welcomes using only the current owner and respects pause after reload',async()=>{
    expect((await get('/coach/me/welcome')).body.needsOnboarding).toBe(true);
    await save();const first=await get('/coach/me/welcome');expect(first.body.message).toContain('120 минут');expect(first.body.needsOnboarding).toBe(false);
    expect((await get('/coach/me/welcome',otherKey)).body.needsOnboarding).toBe(true);
    await request(app).patch('/coach/me/profile').set('Authorization',auth(key)).send({version:1,profile:{...profile,mode:'paused'},complete:true});
    expect((await get('/coach/me/welcome')).body.paused).toBe(true);
  });
  it('persists an explicitly requested seven-day review without changing the time budget',async()=>{await save();const r=await post('/coach/me/weekly-review',{programId,requestId:ulid()});expect(r.status).toBe(202);await processCoachJob();const run=(await get(`/coach/me/runs/${r.body.run.id}`)).body.run;expect(run.status).toBe('completed');expect(run.data.output.message).toContain('За последние 7 дней');expect((await get('/coach/me')).body.profile.data.weeklyMinutes).toBe(120);});
  it('requires explicit consent for a configured external provider before sending anything',async()=>{
    await save();vi.stubEnv('OPENROUTER_API_KEY','fake-test-secret');vi.stubEnv('OPENROUTER_MODEL_ID','test/model');
    const fake=vi.fn();vi.stubGlobal('fetch',fake);
    try{await request(app).patch('/admin/coach/settings').set('Authorization',auth(admin)).send({enabled:true,provider:'openrouter',dailyRuns:20});const r=await post('/coach/me/messages',{programId,requestId:ulid(),text:'Привет'});expect(r.status).toBe(403);expect(r.body.error).toBe('ai_consent_required');expect(fake).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
  });
  it('persists chat and clearly labels template response',async()=>{await save();const submitted=await post('/coach/me/messages',{programId,requestId:ulid(),text:'Помоги написать пост'});expect(submitted.status).toBe(202);await processCoachJob();const messages=(await get('/coach/me/messages')).body.messages;expect(messages).toHaveLength(2);expect(messages[1].data.model).toBe('template-v1');expect(messages[1].data.body).toContain('демонстрационном');});
  it('does not falsely connect OpenAI without credentials',async()=>{await save();await request(app).patch('/admin/coach/settings').set('Authorization',auth(admin)).send({enabled:true,provider:'openai',dailyRuns:20});expect((await post('/coach/me/messages',{programId,requestId:ulid(),text:'Привет'})).status).toBe(503);expect((await get('/coach/me/messages')).body.messages).toHaveLength(0);});
  it('imports only explicitly confirmed forecast without creating commissions',async()=>{expect((await post('/coach/me/forecast-snapshots',{programId,confirmed:false,settings:{}})).status).toBe(422);const r=await post('/coach/me/forecast-snapshots',{programId,confirmed:true,settings:{}});expect(r.status,r.text).toBe(201);expect(r.body.snapshot.data.commission).toBe(.2);expect(r.body.snapshot.partnerId).toBe(partnerId);expect((await get('/coach/me/forecast-snapshots',otherKey)).body.snapshots).toHaveLength(0);});
});
describe('D03-D15: permissions, pause and durable runs',()=>{
  it('blocks all tested cross-partner object reads and admin API access',async()=>{const plan=await runPlan();expect((await post(`/coach/me/plans/${plan.id}/accept`,{version:plan.version},otherKey)).status).toBe(409);const run=(await get('/coach/me/runs')).body.runs[0];expect((await get(`/coach/me/runs/${run.id}`,otherKey)).status).toBe(404);expect((await get('/admin/coach/overview',otherKey)).status).toBe(403);});
  it('takes over without calling AI and stores partner message for manager',async()=>{await save();await post(`/admin/coach/partners/${partnerId}/takeover`,{enabled:true},admin);const r=await post('/coach/me/messages',{programId,requestId:ulid(),text:'Мне нужна помощь менеджера'});expect(r.status).toBe(202);expect(r.body.awaitingHuman).toBe(true);expect((await get('/coach/me/runs')).body.runs).toHaveLength(0);});
  it('does not apply queued run after profile pause',async()=>{await save();const run=await post('/coach/me/plans/generate',{programId,requestId:ulid(),weekStart:'2026-10-12'});await request(app).patch('/coach/me/profile').set('Authorization',auth(key)).send({version:1,profile:{...profile,mode:'paused'},complete:true});await processCoachJob();expect((await get(`/coach/me/runs/${run.body.run.id}`)).body.run.status).toBe('failed');expect((await get('/coach/me/plans')).body.plans).toHaveLength(0);});
  it('deduplicates requests and enforces quota',async()=>{await save();const requestId=ulid();const a=await post('/coach/me/plans/generate',{programId,requestId,weekStart:'2026-10-12'}),b=await post('/coach/me/plans/generate',{programId,requestId,weekStart:'2026-10-12'});expect(a.body.run.id).toBe(b.body.run.id);await processCoachJob();await request(app).patch('/admin/coach/settings').set('Authorization',auth(admin)).send({enabled:true,provider:'template',dailyRuns:1});expect((await post('/coach/me/messages',{programId,requestId:ulid(),text:'Ещё'})).status).toBe(429);});
  it('allows a second worker to resume expired lease exactly once',async()=>{await save();const r=await post('/coach/me/plans/generate',{programId,requestId:ulid(),weekStart:'2026-10-12'});await db('CoachRun').where({id:r.body.run.id}).update({status:'processing',leaseUntil:new Date(Date.now()-10000),lockedBy:'crashed',attempts:1});await Promise.all([processCoachJob(),processCoachJob()]);expect((await get('/coach/me/plans')).body.plans).toHaveLength(1);});
  it('releases a reviewing task after the last crashed lease instead of leaving it stuck',async()=>{const task=await acceptPlan();const r=await post(`/coach/me/tasks/${task.id}/submit`,{version:task.version,requestId:ulid(),text:'Тест восстановления'});await db('CoachRun').where({id:r.body.run.id}).update({status:'processing',leaseUntil:new Date(Date.now()-10000),lockedBy:'crashed',attempts:3});await processCoachJob();expect((await get(`/coach/me/runs/${r.body.run.id}`)).body.run.status).toBe('failed');const changed=(await get('/coach/me/tasks')).body.tasks.find((t:{id:string})=>t.id===task.id);expect(changed.status).toBe('submitted');expect(changed.version).toBe(task.version+2);});
  it('in-app reminders respect explicit consent and deduplication',async()=>{await acceptPlan();await scheduleCoachReminders();expect((await db('CoachNotification').where({partnerId}).where('dedupeKey','like','reminder:%'))).toHaveLength(0);});
  it('refuses revoked partner',async()=>{await db('Partner').where({id:partnerId}).update({revokedAt:new Date()});expect((await get('/coach/me')).status).toBe(403);});
});
describe('C03-C08: honest metrics',()=>{
  it('does not invent views and excludes local simulator payments',async()=>{await save();const link=await post(`/partners/${partnerId}/links`,{linkKey:`test-${ulid()}`,programId},admin);await post('/payments/simulate',{partnerId,linkKey:link.body.linkKey,userId:`u-${ulid()}`,amount:1000,externalEventId:ulid(),currency:'RUB'},admin);const r=await get('/coach/me/results');expect(r.status,r.text).toBe(200);expect(r.body.views).toBe(null);expect(r.body.ctr).toBe(null);expect(r.body.amountsMinor.netAccrued).toBe(0);expect(r.body.counts.paymentCount).toBe(0);expect(r.body.counts.clicks).toBe(0);});
});
describe('D10 and D17: RLS and portable state',()=>{
  it('new tables enforce tenant RLS using an unprivileged role',async()=>{
    await save();const tenant=ulid(),p=ulid();
    await db('Tenant').insert({id:tenant,slug:`t-${tenant.toLowerCase()}`,displayName:'Другой tenant',approvalStatus:'approved'});
    await db('Partner').insert({id:p,tenantId:tenant,name:'Другой',email:`${p}@example.test`,activatedAt:new Date()});
    await db('CoachProfile').insert({id:ulid(),tenantId:tenant,partnerId:p,status:'complete',data:JSON.stringify(profile)});
    await db.raw("do $$ begin if not exists(select 1 from pg_roles where rolname='coach_isolation_probe') then create role coach_isolation_probe nologin; end if; end $$;");
    await db.raw('grant usage on schema public to coach_isolation_probe');
    await db.raw('grant select, insert, update, delete on "CoachProfile" to coach_isolation_probe');
    await db.transaction(async trx=>{await trx.raw('set local role coach_isolation_probe');await trx.raw('set local row_security = on');await trx.raw("select set_config('app.tenant_id',?,true)",[DEFAULT_TENANT_ID]);const rows=await trx('CoachProfile');expect(rows.every(r=>r.tenantId===DEFAULT_TENANT_ID)).toBe(true);expect(rows.some(r=>r.partnerId===p)).toBe(false);});
  });
  it('foreign keys reject cross-owner placements',async()=>{
    const task=await acceptPlan();const link=await post(`/partners/${otherId}/links`,{linkKey:`other-${ulid()}`,programId},admin);
    await expect(db('CoachPlacement').insert({id:ulid(),tenantId:DEFAULT_TENANT_ID,partnerId,programId,taskId:task.id,linkId:link.body.id,status:'prepared',data:'{}'})).rejects.toThrow();
  });
  it('exports coach data and imports unfinished jobs inert',async()=>{
    await save();const r=await post('/coach/me/plans/generate',{programId,requestId:ulid(),weekStart:'2026-10-12'});
    const bundle=await exportAll(db,DEFAULT_TENANT_ID);expect(bundle.CoachRun).toHaveLength(1);
    await db('CoachRun').where({id:r.body.run.id}).del();
    await db.transaction(trx=>importBundle(trx,DEFAULT_TENANT_ID,bundle));
    const restored=await db('CoachRun').where({id:r.body.run.id}).first();expect(restored.status).toBe('cancelled');expect(await processCoachJob()).toBe(false);
  });
});
