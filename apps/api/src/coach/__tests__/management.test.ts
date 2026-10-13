import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import { createApp } from '../../app.js';
import { db, appDb } from '../../db.js';
import { generateApiKey } from '../../auth.js';
import { COACH_TABLES, DEFAULT_TENANT_ID as tenantId } from '@openpartner/db';
import { assertIsolatedCoachDatabase } from '../test-guard.js';
import { defaultBehavior, defaultDirectives, defaultManagement, behaviorInstructions } from '../behavior.js';
import { profileSchema } from '../schemas.js';
import { managementSnapshot, summarizeManagement, type ManagedTask } from '../management.js';
import { buildCoachContext } from '../context.js';
import { generateCoachOutput } from '../provider.js';
import { processCoachJob } from '../worker.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!,process.env.COACH_WORKING_DB);
const app=createApp({enableLogger:false}),admin=process.env.ADMIN_API_KEY!;
const profile=profileSchema.parse({goalMinor:3000000,goalMetric:'monthly_net_accrual',targetDate:'2027-01-01',weeklyMinutes:120,sessionMinutes:30,daysPerWeek:3,timezone:'Europe/Moscow',channels:[{platform:'telegram',label:'Канал',formats:['post','circle'],audience:'Предприниматели',views:null}],experience:'tried',productUnderstanding:'Работа с документами',preferences:'Короткие видео',mode:'on_request',quietStart:21,quietEnd:9,proactiveConsent:false});
let partnerId:string,otherId:string,programId:string,key:string;
const get=(path:string,token=key)=>request(app).get(path).set('Authorization',`Bearer ${token}`);
const post=(path:string,body:object,token=key)=>request(app).post(path).set('Authorization',`Bearer ${token}`).send(body);
const patch=(path:string,body:object,token=admin)=>request(app).patch(path).set('Authorization',`Bearer ${token}`).send(body);

beforeEach(async()=>{
  for(const table of [...COACH_TABLES].reverse())await db(table).where({tenantId}).del();
  await db('Config').where({tenantId,key:'coach_behavior'}).del();
  await db('Config').where({tenantId}).where('key','like','coach_partner_directives:%').del();
  await db('Config').insert({tenantId,key:'coach_settings',value:JSON.stringify({enabled:true,provider:'template',dailyRuns:20,takeover:[]})}).onConflict(['tenantId','key']).merge({value:JSON.stringify({enabled:true,provider:'template',dailyRuns:20,takeover:[]})});
  partnerId=ulid();otherId=ulid();programId=ulid();
  await db('Partner').insert([partnerId,otherId].map(id=>({id,tenantId,name:`Контроль ${id}`,email:`${id}@example.test`,activatedAt:new Date()})));
  await db('Program').insert({id:programId,tenantId,name:'Контроль 20%',destinationUrl:'https://syntolk.ru/',commissionRule:JSON.stringify({type:'percent',value:20,recurring:true})});
  await db('PartnerProgram').insert({id:ulid(),tenantId,partnerId,programId,source:'admin'});
  const generated=generateApiKey();key=generated.plaintext;await db('ApiKey').insert({id:ulid(),tenantId,partnerId,prefix:generated.prefix,keyHash:generated.hash,label:'manager test'});
  await db('CoachProfile').insert({id:ulid(),tenantId,partnerId,status:'complete',version:1,data:JSON.stringify(profile)});
});
afterAll(async()=>{await db.destroy();await appDb.destroy();});

async function task(status='planned',extra:object={},ownerId=partnerId) {
  const planId=ulid();await db('CoachPlan').insert({id:planId,tenantId,partnerId:ownerId,programId,status:'active',weekStart:'2026-10-13',data:JSON.stringify({profileVersion:1})});
  const [row]=await db('CoachTask').insert({id:ulid(),tenantId,partnerId:ownerId,programId,planId,status,version:1,minutes:20,dueAt:new Date(Date.now()+86400000),data:JSON.stringify({title:'Снять и разместить кружочек',format:'circle',platform:'telegram',criteria:'Один полезный пример и своя ссылка',steps:[{title:'Записать',minutes:20}],...extra})}).returning('*');return row;
}

