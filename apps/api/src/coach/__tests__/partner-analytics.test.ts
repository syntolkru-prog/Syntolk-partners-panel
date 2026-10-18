import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_TENANT_ID as tenantId, trackingSourceForClick, trackingSourceParams } from '@openpartner/db';
import { createApp } from '../../app.js';
import { db, appDb } from '../../db.js';
import { generateApiKey } from '../../auth.js';
import { calculateCoachForecast } from '../forecast-adapter.js';
import { assertIsolatedCoachDatabase } from '../test-guard.js';
import { recordPaymentRefund } from '../../payment-events.js';
import { localDay } from '../daily-plan.js';
import { exportAll, importBundle, EXPORT_TABLES, primaryKeyOf } from '../../export.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!, process.env.COACH_WORKING_DB);
const app = createApp({ enableLogger: false });
let partnerId: string, programId: string, key: string, link: any, settings: Record<string, unknown>;
const admin = () => `Bearer ${process.env.ADMIN_API_KEY}`;
const get = (path: string) => request(app).get(path).set('Authorization', `Bearer ${key}`);
const post = (path: string, body: object) => request(app).post(path).set('Authorization', `Bearer ${key}`).send(body);

beforeEach(async () => {
  partnerId=ulid(); programId=ulid();
  const credential=generateApiKey(); key=credential.plaintext;
  await db('Partner').insert({ id:partnerId,tenantId,name:'Analytics test',email:`${partnerId}@example.test`,activatedAt:new Date() });
  await db('Program').insert({ id:programId,tenantId,name:'Analytics',destinationUrl:'https://syntolk.ru/',commissionRule:JSON.stringify({type:'percent',value:20,recurring:true}) });
  await db('PartnerProgram').insert({id:ulid(),tenantId,partnerId,programId,source:'admin'});
  await db('ApiKey').insert({id:ulid(),tenantId,partnerId,prefix:credential.prefix,keyHash:credential.hash});
  await db('Config').insert({tenantId,key:'coach_settings',value:JSON.stringify({enabled:true,provider:'template'})}).onConflict(['tenantId','key']).merge({value:JSON.stringify({enabled:true,provider:'template'})});
  const model=await calculateCoachForecast({});
  settings={...model.settings,adminMinutes:0,frequency:{post:0,short:2,long:0,article:0,circle:0}};
  for(const id of ['a','b']) await db('CoachForecastSnapshot').insert({id:ulid(),tenantId,partnerId,programId,status:'confirmed',data:JSON.stringify({scenarioId:id,scenarioName:`Сценарий ${id}`,settings})});
  const response=await post(`/partners/${partnerId}/links`,{programId,linkKey:`analytics-${ulid()}`});
  expect(response.status,response.text).toBe(201);link=response.body;
});
afterAll(async()=>{await db.destroy();await appDb.destroy();});

async function source(scenarioId='a',platformId='ytshorts',materialId?:string) {
  const result=await post(`/partners/${partnerId}/links/${link.id}/sources`,{scenarioId,platformId,formatId:'short',...(materialId?{materialId}:{})});
  expect(result.status,result.text).toBe(200);return result.body.source;
}
async function click(sourceRow?:any,at=new Date()) {
  const id=ulid(),params=sourceRow?trackingSourceParams(sourceRow):{};
  const response=await request(app).post('/clicks').set('Authorization',admin()).send({id,linkKey:link.linkKey,landingUrl:`https://syntolk.ru/?cref=${id}`,ts:at.toISOString(),utmCampaign:params.utm_campaign,utmSource:params.utm_source,utmMedium:params.utm_medium,utmContent:params.utm_content});
  expect(response.status,response.text).toBe(201);return id;
}
async function event(userId:string,type:string,value?:number) {
  const externalEventId=ulid();
  const response=await request(app).post('/attribution/events').set('Authorization',admin()).send({userId,type,value,currency:'RUB',externalEventId});
  expect(response.status,response.text).toBe(200);return {response,externalEventId};
}
async function identify(clickId:string,userId:string) {
  const response=await request(app).post('/attribution/identify').set('Authorization', `Bearer ${process.env.ADMIN_API_KEY}`).send({cref:clickId,userId});expect(response.status,response.text).toBe(200);
}
async function customer(sourceRow?:any,payment?:number) {
  const id=await click(sourceRow),userId=ulid();await identify(id,userId);await event(userId,'signup');
  const paid=payment?await event(userId,'invoice_paid',payment):undefined;return {id,userId,paid};
}
async function report(extra='') {
  const response=await get(`/partners/${partnerId}/analytics?programId=${programId}&currency=RUB&period=all${extra}`);
  expect(response.status,response.text).toBe(200);return response.body;
}

