import {afterAll,beforeEach,describe,expect,it} from 'vitest';
import request from 'supertest';
import {ulid} from 'ulid';
import {DEFAULT_TENANT_ID as tenantId} from '@openpartner/db';
import {createApp} from '../../app.js';
import {db,appDb} from '../../db.js';
import {generateApiKey} from '../../auth.js';
import {assertIsolatedCoachDatabase} from '../test-guard.js';
import {calculateCoachForecast} from '../forecast-adapter.js';
import {calculatorSchedule,CALCULATOR_PLAN_SOURCE} from '../calculator-plan.js';
import {localDay} from '../daily-plan.js';
import {buildCoachContext} from '../context.js';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
assertIsolatedCoachDatabase(process.env.DATABASE_URL!,process.env.COACH_WORKING_DB);
const app=createApp({enableLogger:false});
let partnerId:string,otherId:string,programId:string,key:string,settings:Record<string,unknown>;
const get=(path:string)=>request(app).get(path).set('Authorization',`Bearer ${key}`);
const post=(path:string,body:object)=>request(app).post(path).set('Authorization',`Bearer ${key}`).send(body);
const day=()=>localDay(new Date(),'Europe/Moscow');
async function save(){const response=await post('/coach/me/forecast-snapshots',{programId,confirmed:true,settings});expect(response.status,response.text).toBe(201);return response.body.snapshot.id as string;}
async function saveNamed(name:string){const response=await post('/coach/me/forecast-snapshots',{programId,confirmed:true,settings,scenarioName:name,scenarioId:`scenario-${name.toLowerCase()}`});expect(response.status,response.text).toBe(201);return {id:response.body.snapshot.id as string,scenarioId:response.body.snapshot.data.scenarioId as string};}
async function build(extra:object={}){return post('/coach/me/calculator-plan',{programId,snapshotId:await save(),startDate:day(),days:7,weekdays:[0,1,2,3,4,5,6],requestId:ulid(),...extra});}
beforeEach(async()=>{
 partnerId=ulid();otherId=ulid();programId=ulid();
  await db('Config').insert({tenantId,key:'coach_settings',value:JSON.stringify({enabled:true,provider:'template',dailyRuns:20,takeover:[]})}).onConflict(['tenantId','key']).merge({value:JSON.stringify({enabled:true,provider:'template',dailyRuns:20,takeover:[]})});
 const credential=generateApiKey();key=credential.plaintext;
 await db('Partner').insert([partnerId,otherId].map(id=>({id,tenantId,name:'Календарь из калькулятора',email:`${id}@example.test`,activatedAt:new Date()})));
 await db('Program').insert({id:programId,tenantId,name:'Syntolk',destinationUrl:'https://syntolk.ru/',commissionRule:JSON.stringify({type:'percent',value:20})});
 await db('PartnerProgram').insert({id:ulid(),tenantId,partnerId,programId,source:'admin'});
 await db('ApiKey').insert({id:ulid(),tenantId,partnerId,prefix:credential.prefix,keyHash:credential.hash});
 const original=await calculateCoachForecast({});
 settings={...original.settings,budgetHours:4,adminMinutes:0,publishMinutes:3,frequency:{post:0,short:2,long:0,article:0,circle:0},channels:Object.fromEntries(original.channels.map((c:{id:string})=>[c.id,{...original.settings.channels[c.id],formats:['telegram-short','ytshorts'].includes(c.id)?['short']:[]}]))};
});
afterAll(async()=>{await db.destroy();await appDb.destroy();});
describe('calculator is the sole work-plan source',()=>{
 it('saves ten posts per week on all matching platforms as one calendar with forty materials',async()=>{
  const context={SyntolkForecast:undefined as unknown as {selectMatchingChannels:(input:Record<string,unknown>)=>Record<string,unknown>}};
  runInNewContext(readFileSync(resolve('../../apps/portal/public/calculator/forecast-model.js'),'utf8'),context);
  settings=context.SyntolkForecast.selectMatchingChannels({...settings,frequency:{post:10,short:0,long:0,article:0,circle:0}});
  const preview=await post('/coach/me/calculator-plan/preview',{programId,settings,startDate:day(),days:28,weekdays:[1,2,3,4,5]});
  expect(preview.status,preview.text).toBe(200);expect(preview.body.originals).toBe(40);expect(preview.body.placements).toBe(240);
  const saved=await post('/coach/me/calculator-plan',{programId,snapshotId:await save(),startDate:day(),days:28,weekdays:[1,2,3,4,5],requestId:ulid()});
  expect(saved.status,saved.text).toBe(201);
  const calendar=await get(`/coach/me/calculator-plan?programId=${programId}`);
  expect(calendar.body.tasks).toHaveLength(40);
  expect(calendar.body.tasks.every((task:{data:{format:string;placements:unknown[]}})=>task.data.format==='post'&&task.data.placements.length===6)).toBe(true);
 });
 it('excludes a disabled source even when its format checkbox is retained',async()=>{
  const configured=structuredClone(settings);
  const channels=configured.channels as Record<string,{enabled:boolean;formats:string[]}>;
  channels['telegram-short']!.enabled=false;
  const result=await calculatorSchedule(configured,day(),7,[1,2,3,4,5]);
  expect(result.tasks.filter(t=>t.kind==='content')).toHaveLength(2);
  expect(result.tasks.every(t=>t.placements.length===1&&t.placements[0]!.id==='ytshorts')).toBe(true);
  expect(result.tasks.every(task=>!('minutes' in task))).toBe(true);
  expect(result.tasks.reduce((sum,t)=>sum+t.estimatedViews,0)).toBe(2400);
  channels.ytshorts!.enabled=false;
  await expect(calculatorSchedule(configured,day(),7,[1,2,3,4,5])).rejects.toMatchObject({code:'calculator_unplaced'});
 });
 it('previews and saves the same custom-format monthly work without extra links or AI calls',async()=>{
  settings={...settings,customFormats:[{id:'format-live',name:'Прямой эфир',base:'long',minutes:30}],removedFormats:['short'],removedChannels:['ytshorts'],channelOverrides:{youtube:{name:'Мой YouTube',url:'https://youtube.com/'}},frequency:{post:0,long:0,article:0,circle:0,'format-live':1},channels:{...(settings.channels as object),youtube:{formats:['format-live'],views:900,ctr:2}}};
  const input={programId,startDate:day(),days:30,weekdays:[1,3,5],settings};
  const preview=await post('/coach/me/calculator-plan/preview',input);expect(preview.status,preview.text).toBe(200);
  expect(preview.body.originals).toBe(4);expect(preview.body.placements).toBe(4);
  expect(preview.body.tasks.every((t:{format:string;placements:Array<{name:string}>})=>t.format==='format-live'&&t.placements[0]?.name==='Мой YouTube')).toBe(true);
  expect(await db('Link').where({partnerId})).toHaveLength(0);expect(await db('CoachPlan').where({partnerId})).toHaveLength(0);
  const saved=await build({days:30,weekdays:[1,3,5]});expect(saved.status,saved.text).toBe(201);
  const view=await get(`/coach/me/calculator-plan?programId=${programId}`);
  expect(view.body.tasks.map((t:{data:{key:string}})=>t.data.key).sort()).toEqual(preview.body.tasks.map((t:{key:string})=>t.key).sort());
  const context=await buildCoachContext(db,tenantId,partnerId,programId);expect(context.currentTasks[0]!.title).toContain('Прямой эфир');
 });
 it('supports a year of tasks and respects the calculator publication stop month',async()=>{
  const year=await build({days:365});expect(year.status,year.text).toBe(201);expect(year.body.plan.data.originals).toBe(104);
  const stopped=await calculatorSchedule({...settings,stopAfter:1},day(),90,[0,1,2,3,4,5,6]);
  expect(stopped.tasks.filter(t=>t.kind==='content')).toHaveLength(8);
  expect(stopped.tasks.every(t=>Math.round((Date.parse(t.day)-Date.parse(day()))/86400000)<32)).toBe(true);
  expect((await post('/coach/me/calculator-plan/preview',{programId:ulid(),settings,startDate:day(),days:30,weekdays:[1]})).status).toBe(403);
 });
 it('creates two human-sized content tasks with all four placements inside them',async()=>{
  const result=await calculatorSchedule(settings,day(),7,[0,1,2,3,4,5,6]);
  expect(result.tasks.filter(t=>t.kind==='content')).toHaveLength(2);expect(result.tasks.flatMap(t=>t.placements)).toHaveLength(4);
  expect(result.tasks.filter(t=>t.kind==='content').every(t=>t.placements.length===2&&t.estimatedViews>0)).toBe(true);
  expect(new Set(result.tasks.map(t=>t.format))).toEqual(new Set(['short']));
  expect(result.tasks.every(task=>!('minutes' in task))).toBe(true);
 });
 it('includes a partner-created platform in forecasts, tasks, tips and links',async()=>{
  const customId='custom-my-community';
  const configured={...settings,customChannels:[{id:customId,name:'Моё сообщество',url:'https://example.test/join',formats:['short'],views:777,ctr:2}],channels:{...(settings.channels as object),[customId]:{formats:['short'],views:777,ctr:2}}};
  const result=await calculatorSchedule(configured,day(),7,[0,1,2,3,4,5,6]);
  expect(result.forecast.channels.some((channel:{id:string})=>channel.id===customId)).toBe(true);
  expect(result.tasks.filter(t=>t.kind==='content').every(t=>t.placements.some(p=>p.id===customId)&&t.suggestedResources.some(p=>p.url==='https://example.test/join'))).toBe(true);
 });
 it('carries fractional frequency across four weeks and respects chosen workdays',async()=>{
  const s={...settings,frequency:{post:0,short:0,long:0,article:.25,circle:0},channels:{...(settings.channels as object),dzen:{formats:['article'],views:400,ctr:1}},adminMinutes:0};
  const r=await calculatorSchedule(s,day(),28,[1,3,5]);expect(r.tasks.filter(t=>t.kind==='content')).toHaveLength(1);
  expect(r.tasks.every(t=>[1,3,5].includes(new Date(t.day).getUTCDay()))).toBe(true);
 });
 it('ignores obsolete time budgets and rejects an empty calculator',async()=>{
  expect((await calculatorSchedule({...settings,budgetHours:0,adminMinutes:70},day(),7,[0,1,2,3,4,5,6])).tasks).toHaveLength(2);
  await expect(calculatorSchedule({...settings,frequency:{post:0,short:0,long:0,article:0,circle:0}},day(),7,[0,1,2,3,4,5,6])).rejects.toMatchObject({code:'calculator_empty'});
 });
 it('saves a real calendar without auto-created links and without AI or money side effects',async()=>{
  const response=await build();expect(response.status,response.text).toBe(201);
  expect(response.body.plan.data).toMatchObject({source:CALCULATOR_PLAN_SOURCE,originals:2,placements:4});
  const view=await get(`/coach/me/calculator-plan?programId=${programId}`);expect(view.status).toBe(200);expect(view.body.tasks).toHaveLength(2);expect(view.body.tasks.flatMap((t:{links:unknown[]})=>t.links)).toHaveLength(0);
  const context=await buildCoachContext(db,tenantId,partnerId,programId);expect(context.activePlan).toMatchObject({source:CALCULATOR_PLAN_SOURCE,originals:2});expect(context.currentTasks).toHaveLength(2);
  expect(Number((await db('CoachRun').where({partnerId}).count({n:'*'}).first())!.n)).toBe(0);
  expect(Number((await db('Commission').where({partnerId}).count({n:'*'}).first())!.n)).toBe(0);
 });
	it('keeps calculator settings and calendars isolated between named scenarios',async()=>{
  const first=await saveNamed('Сценарий один');
  const firstPlan=await post('/coach/me/calculator-plan',{programId,snapshotId:first.id,scenarioId:first.scenarioId,startDate:day(),days:7,weekdays:[0,1,2,3,4,5,6],requestId:ulid()});
  const second=await saveNamed('Сценарий два');
  const secondPlan=await post('/coach/me/calculator-plan',{programId,snapshotId:second.id,scenarioId:second.scenarioId,startDate:day(),days:14,weekdays:[1,2,3,4,5],requestId:ulid()});
  expect(firstPlan.status,firstPlan.text).toBe(201);expect(secondPlan.status,secondPlan.text).toBe(201);
  expect((await db('CoachPlan').where({partnerId,programId,status:'active'}))).toHaveLength(2);
  const one=await get(`/coach/me/calculator-plan?programId=${programId}&scenarioId=${first.scenarioId}`);
  const two=await get(`/coach/me/calculator-plan?programId=${programId}&scenarioId=${second.scenarioId}`);
  expect(one.body.plan.data.scenarioName).toBe('Сценарий один');expect(one.body.plan.data.days).toBe(7);
  expect(two.body.plan.data.scenarioName).toBe('Сценарий два');expect(two.body.plan.data.days).toBe(14);
  expect(one.body.tasks).not.toEqual(two.body.tasks);
 });
	it('archives one deleted scenario without deleting completed history',async()=>{
  const saved=await saveNamed('Удаляемый сценарий');
  const built=await post('/coach/me/calculator-plan',{programId,snapshotId:saved.id,scenarioId:saved.scenarioId,startDate:day(),days:7,weekdays:[0,1,2,3,4,5,6],requestId:ulid()});
  const tasks=await db('CoachTask').where({planId:built.body.plan.id}).orderBy('createdAt');
  expect((await post(`/coach/me/calculator-plan/tasks/${tasks[0]!.id}/complete`,{version:1,completed:true})).status).toBe(200);
  const removed=await request(app).delete(`/coach/me/forecast-snapshots/${saved.scenarioId}?programId=${programId}`).set('Authorization',`Bearer ${key}`);
  expect(removed.status,removed.text).toBe(200);
  expect((await get(`/coach/me/forecast-snapshots?programId=${programId}`)).body.snapshots.some((row:{data:{scenarioId?:string}})=>row.data.scenarioId===saved.scenarioId)).toBe(false);
  const view=await get(`/coach/me/calculator-plan?programId=${programId}&scenarioId=${saved.scenarioId}`);expect(view.body.plan).toBeNull();expect(view.body.tasks).toHaveLength(0);
  expect((await db('CoachPlan').where({id:built.body.plan.id}).first()).status).toBe('archived');
  expect((await db('CoachTask').where({id:tasks[0]!.id}).first()).status).toBe('completed');
  expect((await db('CoachTask').where({planId:built.body.plan.id}).where('status','cancelled'))).toHaveLength(tasks.length-1);
 });
 it('replays the same request without duplicate tasks or links',async()=>{
  const body={programId,snapshotId:await save(),startDate:day(),days:7,weekdays:[0,1,2,3,4,5,6],requestId:ulid()};
  const a=await post('/coach/me/calculator-plan',body),b=await post('/coach/me/calculator-plan',body);expect(a.status,a.text).toBe(201);expect(b.body.plan.id).toBe(a.body.plan.id);
  expect(Number((await db('Link').where({partnerId}).count({n:'*'}).first())!.n)).toBe(0);
  expect((await post('/coach/me/calculator-plan',{...body,days:14})).body.error).toBe('idempotency_conflict');
 });
 it('refuses another partner snapshot and an ungranted program',async()=>{
  const id=await save();await db('CoachForecastSnapshot').where({id}).update({partnerId:otherId});
  const r=await build({snapshotId:id});expect(r.status).toBe(409);
  expect((await get(`/coach/me/calculator-plan?programId=${ulid()}`)).status).toBe(403);
 });
 it('archives old work on explicit rebuild, protects versions and retains completed history',async()=>{
  const first=await build();const p=first.body.plan;
  const old=await db('CoachTask').where({planId:p.id}).first();
  expect((await post(`/coach/me/calculator-plan/tasks/${old.id}/complete`,{version:1,completed:true})).status).toBe(200);
  expect((await post(`/coach/me/calculator-plan/tasks/${old.id}/complete`,{version:1,completed:false})).status).toBe(409);
  expect((await build()).body.error).toBe('calendar_exists');
  const second=await build({replacePlanId:p.id,replaceVersion:p.version});expect(second.status,second.text).toBe(201);
  expect((await db('CoachPlan').where({id:p.id}).first()).status).toBe('archived');expect((await db('CoachTask').where({id:old.id}).first()).status).toBe('completed');
  expect((await post(`/coach/me/calculator-plan/tasks/${old.id}/complete`,{version:2,completed:false})).status).toBe(409);
 });
 it('allows the admin to read the exact same partner calendar',async()=>{
  await build();const view=await request(app).get(`/admin/coach/partners/${partnerId}/calculator-plan?programId=${programId}`).set('Authorization',`Bearer ${process.env.ADMIN_API_KEY}`);
  expect(view.status,view.text).toBe(200);expect(view.body.tasks).toHaveLength(2);
 });
 it('works with AI disabled, while old AI-plan endpoints cannot replace calculator work',async()=>{
  const first=await build();
  const legacy=await post('/coach/me/plans/generate',{programId,requestId:ulid(),weekStart:day()});expect(legacy.status).toBe(410);expect(legacy.body.error).toBe('calculator_workflow');
  await db('Config').where({tenantId,key:'coach_settings'}).update({value:JSON.stringify({enabled:false,provider:'template',dailyRuns:20,takeover:[]})});
  const next=await build({replacePlanId:first.body.plan.id,replaceVersion:first.body.plan.version});expect(next.status,next.text).toBe(201);
  const task=await db('CoachTask').where({planId:next.body.plan.id}).first();
  expect((await post(`/coach/me/calculator-plan/tasks/${task.id}/complete`,{version:1,completed:true})).status).toBe(200);
  expect((await post('/coach/me/messages',{programId,clientMessageId:ulid(),message:'Тест'})).body.error).toBe('coach_disabled');
 });
 it.each(['partner','admin'] as const)('allows the complete calculator scenario lifecycle with AI disabled for %s',async role=>{
  await db('Config').where({tenantId,key:'coach_settings'}).update({value:JSON.stringify({enabled:false,provider:'template',dailyRuns:20,takeover:[]})});
  const prefix=role==='partner'?'/coach/me':`/admin/coach/partners/${partnerId}`;
  const credential=role==='partner'?key:process.env.ADMIN_API_KEY!;
  const send=(path:string,body:object)=>request(app).post(`${prefix}${path}`).set('Authorization',`Bearer ${credential}`).send(body);
  const period={programId,startDate:day(),days:7,weekdays:[1,2,3,4,5]};
  const preview=await send('/calculator-plan/preview',{...period,settings});expect(preview.status,preview.text).toBe(200);
  const saved=await send('/forecast-snapshots',{programId,confirmed:true,settings,scenarioId:'manual-scenario',scenarioName:'Ручной сценарий'});
  expect(saved.status,saved.text).toBe(201);
  const built=await send('/calculator-plan',{...period,snapshotId:saved.body.snapshot.id,scenarioId:'manual-scenario',requestId:ulid()});
  expect(built.status,built.text).toBe(201);
  const removed=await request(app).delete(`${prefix}/forecast-snapshots/manual-scenario?programId=${programId}`).set('Authorization',`Bearer ${credential}`);
  expect(removed.status,removed.text).toBe(200);
  const listed=await request(app).get(`${prefix}/forecast-snapshots?programId=${programId}`).set('Authorization',`Bearer ${credential}`);
  expect(listed.body.snapshots).toHaveLength(0);
  expect((await db('CoachPlan').where({id:built.body.plan.id}).first()).status).toBe('archived');
  expect(await db('CoachRun').where({tenantId,partnerId})).toHaveLength(0);
  expect((await send('/messages',{programId,clientMessageId:ulid(),message:'Тест'})).body.error).toBe('coach_disabled');
 });
 it('does not create links when replacing the calculator calendar',async()=>{
  const first=await build();
  expect((await build({replacePlanId:first.body.plan.id,replaceVersion:first.body.plan.version})).status).toBe(201);
  expect(Number((await db('Link').where({partnerId,programId}).count({n:'*'}).first())!.n)).toBe(0);
 });
 it('preserves a named material without links when rebuilding its calendar',async()=>{
  const first=await build(),task=await db('CoachTask').where({planId:first.body.plan.id}).first();
  const renamed=await request(app).patch(`/partners/${partnerId}/materials/${task.id}`).set('Authorization',`Bearer ${key}`).send({title:'Мой обзор Syntolk'});
  expect(renamed.status,renamed.text).toBe(200);
  const view=await get(`/coach/me/calculator-plan?programId=${programId}`);
  expect(view.body.tasks.find((t:{id:string})=>t.id===task.id).data.title).toBe('Мой обзор Syntolk');
  expect((await build({replacePlanId:first.body.plan.id,replaceVersion:first.body.plan.version})).status).toBe(201);
  expect((await db('PartnerMaterial').where({id:task.id,partnerId}).first()).archivedAt).toBeNull();
  expect(await db('PartnerLinkSource').where({partnerId})).toHaveLength(0);
 });
 it('omits obsolete analytics-time tasks for a partial week and validates real dates',async()=>{
  await expect(calculatorSchedule({...settings,adminMinutes:70},day(),3,[0,1,2,3,4,5,6])).rejects.toMatchObject({code:'no_calendar_work'});
  const r=await calculatorSchedule({...settings,adminMinutes:70,frequency:{...(settings.frequency as Record<string,number>),short:7}},day(),3,[0,1,2,3,4,5,6]);expect(r.tasks).toHaveLength(3);expect(r.tasks.every(t=>t.kind==='content')).toBe(true);
  expect((await build({startDate:'2026-02-30'})).status).toBe(422);
  expect((await build({startDate:'2000-01-01'})).body.error).toBe('calendar_date');
 });
 it('spreads infrequent materials across the week without discarded free-form task steps',async()=>{
  settings={...settings,taskNotes:{short:'Показать работу Syntolk\nСнять демонстрацию экрана'}};
  const r=await calculatorSchedule(settings,day(),7,[0,1,2,3,4,5,6]);
  expect(Math.round((Date.parse(r.tasks[1]!.day)-Date.parse(r.tasks[0]!.day))/86400000)).toBe(6);
  const saved=await build();expect(saved.status,saved.text).toBe(201);
  const view=await get(`/coach/me/calculator-plan?programId=${programId}`);
  expect(view.body.tasks[0].data.personalSteps).toBeUndefined();
  const context=await buildCoachContext(db,tenantId,partnerId,programId);
  expect((context.currentTasks[0] as Record<string,unknown>).personalSteps).toBeUndefined();
 });
 it('keeps manually created links independent from calculator rebuilds',async()=>{
  const manual=await post(`/partners/${partnerId}/links`,{programId,linkKey:`manual-${ulid().toLowerCase()}`,label:'Моя ссылка',channel:'telegram'});expect(manual.status,manual.text).toBe(201);
  const first=await build();
  const second=await build({replacePlanId:first.body.plan.id,replaceVersion:first.body.plan.version});expect(second.status,second.text).toBe(201);
  const list=await get(`/partners/${partnerId}/links`);expect(list.body.links).toHaveLength(1);expect(list.body.links[0].id).toBe(manual.body.id);expect(list.body.archivedCount).toBe(0);
 });
});