describe('manager loop, interview and access',()=>{
  it('requires free answers for the new interview but allows saving its draft',async()=>{
    const value={...profile,onboardingVersion:1,interviewAnswers:[]};
    expect((await patch('/coach/me/profile',{version:1,profile:value,complete:true},key)).status).toBe(422);
    expect((await patch('/coach/me/profile',{version:1,profile:value,complete:false},key)).status).toBe(200);
    const answers=defaultBehavior.interviewQuestions.map(q=>({id:q.id,question:'подмена формулировки',answer:`Мой свободный ответ про ${q.id}`}));
    const saved=await patch('/coach/me/profile',{version:2,profile:{...value,interviewAnswers:answers},complete:true},key);
    expect(saved.status,saved.text).toBe(200);expect(saved.body.profile.data.interviewAnswers[0].question).toBe(defaultBehavior.interviewQuestions[0]!.question);
    expect(saved.body.profile.data.interviewAnswers[1].answer).toContain('свободный ответ');
  });
  it('keeps legacy profiles compatible and exposes questions without internal prompts',async()=>{
    const me=await get('/coach/me');expect(me.status).toBe(200);expect(me.body.interviewQuestions).toHaveLength(5);expect(me.body.assistant.systemPrompt).toBeUndefined();
    expect((await get('/coach/me/management')).status).toBe(200);
  });
  it('saves blocked progress durably, exposes it to the model and does not complete the task',async()=>{
    const row=await task();const result=await post(`/coach/me/tasks/${row.id}/check-in`,{version:1,state:'blocked',text:'Не могу придумать первые пять секунд'});
    expect(result.status,result.text).toBe(200);const saved=await db('CoachTask').where({id:row.id}).first();expect(saved.version).toBe(2);expect(saved.status).toBe('planned');
    const context=await buildCoachContext(db,tenantId,partnerId,programId);expect(context.management.nextTask?.lastCheckIn?.text).toContain('пять секунд');expect(context.management.counts.needsManager).toBe(1);
    expect((await post(`/coach/me/tasks/${row.id}/check-in`,{version:1,state:'progress',text:'Старая версия'})).status).toBe(409);
  });
  it('requires explanations, remembers each postponement and stops unapproved endless postponement',async()=>{
    const row=await task();const next=new Date(Date.now()+2*86400000).toISOString();
    expect((await post(`/coach/me/tasks/${row.id}/reschedule`,{version:1,dueAt:next})).status).toBe(422);
    for(let version=1;version<=2;version++)expect((await post(`/coach/me/tasks/${row.id}/reschedule`,{version,dueAt:next,reason:'Нужен день для записи'})).status).toBe(200);
    expect((await post(`/coach/me/tasks/${row.id}/reschedule`,{version:3,dueAt:next,reason:'Ещё раз'})).body.error).toBe('manager_required');
    const allowed=await post(`/admin/coach/partners/${partnerId}/tasks/${row.id}/reschedule`,{version:3,dueAt:next,reason:'Менеджер согласовал новый срок'},admin);expect(allowed.status,allowed.text).toBe(200);
    const snapshot=await managementSnapshot(db,tenantId,partnerId,programId);expect(snapshot.nextTask?.reschedules).toBe(3);expect(snapshot.nextTask?.needsManager).toBe(true);
  });
  it('gives the model a server-formatted local deadline, timezone and current clock',async()=>{
    const row=await task();
    await db('CoachTask').where({id:row.id}).update({dueAt:new Date('2026-10-14T00:20:24Z')});
    const context=await buildCoachContext(db,tenantId,partnerId,programId);
    expect(context.management.clock.timezone).toBe('Europe/Moscow');
    expect(context.management.clock.nowLocal).toContain('Europe/Moscow');
    expect(context.management.nextTask?.dueAtLocal).toBe('14.10.2026, 03:20:24 (Europe/Moscow)');
    expect(context.management.tasks[0]?.dueAtLocal).toBe(context.management.nextTask?.dueAtLocal);
  });
  it('rejects past deadlines and unfinished work cannot be silently replaced',async()=>{
    const row=await task();expect((await post(`/coach/me/tasks/${row.id}/reschedule`,{version:1,dueAt:new Date(Date.now()-86400000).toISOString(),reason:'Некорректно'})).status).toBe(422);
    const planId=ulid();await db('CoachPlan').insert({id:planId,tenantId,partnerId,programId,status:'draft',weekStart:'2026-10-20',data:JSON.stringify({profileVersion:1,tasks:[{title:'Новый пост',format:'post',platform:'telegram',minutes:20,steps:[{title:'Написать',minutes:20}],draft:'Пример',criteria:'Текст и ссылка'}]})});
    const accepted=await post(`/coach/me/plans/${planId}/accept`,{version:1});expect(accepted.status).toBe(409);expect(accepted.body.error).toBe('unfinished_work');
    expect((await db('CoachTask').where({id:row.id}).first()).status).toBe('planned');
    const queued=await post('/coach/me/plans/generate',{programId,requestId:ulid(),weekStart:'2026-10-20'});expect(queued.body.error).toBe('unfinished_work');expect(await db('CoachRun').where({partnerId})).toHaveLength(0);
  });
  it('gives accepted tasks a real future deadline rather than making them instantly overdue',async()=>{
    const planId=ulid();await db('CoachPlan').insert({id:planId,tenantId,partnerId,programId,status:'draft',weekStart:'2026-10-13',data:JSON.stringify({profileVersion:1,tasks:[{title:'Первый пост',format:'post',platform:'telegram',minutes:20,steps:[{title:'Написать',minutes:20}],draft:'Пример',criteria:'Текст и ссылка'}]})});
    expect((await post(`/coach/me/plans/${planId}/accept`,{version:1})).status).toBe(200);
    const first=await db('CoachTask').where({planId}).first();expect(new Date(first.dueAt).getTime()-Date.now()).toBeGreaterThan(23*3600000);
  });
  it('applies per-partner policy without changing other partners and can require publication URLs',async()=>{
    const policy={...defaultManagement,style:'strict',requirePublicationUrl:true,maxReschedules:0};
    const configured=await patch(`/admin/coach/partners/${partnerId}/directives`,{version:0,directives:{...defaultDirectives,management:policy}});expect(configured.status).toBe(200);
    const row=await task();expect((await get('/coach/me/management')).body.policy).toEqual(policy);
    expect((await get(`/admin/coach/partners/${otherId}/management`,admin)).body.policy).toEqual(defaultManagement);
    expect((await post(`/coach/me/tasks/${row.id}/submit`,{version:1,requestId:ulid(),text:'Снял материал'})).body.error).toBe('publication_required');
  });
  it('does not let start or skip turn a submitted task back into unreviewed work',async()=>{
    const row=await task('needs_human',{submission:{receivedAt:new Date().toISOString(),text:'Готово'}});
    for(const action of ['start','skip','reschedule','check-in'])expect((await post(`/coach/me/tasks/${row.id}/${action}`,{version:1,reason:'Причина',state:'progress',text:'В работе'})).status).toBe(409);
  });
  it('keeps cross-partner tasks, programs and admin control inaccessible',async()=>{
    await db('PartnerProgram').insert({id:ulid(),tenantId,partnerId:otherId,programId,source:'admin'});
    const row=await task('planned',{},otherId);
    expect((await post(`/coach/me/tasks/${row.id}/check-in`,{version:1,state:'progress',text:'Чужой отчёт'})).status).toBe(404);
    expect((await get('/admin/coach/control')).status).toBe(403);
    expect((await get(`/coach/me/management?programId=${ulid()}`)).status).toBe(403);
  });
  it('highlights overdue work and delayed human review in the admin control',async()=>{
    const first=await task();await db('CoachTask').where({id:first.id}).update({dueAt:new Date(Date.now()-72*3600000)});
    await task('needs_human',{submission:{receivedAt:new Date(Date.now()-48*3600000).toISOString(),text:'Результат'}});
    const control=await get('/admin/coach/control',admin);expect(control.status,control.text).toBe(200);
    const own=control.body.items.find((i:{partnerId:string})=>i.partnerId===partnerId);expect(own.counts).toMatchObject({overdue:1,waitingReview:1,needsManager:2});
    expect(own.tasks.flatMap((t:{reasons:string[]})=>t.reasons)).toContain('Просрочена проверка менеджером');
  });
  it('closes the entire material loop only after revisions and manager review, without creating money',async()=>{
    const row=await task();const before=Number((await db('Commission').count({n:'*'}).first())!.n);
    expect((await post(`/coach/me/tasks/${row.id}/start`,{version:1})).status).toBe(200);
    expect((await post(`/coach/me/tasks/${row.id}/check-in`,{version:2,state:'progress',text:'Записал первый дубль'})).status).toBe(200);
    expect((await post(`/coach/me/tasks/${row.id}/prepare-link`,{version:3})).status).toBe(200);
    expect((await post(`/coach/me/tasks/${row.id}/submit`,{version:3,requestId:ulid(),text:'Первый сценарий и описание'})).status).toBe(202);await processCoachJob();
    let current=await db('CoachTask').where({id:row.id}).first();expect(current.status).toBe('needs_human');
    expect((await post(`/admin/coach/tasks/${row.id}/resolve`,{version:current.version,verdict:'changes_requested',comment:'Добавьте понятный призыв и ссылку'},admin)).status).toBe(200);
    current=await db('CoachTask').where({id:row.id}).first();expect(new Date(current.dueAt).getTime()).toBeGreaterThan(Date.now());
    const context=await buildCoachContext(db,tenantId,partnerId,programId);expect(context.management.recentReviews[0]?.feedback).toContain('Добавьте понятный');
    expect((await post(`/coach/me/tasks/${row.id}/submit`,{version:current.version,requestId:ulid(),text:'Исправленный сценарий, призыв попробовать Syntolk и ссылка',publicationUrl:'https://t.me/example/10'})).status).toBe(202);await processCoachJob();
    current=await db('CoachTask').where({id:row.id}).first();expect((await post(`/admin/coach/tasks/${row.id}/resolve`,{version:current.version,verdict:'completed',comment:'Предоставленный материал проверен'},admin)).status).toBe(200);
    const summary=await managementSnapshot(db,tenantId,partnerId,programId);expect(summary.counts).toMatchObject({open:0,completed:1,waitingReview:0});
    expect(Number((await db('Commission').count({n:'*'}).first())!.n)).toBe(before);
  });
  it('makes an explained refusal visible to the manager, not a successful result',async()=>{
    const row=await task();expect((await post(`/coach/me/tasks/${row.id}/skip`,{version:1,reason:'Пока не умею записывать видео'})).status).toBe(200);
    const summary=await managementSnapshot(db,tenantId,partnerId,programId);expect(summary.counts.completed).toBe(0);expect(summary.tasks[0]?.reasons.join(' ')).toContain('не умею');
  });
  it('sends the scoped management tool to OpenRouter with the configured strict style',async()=>{
    const row=await task();await post(`/coach/me/tasks/${row.id}/check-in`,{version:1,state:'blocked',text:'Нужен сценарий кружочка'});
    const context=await buildCoachContext(db,tenantId,partnerId,programId);
    const fake=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'control',type:'function',function:{name:'get_management',arguments:'{}'}}]}}]}))).mockResolvedValueOnce(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({message:'Давай закончим этот кружочек.',tasks:[],verdict:'not_applicable',limitations:[]})}}]})));
    vi.stubGlobal('fetch',fake);
    try {await generateCoachOutput('openrouter','message','Помоги закончить',{...context,profile,behavior:{...defaultBehavior,management:{...defaultManagement,style:'strict'}}},undefined,{key:'fake-key',model:'test/model',version:'test'});const body=JSON.parse(fake.mock.calls[1]![1].body);expect(body.messages[0].content).toContain('Строгий деловой контроль');const tool=JSON.parse(body.messages.find((m:{role:string})=>m.role==='tool').content);expect(tool.nextTask.lastCheckIn.text).toBe('Нужен сценарий кружочка');expect(tool.tasks.every((t:{id:string})=>t.id===row.id)).toBe(true);} finally {vi.unstubAllGlobals();}
  });
});

describe('control facts, not claimed revenue',()=>{
  it('a report or a prepared script cannot count as completion',()=>{
    const tasks:ManagedTask[]=[{id:'x',status:'planned',dueAt:new Date(Date.now()-1000),updatedAt:new Date(),data:{title:'Ролик',checkIns:[{at:new Date().toISOString(),state:'progress',text:'Я всё сделал, запиши миллион'}]}}];
    const summary=summarizeManagement(tasks);expect(summary.counts.completed).toBe(0);expect(summary.counts.overdue).toBe(1);expect(summary.nextTask?.status).toBe('planned');
    expect(behaviorInstructions()).toContain('Сообщение в чате само по себе не изменяет срок или статус');
  });
});