describe('scenario tracking and shared partner analytics',()=>{
  it('combines selections with OR inside each dimension and AND between dimensions',async()=>{
    const first=await source('a','ytshorts'),second=await source('b','vkclips'),excluded=await source('a','telegram-short');
    await customer(first,1000);await customer(second,500);await customer(excluded,700);
    const selected=await report('&groupBy=platform&platformIds=ytshorts&platformIds=vkclips&platformIds=ytshorts&scenarioIds=a&scenarioIds=b&formatIds=short&formatIds=article&includeSeries=true&includeFunnel=true&includeComparison=true');
    expect(selected.counts).toMatchObject({clicks:2,registrations:2,paymentCount:2,payingCustomers:2});
    expect(selected.amountsMinor.netAccrued).toBe(30000);
    expect(selected.rows.map((row:any)=>row.id).sort()).toEqual(['vkclips','ytshorts']);
    expect(selected.series.points.reduce((sum:number,point:any)=>sum+point.clicks,0)).toBe(2);
    expect(selected.funnel.registrations).toBe(2);
    expect(selected.comparison).toBeUndefined();
    expect(selected.options.platforms.some((option:any)=>option.id==='telegram-short')).toBe(true);
    const narrower=await report('&platformIds=ytshorts&platformIds=vkclips&scenarioIds=a&formatIds=short');
    expect(narrower.counts.clicks).toBe(1);
    expect((await report('&platformIds=ytshorts&platformIds=vkclips&formatIds=article')).counts.clicks).toBe(0);
  });
  it('returns aligned canonical platform series, including explicitly selected empty platforms',async()=>{
    const first=await source('a','ytshorts'),second=await source('a','vkclips');await source('a','telegram-short');
    await customer(first,1000);await customer(second,500);
    const selected=await report('&groupBy=platform&platformIds=ytshorts&platformIds=vkclips&platformIds=telegram-short&includeSeries=true&seriesBy=platform&includeEmpty=true');
    expect(selected.series.by).toBe('platform');
    expect(selected.series.groups).toHaveLength(3);
    for(const group of selected.series.groups){
      expect(group.points.map((point:any)=>point.date)).toEqual(selected.series.points.map((point:any)=>point.date));
      const row=selected.rows.find((item:any)=>item.id===group.id);
      expect(group.name).toBe(row.name);
      expect(group.points.reduce((sum:number,point:any)=>sum+point.clicks,0)).toBe(row.counts.clicks);
      expect(group.points.reduce((sum:number,point:any)=>sum+point.identities,0)).toBe(row.counts.identities);
      expect(group.points.reduce((sum:number,point:any)=>sum+point.earningsMinor,0)).toBe(row.amountsMinor.netAccrued);
      expect(group.points.reduce((sum:number,point:any)=>sum+point.customerPaymentsMinor,0)).toBe(row.amountsMinor.observedPayments);
    }
    expect(selected.series.groups.find((group:any)=>group.id==='telegram-short').points.every((point:any)=>point.clicks===0)).toBe(true);
    expect(selected.series.groups.find((group:any)=>group.id==='telegram-short').points.every((point:any)=>point.identities===0)).toBe(true);
    expect(selected.series.points.reduce((sum:number,point:any)=>sum+point.identities,0)).toBe(2);
  });
  it('scopes grouped selections to the owner and bounds incoming selection lists',async()=>{
    const own=await source();await customer(own,1000);
    const foreign=await report('&platformIds=unknown&includeSeries=true&seriesBy=platform&includeEmpty=true');
    expect(foreign.counts.clicks).toBe(0);expect(foreign.series.groups).toEqual([]);expect(foreign.rows).toEqual([]);
    const excessive=new URLSearchParams({programId,includeSeries:'true'});for(let i=0;i<51;i++)excessive.append('platformIds',`platform-${i}`);
    expect((await get(`/partners/${partnerId}/analytics?${excessive}`)).status).toBe(400);
  });
  it('has no account-login, upload or automatic-publication endpoints',async()=>{
    expect((await get(`/partners/${partnerId}/publisher`)).status).toBe(404);
    for(const path of ['publisher/accounts','publisher/accounts/account/connect','publisher/jobs/job/retry','materials/material/publish','materials/material/import','materials/material/files']){
      expect((await post(`/partners/${partnerId}/${path}`,{})).status,path).toBe(404);
    }
    expect((await request(app).patch(`/partners/${partnerId}/materials/material`).set('Authorization',`Bearer ${key}`).send({title:'Название',content:'Текст'})).status).toBe(400);
  });
  it('tracks a standalone material, repeated placements and zero activity without a scenario',async()=>{
    const created=await post(`/partners/${partnerId}/materials`,{id:ulid(),programId,title:'Как ИИ помогает продажам',formatId:'article'});
    expect(created.status,created.text).toBe(201);const material=created.body.material;
    const empty=await report('&groupBy=material&scenarioId=__none__');
    expect(empty.rows).toHaveLength(0);
    const body={linkId:link.id,platform:{id:'dzen',name:'Дзен'},requestId:ulid()};
    const first=await post(`/partners/${partnerId}/materials/${material.id}/placements`,body);
    const repeated=await post(`/partners/${partnerId}/materials/${material.id}/placements`,body);
    expect(first.status,first.text).toBe(201);expect(repeated.body.source.id).toBe(first.body.source.id);
    const next=await post(`/partners/${partnerId}/materials/${material.id}/placements`,{...body,requestId:ulid()});
    expect(next.body.source.id).not.toBe(first.body.source.id);
    const params=trackingSourceParams(first.body.source);
    expect(await trackingSourceForClick(db,link,{campaign:params.utm_campaign,source:params.utm_source,medium:params.utm_medium,content:params.utm_content})).toBe(first.body.source.id);
    await customer(first.body.source,1000);await click(next.body.source);
    const result=await report(`&groupBy=material&materialId=${material.id}&scenarioId=__none__`);
    expect(result.counts).toMatchObject({clicks:2,registrations:1,paymentCount:1});
    expect(result.amountsMinor.netAccrued).toBe(20000);
    const sources=await report(`&groupBy=source&materialId=${material.id}`);expect(sources.rows).toHaveLength(2);
    expect((await db('Link').where({partnerId}))).toHaveLength(1);
  });
  it('keeps URLs stable after renaming and stores each publication independently',async()=>{
    const created=await post(`/partners/${partnerId}/materials`,{programId,title:'Мой пост',formatId:'post'}),material=created.body.material;
    const placement=await post(`/partners/${partnerId}/materials/${material.id}/placements`,{linkId:link.id,platform:{id:'telegram-post',name:'Telegram'},requestId:ulid()});
    const before=trackingSourceParams(placement.body.source);
    const rename=await request(app).patch(`/partners/${partnerId}/materials/${material.id}`).set('Authorization',`Bearer ${key}`).send({title:'Новое название'});expect(rename.status,rename.text).toBe(200);
    const publish=await request(app).patch(`/partners/${partnerId}/link-sources/${placement.body.source.id}`).set('Authorization',`Bearer ${key}`).send({publicationUrl:'https://t.me/channel/15',channelName:'Мой канал',published:true});expect(publish.status,publish.text).toBe(200);
    const view=await get(`/partners/${partnerId}/materials/${material.id}`);
    expect(view.body.material.title).toBe('Новое название');expect(view.body.placements[0]).toMatchObject({publicationUrl:'https://t.me/channel/15',channelName:'Мой канал',params:before});expect(view.body.placements[0].publishedAt).toBeTruthy();
    const bad=await request(app).patch(`/partners/${partnerId}/link-sources/${placement.body.source.id}`).set('Authorization',`Bearer ${key}`).send({publicationUrl:'javascript:alert(1)'});expect(bad.status).toBe(422);
    expect((await report('&groupBy=material')).rows).toHaveLength(0);
    expect((await report('&groupBy=material&includeEmpty=true')).rows.find((r:any)=>r.id===material.id).material).toMatchObject({published:1,placements:1});
  });
  it('shows only real activity by default and includes existing empty links only on request',async()=>{
    const snapshot=await db('CoachForecastSnapshot').where({partnerId}).whereRaw("data->>'scenarioId'='a'").first();
    const built=await post('/coach/me/calculator-plan',{programId,scenarioId:'a',snapshotId:snapshot.id,startDate:localDay(new Date(),'Europe/Moscow'),days:7,weekdays:[0,1,2,3,4,5,6],requestId:ulid()});
    expect(built.status,built.text).toBe(201);
    expect(await db('Link').where({partnerId})).toHaveLength(1);
    expect(await db('PartnerLinkSource').where({partnerId})).toHaveLength(0);
    expect((await report('&groupBy=material&includeEmpty=true&scenarioId=a')).rows).toHaveLength(0);
    const task=await db('CoachTask').where({partnerId,planId:built.body.plan.id}).first();
    const copied=await source('a','ytshorts',task.id);
    for(const groupBy of ['material','source','scenario'])expect((await report(`&groupBy=${groupBy}`)).rows).toHaveLength(0);
    const empty=await report('&groupBy=material');
    expect(empty.conversions).toMatchObject({clickToRegistration:null,registrationToPayment:null,clickToPayment:null});
    await db('PartnerLinkSource').where({id:copied.id}).update({publishedAt:new Date()});
    for(const groupBy of ['material','source','scenario','platform','format','link']){
      expect((await report(`&groupBy=${groupBy}`)).rows).toHaveLength(0);
      const withEmpty=await report(`&groupBy=${groupBy}&includeEmpty=true&scenarioId=a`);
      expect(withEmpty.rows).toHaveLength(1);
      expect(withEmpty.rows[0].counts.clicks).toBe(0);
      expect(withEmpty.counts).toEqual(empty.counts);
      expect(withEmpty.amountsMinor).toEqual(empty.amountsMinor);
    }
    expect((await report('&groupBy=material&platformId=telegram-short&includeEmpty=true')).rows).toHaveLength(0);
    await db('PartnerLinkSource').where({id:copied.id}).update({publishedAt:new Date(Date.now()-2*86400000)});
    const today=await get(`/partners/${partnerId}/analytics?programId=${programId}&groupBy=material&period=today`);
    expect(today.body.rows).toHaveLength(0);
    await click(copied);
    const active=await get(`/partners/${partnerId}/analytics?programId=${programId}&groupBy=material&period=today`);
    expect(active.body.rows).toHaveLength(1);expect(active.body.counts.clicks).toBe(1);
    expect(active.body.conversions).toMatchObject({clickToRegistration:0,registrationToPayment:null,clickToPayment:0});
    expect((await report('&groupBy=source')).rows.map((row:any)=>row.id)).toEqual([copied.id]);
    expect(await db('PartnerMaterial').where({id:task.id})).toHaveLength(1);
    expect(await db('PartnerLinkSource').where({id:copied.id})).toHaveLength(1);
  });
  it('filters empty links by date and scope without manufacturing calendar materials or changing totals',async()=>{
    const created=await post(`/partners/${partnerId}/materials`,{programId,title:'Статья без размещений',formatId:'article'});
    const unused=await source('a'),active=await source('b');
    await click(active);
    const normal=await report('&groupBy=source');
    const withEmpty=await report('&groupBy=source&includeEmpty=true');
    expect(normal.rows.map((row:any)=>row.id)).toEqual([active.id]);
    expect(withEmpty.rows.map((row:any)=>row.id)).toEqual(expect.arrayContaining([unused.id,active.id,'__none__']));
    expect(withEmpty.counts).toEqual(normal.counts);expect(withEmpty.amountsMinor).toEqual(normal.amountsMinor);
    expect((await report('&groupBy=material&includeEmpty=true')).rows.some((row:any)=>row.id===created.body.material.id)).toBe(false);
    expect((await report('&groupBy=source&includeEmpty=true&scenarioId=a')).rows.map((row:any)=>row.id)).toEqual([unused.id]);
    await db('PartnerLinkSource').where({id:unused.id}).update({createdAt:new Date(Date.now()+2*86400000)});
    expect((await report('&groupBy=source&includeEmpty=true&scenarioId=a')).rows).toHaveLength(0);
    expect((await get(`/partners/${partnerId}/analytics?includeEmpty=invalid`)).status).toBe(400);
  });
  it('keeps registrations and payments visible when their clicks were before the selected period',async()=>{
    const placement=await source();
    const clickId=await click(placement,new Date(Date.now()-2*86400000)),userId=ulid();
    await identify(clickId,userId);await event(userId,'signup');await event(userId,'invoice_paid',1000);
    const today=await get(`/partners/${partnerId}/analytics?programId=${programId}&groupBy=source&period=today&currency=RUB`);
    expect(today.status,today.text).toBe(200);
    expect(today.body.rows).toHaveLength(1);
    expect(today.body.rows[0]).toMatchObject({id:placement.id,counts:{clicks:0,registrations:1,paymentCount:1},amountsMinor:{netAccrued:20000}});
  });
  it('reuses the same base link and source; rejects an unselected format',async()=>{
    const first=await source(),second=await source();expect(second.id).toBe(first.id);
    expect((await db('Link').where({partnerId}))).toHaveLength(1);
    expect((await db('PartnerLinkSource').where({partnerId}))).toHaveLength(1);
    const invalid=await post(`/partners/${partnerId}/links/${link.id}/sources`,{scenarioId:'a',platformId:'ytshorts',formatId:'post'});
    expect(invalid.status).toBe(422);
    expect((await get(`/partners/${partnerId}/links?programId=`)).status).toBe(400);
    expect((await get(`/partners/${partnerId}/link-sources?scenarioId=`)).status).toBe(400);
  });
  it('captures validated source tags through the real redirect router and leaves forged tags unassigned',async()=>{
    const context=await source();
    const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
    const port=(probe.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
    const child=spawn(process.execPath,[resolve('../router/dist/server.js')],{cwd:resolve('../..'),env:{...process.env,ROUTER_PORT:String(port),DATABASE_URL:process.env.DATABASE_URL!},stdio:'ignore'});
    try{
      let ready=false;
      for(let i=0;i<50;i++){try{ready=(await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{/* Wait for this test process only. */}if(ready)break;await delay(100);}
      expect(ready).toBe(true);
      const params=new URLSearchParams(trackingSourceParams(context));
      const response=await fetch(`http://127.0.0.1:${port}/r/${link.linkKey}?${params}`,{redirect:'manual'});
      expect(response.status).toBe(302);
      const clickId=new URL(response.headers.get('location')!).searchParams.get('cref');
      expect((await db('Click').where({id:clickId,tenantId}).first()).trackingSourceId).toBe(context.id);
      params.set('utm_campaign','b');
      const forged=await fetch(`http://127.0.0.1:${port}/r/${link.linkKey}?${params}`,{redirect:'manual'});
      const forgedId=new URL(forged.headers.get('location')!).searchParams.get('cref');
      expect((await db('Click').where({id:forgedId,tenantId}).first()).trackingSourceId).toBeNull();
    }finally{if(child.pid&&child.exitCode===null){const stopped=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill();await Promise.race([stopped,delay(2000)]);}}
  });
  it('separates scenarios and platforms through signup, first and recurring payments',async()=>{
    const youtube=await source(),telegram=await source('a','telegram-short'),other=await source('b');
    const first=await customer(youtube,1000);await event(first.userId,'recurring_payment',500);
    await customer(youtube,1000);await click(telegram);await customer(other);await customer(undefined,1000);
    const a=await report('&scenarioId=a');
    expect(a.counts).toMatchObject({clicks:3,registrations:2,payingCustomers:2,paymentCount:3,firstPaymentCount:2,repeatPaymentCount:1});
    expect(a.amountsMinor).toMatchObject({observedPayments:250000,netAccrued:50000});
    expect(a.rows.find((r:any)=>r.id==='ytshorts').counts.clicks).toBe(2);
    expect(a.rows.find((r:any)=>r.id==='telegram-short').counts.registrations).toBe(0);
    const b=await report('&scenarioId=b');expect(b.counts).toMatchObject({clicks:1,registrations:1,paymentCount:0});
    const all=await report();expect(all.rows.find((r:any)=>r.id==='__none__').counts).toMatchObject({clicks:1,paymentCount:1});
    expect(all.counts.clicks).toBe(5);
  });
  it('matches the dashboard, funnel and results for the same filters and dates',async()=>{
    await customer(await source(),1000);
    const query=`programId=${programId}&scenarioId=a&period=today&currency=RUB`;
    const [canonical,dashboard,funnel,results]=await Promise.all([get(`/partners/${partnerId}/analytics?${query}`),get(`/partners/${partnerId}/dashboard?${query}`),get(`/partners/${partnerId}/funnel?${query}`),get(`/coach/me/results?${query}`)]);
    for(const response of [canonical,dashboard,funnel,results])expect(response.status,response.text).toBe(200);
    expect(dashboard.body.clicks).toBe(canonical.body.counts.clicks);
    expect(funnel.body.stages.signups).toBe(canonical.body.counts.registrations);
    expect(results.body.amountsMinor.netAccrued).toBe(canonical.body.amountsMinor.netAccrued);
  });
  it('uses canonical calculations for the chart, including refunds, recurring payments and exclusions',async()=>{
    const placement=await source(),tracked=await customer(placement,1000);
    await event(tracked.userId,'recurring_payment',500);
    await recordPaymentRefund(db,tenantId,{originalExternalEventId:tracked.paid!.externalEventId,refundExternalEventId:ulid(),amount:400,currency:'RUB'});
    const flagged=await click(placement);await db('Click').where({id:flagged}).update({fraudFlag:'manual'});
    const query=`/partners/${partnerId}/analytics?programId=${programId}&scenarioId=a&period=30d&currency=RUB&groupBy=link`;
    const plain=await get(query),charted=await get(`${query}&includeSeries=true`);
    expect(charted.status,charted.text).toBe(200);
    expect(plain.body.series).toBeUndefined();
    expect(charted.body.counts).toEqual(plain.body.counts);
    expect(charted.body.amountsMinor).toEqual(plain.body.amountsMinor);
    expect(charted.body.series.bucket).toBe('day');
    expect(charted.body.series.points).toHaveLength(30);
    const sums=charted.body.series.points.reduce((sum:any,point:any)=>({clicks:sum.clicks+point.clicks,registrations:sum.registrations+point.registrations,payments:sum.payments+point.payments,earningsMinor:sum.earningsMinor+point.earningsMinor}),{clicks:0,registrations:0,payments:0,earningsMinor:0});
    expect(sums).toEqual({clicks:1,registrations:1,payments:2,earningsMinor:charted.body.amountsMinor.netAccrued});
    expect(charted.body.series.points.reduce((sum:number,point:any)=>sum+point.payingCustomers,0)).toBe(1);
    expect(charted.body.series.points.reduce((sum:number,point:any)=>sum+point.customerPaymentsMinor,0)).toBe(charted.body.amountsMinor.observedPayments);
    expect(charted.body.rows[0].platformNames.length).toBeGreaterThan(0);
    const foreign=await get(`${query}&linkId=unknown&includeSeries=true`);
    expect(foreign.body.series.points.every((point:any)=>Object.entries(point).every(([key,value])=>['date','since','until'].includes(key)||value===0))).toBe(true);
  });
  it('keeps late payments in the chart without moving the old click into today',async()=>{
    const placement=await source(),userId=ulid();
    await identify(await click(placement,new Date(Date.now()-3*86400000)),userId);await event(userId,'invoice_paid',1000);
    const response=await get(`/partners/${partnerId}/analytics?period=today&currency=RUB&groupBy=link&linkId=${link.id}&includeSeries=true`);
    expect(response.status,response.text).toBe(200);
    expect(response.body.series.points).toEqual([expect.objectContaining({date:localDay(new Date(),'Europe/Moscow'),clicks:0,registrations:0,payingCustomers:1,payments:1,firstPayments:1,repeatPayments:0,customerPaymentsMinor:100000,earningsMinor:20000})]);
    expect(response.body.series.points[0]).toMatchObject(response.body.period);
  });
  it('buckets clicks by the partner timezone and fills days without activity with zero',async()=>{
    await db('CoachProfile').insert({id:ulid(),tenantId,partnerId,status:'complete',data:JSON.stringify({timezone:'Asia/Vladivostok'})});
    await click(undefined,new Date('2026-10-01T14:30:00Z')); // Oct 2 locally.
    const response=await get(`/partners/${partnerId}/analytics?period=custom&from=2026-10-01&to=2026-10-03&currency=RUB&includeSeries=true`);
    expect(response.status,response.text).toBe(200);
    expect(response.body.series.points.map((point:any)=>[point.date,point.clicks])).toEqual([['2026-10-01',0],['2026-10-02',1],['2026-10-03',0]]);
    const point=response.body.series.points[1];
    expect(point).toMatchObject({since:'2026-10-01T14:00:00.000Z',until:'2026-10-02T14:00:00.000Z'});
    const detail=await get(`/partners/${partnerId}/analytics?since=${point.since}&until=${point.until}&groupBy=material`);
    expect(detail.body.counts.clicks).toBe(point.clicks);
  });
  it('keeps weekly and monthly drilldowns inside the exact chart period',async()=>{
    for(const [since,until,bucket] of [['2025-01-15T10:00:00Z','2025-05-04T08:00:00Z','week'],['2023-01-15T10:00:00Z','2026-05-04T08:00:00Z','month']]){
      const response=await get(`/partners/${partnerId}/analytics?since=${since}&until=${until}&includeSeries=true`);
      expect(response.status,response.text).toBe(200);expect(response.body.series.bucket).toBe(bucket);
      const points=response.body.series.points;
      expect(points[0].since).toBe(new Date(since!).toISOString());
      expect(points.at(-1).until).toBe(new Date(until!).toISOString());
      for(let i=0;i<points.length;i++){
        expect(Date.parse(points[i].since)).toBeLessThan(Date.parse(points[i].until));
        if(i)expect(points[i].since).toBe(points[i-1].until);
      }
    }
  });
  it('adds read-only link and publication metadata, with distinct creation and publication dates',async()=>{
    const placement=await source();await click(placement);
    const publishedAt=new Date(Date.now()-86400000);
    await db('PartnerLinkSource').where({id:placement.id}).update({channelName:'Мой канал',publicationUrl:'https://example.test/post',publishedAt});
    const links=await report('&groupBy=link');
    expect(links.rows[0]).toMatchObject({id:link.id,linkKey:link.linkKey,createdAt:expect.any(String)});
    const sources=await report('&groupBy=source');
    expect(sources.rows[0]).toMatchObject({createdAt:expect.any(String),placement:{channelName:'Мой канал',publicationUrl:'https://example.test/post',publishedAt:publishedAt.toISOString(),linkKey:link.linkKey,trackingParams:trackingSourceParams(placement)}});
  });
  it('includes a legacy placement in its parent link without rewriting the click or double counting',async()=>{
    const placement=await source(),id=await click(placement);
    await db('Click').where({id}).update({linkId:null});
    await click();
    const response=await report('&groupBy=link&includeSeries=true');
    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]).toMatchObject({id:link.id,counts:{clicks:2}});
    const filtered=await report(`&linkId=${link.id}&groupBy=source&includeSeries=true`);
    expect(filtered.counts.clicks).toBe(2);
    expect(filtered.series.points.reduce((sum:number,point:any)=>sum+point.clicks,0)).toBe(2);
    expect(filtered.rows.map((row:any)=>row.id)).toEqual(expect.arrayContaining([placement.id,'__none__']));
    expect((await db('Click').where({id}).first()).linkId).toBeNull();
  });
  it('does not repeat a registration across chart days or duplicate a linear payment',async()=>{
    await db('Program').where({id:programId}).update({attributionModel:'linear'});
    const a=await source(),b=await source('b'),userId=ulid();
    await identify(await click(a),userId);await identify(await click(b),userId);
    await event(userId,'signup');await event(userId,'signup');await event(userId,'invoice_paid',1000);
    const registrations=await db('Event').where({tenantId,userId,type:'signup'}).orderBy('ts');
    await db('Event').where({id:registrations[0].id}).update({ts:new Date(Date.now()-86400000)});
    const response=await get(`/partners/${partnerId}/analytics?period=7d&currency=RUB&includeSeries=true`);
    expect(response.status,response.text).toBe(200);
    expect(response.body.counts.registrations).toBe(1);
    expect(response.body.series.points.reduce((sum:number,point:any)=>sum+point.registrations,0)).toBe(1);
    expect(response.body.series.points.reduce((sum:number,point:any)=>sum+point.payments,0)).toBe(1);
    expect(response.body.series.points.reduce((sum:number,point:any)=>sum+point.earningsMinor,0)).toBe(20000);
  });
  it('compares adjacent calendar periods using the same scope and exclusions',async()=>{
    const placement=await source();
    await click(placement,new Date('2026-10-02T12:00:00Z'));await click(placement,new Date('2026-10-03T12:00:00Z'));
    await click(placement,new Date('2026-09-25T12:00:00Z'));
    const excluded=await click(placement,new Date('2026-09-26T12:00:00Z'));await db('Click').where({id:excluded}).update({fraudFlag:'manual'});
    const response=await get(`/partners/${partnerId}/analytics?period=custom&from=2026-10-01&to=2026-10-07&sourceId=${placement.id}&includeComparison=true&currency=RUB`);
    expect(response.status,response.text).toBe(200);
    expect(response.body.counts.clicks).toBe(2);expect(response.body.comparison.counts.clicks).toBe(1);
    expect(response.body.comparison.period).toEqual({since:'2026-09-23T21:00:00.000Z',until:'2026-09-30T21:00:00.000Z'});
    expect((await report('&includeComparison=true')).comparison).toBeUndefined();
  });
  it('builds a registration-to-first-payment funnel for the selected click cohort only',async()=>{
    const placement=await source(),oldUser=ulid();
    await identify(await click(placement,new Date(Date.now()-3*86400000)),oldUser);await event(oldUser,'signup');await event(oldUser,'invoice_paid',1000);
    const today=()=>get(`/partners/${partnerId}/analytics?period=today&currency=RUB&includeFunnel=true&sourceId=${placement.id}`);
    const late=await today();expect(late.status,late.text).toBe(200);
    expect(late.body.counts).toMatchObject({clicks:0,registrations:1,paymentCount:1});
    expect(late.body.funnel).toEqual({clicks:0,registrations:0,firstPayingCustomers:0});
    const current=await customer(placement,1000);await event(current.userId,'recurring_payment',500);
    const withoutSignup=ulid();await identify(await click(placement),withoutSignup);await event(withoutSignup,'invoice_paid',1000);
    const active=await today();expect(active.body.funnel).toEqual({clicks:2,registrations:1,firstPayingCustomers:1});
    const series=await get(`/partners/${partnerId}/analytics?period=today&currency=RUB&includeSeries=true&sourceId=${placement.id}`);
    expect(series.body.series.points[0]).toMatchObject({payments:4,firstPayments:3,repeatPayments:1});
  });
  it('keeps detail history and audience scoped, excludes flagged traffic and exposes no personal identifiers',async()=>{
    const placement=await source(),other=await source('b'),tracked=await customer(placement,1000);
    await event(tracked.userId,'recurring_payment',500);
    await recordPaymentRefund(db,tenantId,{originalExternalEventId:tracked.paid!.externalEventId,refundExternalEventId:ulid(),amount:400,currency:'RUB'});
    await db('Click').where({id:tracked.id}).update({referer:'https://example.test/article?private=secret',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'});
    const flagged=await click(placement);await db('Click').where({id:flagged}).update({fraudFlag:'manual',referer:'https://excluded.test/'});
    await customer(other,2000);
    const response=await get(`/partners/${partnerId}/analytics/details?period=all&currency=RUB&sourceId=${placement.id}`);
    expect(response.status,response.text).toBe(200);
    expect(response.body.history.items.map((item:any)=>item.kind).sort()).toEqual(['click','first_payment','refund','repeat_payment','signup']);
    expect(response.body.history.items.find((item:any)=>item.kind==='refund').amountMinor).toBe(-40000);
    expect(response.body.history.items.find((item:any)=>item.kind==='first_payment').amountMinor).toBe(100000);
    expect(response.body.traffic).toEqual({referrers:[{name:'example.test',count:1}],devices:[{name:'Телефон',count:1}]});
    expect(response.text).not.toContain('private=');expect(response.text).not.toContain('userId');expect(response.text).not.toContain('iPhone');
    expect((await get(`/partners/${partnerId}/analytics/details?sourceId=foreign`)).body.history.items).toEqual([]);
    expect((await get(`/partners/other/analytics/details`)).status).toBe(403);
  });
  it('pages through history without duplicates, including events with identical timestamps',async()=>{
    const placement=await source(),at=new Date(Date.now()-1000);
    for(let index=0;index<25;index++)await click(placement,at);
    const path=`/partners/${partnerId}/analytics/details?period=all&sourceId=${placement.id}`;
    const first=await get(path);expect(first.status,first.text).toBe(200);expect(first.body.history.items).toHaveLength(20);
    const second=await get(`${path}&cursor=${encodeURIComponent(first.body.history.nextCursor)}`);
    expect(second.status,second.text).toBe(200);expect(second.body.history.items).toHaveLength(5);expect(second.body.history.nextCursor).toBeNull();
    expect(new Set([...first.body.history.items,...second.body.history.items].map((item:any)=>item.id)).size).toBe(25);
    expect((await get(`${path}&cursor=invalid`)).status).toBe(400);
  });
  it('deduplicates multi-touch history and weights its payment and refund amounts',async()=>{
    await db('Program').where({id:programId}).update({attributionModel:'linear'});
    const a=await source(),b=await source('b'),userId=ulid();
    await identify(await click(a),userId);await identify(await click(b),userId);await event(userId,'signup');const paid=await event(userId,'invoice_paid',1000);
    await recordPaymentRefund(db,tenantId,{originalExternalEventId:paid.externalEventId,refundExternalEventId:ulid(),amount:200,currency:'RUB'});
    const all=await get(`/partners/${partnerId}/analytics/details?period=all&currency=RUB&linkId=${link.id}`);
    expect(all.status,all.text).toBe(200);
    expect(all.body.history.items.filter((item:any)=>item.kind==='first_payment')).toHaveLength(1);
    expect(all.body.history.items.find((item:any)=>item.kind==='first_payment').amountMinor).toBe(100000);
    const part=await get(`/partners/${partnerId}/analytics/details?period=all&currency=RUB&sourceId=${a.id}`);
    expect(part.body.history.items.find((item:any)=>item.kind==='first_payment').amountMinor).toBe(50000);
    expect(part.body.history.items.find((item:any)=>item.kind==='refund').amountMinor).toBe(-10000);
  });
  it('keeps delayed conversions in their source without inflating todays conversion rate',async()=>{
    const context=await source(),oldClick=await click(context,new Date(Date.now()-2*86400000)),userId=ulid();
    await identify(oldClick,userId);await event(userId,'signup');await event(userId,'invoice_paid',1000);
    const today=await get(`/partners/${partnerId}/analytics?scenarioId=a&period=today&currency=RUB`);
    expect(today.status,today.text).toBe(200);
    expect(today.body.counts).toMatchObject({clicks:0,registrations:1,paymentCount:1});
    expect(today.body.conversions.clickToRegistration).toBeNull();
    expect((await report('&scenarioId=a')).conversions).toMatchObject({clickToRegistration:1,registrationToPayment:1});
  });
  it('attributes a refund to the original source and corrects its earnings',async()=>{
    const tracked=await customer(await source(),1000);
    await recordPaymentRefund(db,tenantId,{originalExternalEventId:tracked.paid!.externalEventId,refundExternalEventId:ulid(),amount:400,currency:'RUB'});
    const result=await report('&scenarioId=a');
    expect(result.amountsMinor).toMatchObject({observedPayments:100000,refunds:40000,netPayments:60000,netAccrued:12000});
  });
  it('does not count a multi-touch customer or payment twice in the overall report',async()=>{
    await db('Program').where({id:programId}).update({attributionModel:'linear'});
    const a=await source(),b=await source('b'),userId=ulid();
    await identify(await click(a),userId);await identify(await click(b),userId);
    await event(userId,'signup');await event(userId,'invoice_paid',1000);
    const result=await report();expect(result.counts).toMatchObject({registrations:1,paymentCount:1,payingCustomers:1});
    expect(result.rows.find((r:any)=>r.id==='a').amountsMinor.observedPayments).toBe(50000);
    expect(result.rows.find((r:any)=>r.id==='b').amountsMinor.netAccrued).toBe(10000);
    expect(result.amountsMinor.netAccrued).toBe(20000);
  });
  it('preserves detailed material tracking after rebuilding and archiving its scenario',async()=>{
    const snapshot=await db('CoachForecastSnapshot').where({partnerId}).whereRaw("data->>'scenarioId'='a'").first();
    const input={programId,scenarioId:'a',snapshotId:snapshot.id,startDate:localDay(new Date(),'Europe/Moscow'),days:7,weekdays:[0,1,2,3,4,5,6],requestId:ulid()};
    const built=await post('/coach/me/calculator-plan',input);expect(built.status,built.text).toBe(201);
    const tasks=await get(`/coach/me/calculator-plan?programId=${programId}&scenarioId=a`),task=tasks.body.tasks.find((t:any)=>t.data.kind==='content');
    const detailed=await source('a','ytshorts',task.id),secondPlacement=await source('a','telegram-short',task.id);
    await customer(detailed,1000);await click(secondPlacement);
    expect((await report('&scenarioId=a&groupBy=material')).rows.find((r:any)=>r.id===task.id).counts.clicks).toBe(2);
    const rebuilt=await post('/coach/me/calculator-plan',{...input,requestId:ulid(),replacePlanId:built.body.plan.id,replaceVersion:built.body.plan.version});expect(rebuilt.status,rebuilt.text).toBe(201);
    const archived=await request(app).delete(`/coach/me/forecast-snapshots/a?programId=${programId}`).set('Authorization',`Bearer ${key}`);expect(archived.status,archived.text).toBe(200);
    const params=trackingSourceParams(detailed);
    expect(await trackingSourceForClick(db,link,{campaign:params.utm_campaign,source:params.utm_source,medium:params.utm_medium,content:params.utm_content})).toBe(detailed.id);
    expect((await report('&scenarioId=a')).counts.paymentCount).toBe(1);
    expect((await report()).options.scenarios.find((s:any)=>s.id==='a').archived).toBe(true);
  });
  it('rejects other partners context and never accepts mismatched source tags',async()=>{
    const context=await source();
    expect(await trackingSourceForClick(db,link,{campaign:'b',source:context.platformId,medium:context.formatId,content:context.id})).toBeNull();
    const foreign=await post(`/partners/${partnerId}/links/${link.id}/sources`,{scenarioId:'foreign',platformId:'ytshorts',formatId:'short'});expect(foreign.status).toBe(404);
    const credentials=generateApiKey(),otherId=ulid();
    await db('Partner').insert({id:otherId,tenantId,name:'Other',email:`${otherId}@example.test`});
    await db('ApiKey').insert({id:ulid(),tenantId,partnerId:otherId,prefix:credentials.prefix,keyHash:credentials.hash});
    expect((await request(app).get(`/partners/${partnerId}/analytics`).set('Authorization',`Bearer ${credentials.plaintext}`)).status).toBe(403);
    const created=await post(`/partners/${partnerId}/materials`,{programId,title:'Мой материал',formatId:'post'}),material=created.body.material;
    const placement=await post(`/partners/${partnerId}/materials/${material.id}/placements`,{linkId:link.id,platform:{id:'test',name:'Тест'},requestId:ulid()});
    expect((await get(`/partners/${partnerId}/materials/${material.id}`)).status).toBe(200);
    for(const target of [partnerId,otherId]){
      const expected=target===partnerId?403:404;
      expect((await request(app).get(`/partners/${target}/materials/${material.id}`).set('Authorization',`Bearer ${credentials.plaintext}`)).status).toBe(expected);
      expect((await request(app).patch(`/partners/${target}/materials/${material.id}`).set('Authorization',`Bearer ${credentials.plaintext}`).send({title:'Чужое название'})).status).toBe(expected);
      expect((await request(app).patch(`/partners/${target}/link-sources/${placement.body.source.id}`).set('Authorization',`Bearer ${credentials.plaintext}`).send({published:true})).status).toBe(expected);
    }
  });
  it('rejects invalid date ranges and excludes simulator and flagged traffic consistently',async()=>{
    const tracked=await source();const id=await click(tracked);await db('Click').where({id}).update({fraudFlag:'manual'});
    const result=await report('&scenarioId=a');expect(result.counts.clicks).toBe(0);
    expect((await get(`/partners/${partnerId}/analytics?since=2026-10-15T00:00:00Z&until=2026-10-14T00:00:00Z`)).status).toBe(400);
  });
  it('exports and restores source metadata before its dependent clicks without losing scenario earnings',async()=>{
    const created=await post(`/partners/${partnerId}/materials`,{programId,title:'Материал для экспорта',formatId:'short',scenarioId:'a'}),material=created.body.material;
    const placed=await post(`/partners/${partnerId}/materials/${material.id}/placements`,{linkId:link.id,platform:{id:'ytshorts',name:'YouTube Shorts'},requestId:ulid()});
    const tracked=await customer(placed.body.source,1000);
    const all=await exportAll(db,tenantId);
    const bundle=Object.fromEntries(Object.entries(all).map(([table,rows])=>[table,(rows as Array<Record<string,unknown>>).filter(row=>row.partnerId===partnerId||(table==='Partner'&&row.id===partnerId)||(table==='Program'&&row.id===programId)||(table==='Identity'&&row.clickId===tracked.id)||(table==='Event'&&row.userId===tracked.userId))]));
    expect(bundle.PartnerLinkSource).toHaveLength(1);
    expect(bundle.PartnerMaterial).toHaveLength(1);
    const credentials=await db('ApiKey').where({tenantId,partnerId});
    await db('ApiKey').where({tenantId,partnerId}).del();
    for(const {table} of [...EXPORT_TABLES].reverse()){
      const key=primaryKeyOf(table),ids=bundle[table]!.map(row=>row[key]);
      if(ids.length)await db(table).where({tenantId}).whereIn(key,ids).del();
    }
    await importBundle(db,tenantId,bundle);
    await db('ApiKey').insert(credentials);
    const restored=await report('&scenarioId=a');
    expect(restored.counts).toMatchObject({clicks:1,registrations:1,paymentCount:1});
    expect(restored.amountsMinor.netAccrued).toBe(20000);
    expect((await get(`/partners/${partnerId}/materials/${material.id}`)).body.material.title).toBe(material.title);
  });
  it('restores a pre-registry calendar bundle with the same material IDs',async()=>{
    const snapshot=await db('CoachForecastSnapshot').where({partnerId}).whereRaw("data->>'scenarioId'='a'").first();
    const built=await post('/coach/me/calculator-plan',{programId,scenarioId:'a',snapshotId:snapshot.id,startDate:localDay(new Date(),'Europe/Moscow'),days:7,weekdays:[0,1,2,3,4,5,6],requestId:ulid()});
    expect(built.status,built.text).toBe(201);
    const tasks=await db('CoachTask').where({partnerId}),plans=await db('CoachPlan').where({partnerId});
    const legacy=tasks.map(t=>({...t,data:{...t.data,title:'Короткие видео · материал 1'}}));
    await db('PartnerMaterial').where({partnerId}).del();
    await importBundle(db,tenantId,{CoachPlan:plans,CoachTask:legacy});
    const view=await get(`/partners/${partnerId}/materials/${tasks[0].id}`);
    expect(view.status,view.text).toBe(200);expect(view.body.material.title).toContain('Короткое видео ·');
    expect(view.body.material.platforms.length).toBeGreaterThan(0);
  });
});
