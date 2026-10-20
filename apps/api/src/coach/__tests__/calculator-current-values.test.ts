import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import request from 'supertest';
import {ulid} from 'ulid';
import {DEFAULT_TENANT_ID as tenantId,trackingSourceParams} from '@openpartner/db';
import {createApp} from '../../app.js';
import {db,appDb} from '../../db.js';
import {generateApiKey} from '../../auth.js';
import {assertIsolatedCoachDatabase} from '../test-guard.js';
assertIsolatedCoachDatabase(process.env.DATABASE_URL!,process.env.COACH_WORKING_DB);
const app=createApp({enableLogger:false});
let partnerId:string,otherId:string,programId:string,token:string,linkId:string;
const get=(query:string)=>request(app).get(`/partners/${partnerId}/analytics/current?programId=${programId}&${query}`).set('Authorization',`Bearer ${token}`);
const publicationAt='2026-09-20T09:00:00.000Z',activityAt='2026-10-01T10:00:00.000Z';
beforeAll(async()=>{
  partnerId=ulid();otherId=ulid();programId=ulid();linkId=ulid();
  const credential=generateApiKey();token=credential.plaintext;
  await db('Partner').insert([partnerId,otherId].map(id=>({id,tenantId,name:'Current values test',email:id+'@example.test',activatedAt:new Date()})));
  await db('Program').insert({id:programId,tenantId,name:'Current values',destinationUrl:'https://syntolk.ru',commissionRule:JSON.stringify({type:'percent',value:20})});
  await db('PartnerProgram').insert({id:ulid(),tenantId,partnerId,programId,source:'admin'});
  await db('ApiKey').insert({id:ulid(),tenantId,partnerId,prefix:credential.prefix,keyHash:credential.hash});
  await db('Link').insert({id:linkId,tenantId,partnerId,programId,linkKey:'actual-'+ulid()});
  const planId=ulid();await db('CoachPlan').insert({id:planId,tenantId,partnerId,programId,status:'active',weekStart:'2026-09-20',data:JSON.stringify({})});
  const material=async(scenarioId:string,published:boolean,completed=false)=>{
    const id=ulid();await db('PartnerMaterial').insert({id,tenantId,partnerId,programId,scenarioId,title:'Material',formatId:'format-own',formatName:'Свой контент',platforms:'[]'});
    await db('CoachTask').insert({id,tenantId,partnerId,programId,planId,status:completed?'completed':'planned',data:JSON.stringify({materialId:id,completion:completed?{at:publicationAt}:null})});
    if(!published)return null;
    const sourceId=ulid();await db('PartnerLinkSource').insert({id:sourceId,tenantId,partnerId,programId,linkId,sourceKey:ulid(),materialId:id,scenarioId,platformId:'custom-own',platformName:'Своя площадка',formatId:'format-own',formatName:'Свой контент',publishedAt:publicationAt});return sourceId;
  };
  await material('a',false); // A generated planned task is not created/published content.
  await material('a',false,true);
  const a=await material('a',true,true),b=await material('b',true);
  const duplicate=await db('PartnerLinkSource').where({id:a}).first();
  await db('PartnerLinkSource').insert({...duplicate,id:ulid(),sourceKey:ulid(),platformId:'dzen',platformName:'Дзен'});
  for(const [sourceId,amount] of [[a,1000],[b,2000]] as const){
    const clickId=ulid(),userId=ulid();await db('Click').insert({id:clickId,tenantId,partnerId,programId,linkId,trackingSourceId:sourceId,ts:activityAt,landingUrl:'https://syntolk.ru'});
    for(const [type,value]of [['signup',null],['invoice_paid',amount],...(sourceId===a?[['recurring_payment',500]]:[])] as Array<[string,number|null]>){
      const eventId=ulid(),attributionId=ulid();await db('Event').insert({id:eventId,tenantId,userId,type,value,currency:value?'RUB':null,ts:new Date(Date.parse(activityAt)+(type==='recurring_payment'?2000:type==='invoice_paid'?1000:0)),externalEventId:ulid()});
      await db('Attribution').insert({id:attributionId,tenantId,partnerId,programId,eventId,clickId,model:'last_click',weight:1});
      if(value)await db('Commission').insert({id:ulid(),tenantId,partnerId,attributionId,currency:'RUB',amount:value*.2,status:'accrued',accruedAt:activityAt});
    }
  }
});
afterAll(async()=>{await Promise.all([db.destroy(),appDb.destroy()]);});
describe('current calculator values are facts, not a projection',()=>{
  it('lists owned publications with their current material title, base link and exact tracking parameters',async()=>{
    const response=await request(app).get(`/partners/${partnerId}/link-sources?programId=${programId}`).set('Authorization',`Bearer ${token}`);expect(response.status,response.text).toBe(200);
    expect(response.body.sources.length).toBeGreaterThan(0);
    for(const source of response.body.sources){expect(source.partnerId).toBe(partnerId);expect(source.programId).toBe(programId);expect(source.linkKey).toMatch(/^actual-/);expect(source.params).toEqual(trackingSourceParams(source));}
    const source=response.body.sources[0];await db('PartnerMaterial').where({id:source.materialId,tenantId,partnerId}).update({title:'Актуальное название публикации'});
    const updated=await request(app).get(`/partners/${partnerId}/link-sources?programId=${programId}`).set('Authorization',`Bearer ${token}`);expect(updated.body.sources.find((item:{id:string})=>item.id===source.id).materialTitle).toBe('Актуальное название публикации');
    expect((await request(app).get(`/partners/${otherId}/link-sources`).set('Authorization',`Bearer ${token}`)).status).toBe(403);
  });
  it('matches Results amounts/counts/conversions and counts actual material work without multiplying by placements',async()=>{
    const response=await get('period=all&scenarioId=a');expect(response.status,response.text).toBe(200);
    expect(response.body.content).toEqual({preparedMaterials:2,publishedMaterials:1,publishedPlacements:2});
    expect(response.body.counts).toMatchObject({clicks:1,registrations:1,payingCustomers:1,paymentCount:2});
    expect(response.body.amountsMinor).toMatchObject({observedPayments:150000,netAccrued:30000});
    expect(response.body.breakdown.formats).toHaveLength(1);
    expect(response.body.breakdown.formats[0]).toMatchObject({id:'format-own',name:'Свой контент',content:{preparedMaterials:2,publishedMaterials:1,publishedPlacements:2},clickShare:1,conversions:{clickToRegistration:1,registrationToPayment:1}});
    const custom=response.body.breakdown.platforms.find((row:{id:string})=>row.id==='custom-own');
    expect(custom).toMatchObject({name:'Своя площадка',counts:{clicks:1,paymentCount:2},content:{publishedMaterials:1,publishedPlacements:1}});
    expect(custom.formats).toHaveLength(1);expect(custom.formats[0]).toMatchObject({id:'format-own',counts:{clicks:1,paymentCount:2},content:{publishedMaterials:1,publishedPlacements:1}});
    const dzen=response.body.breakdown.platforms.find((row:{id:string})=>row.id==='dzen');
    expect(dzen).toMatchObject({counts:{clicks:0},content:{publishedPlacements:1},conversions:{clickToRegistration:null}});
    expect(dzen.formats).toHaveLength(1);
    const report=await request(app).get(`/partners/${partnerId}/analytics?programId=${programId}&period=all&scenarioId=a`).set('Authorization',`Bearer ${token}`);
    expect(response.body.counts).toEqual(report.body.counts);expect(response.body.amountsMinor).toEqual(report.body.amountsMinor);expect(response.body.conversions).toEqual(report.body.conversions);
  });
  it('keeps scenarios independent, includes custom content/platforms and all content only on request',async()=>{
    const b=await get('period=all&scenarioId=b');expect(b.body.amountsMinor.netAccrued).toBe(40000);expect(b.body.content.publishedMaterials).toBe(1);
    const all=await get('period=all');expect(all.body.amountsMinor.netAccrued).toBe(70000);expect(all.body.counts.paymentCount).toBe(3);expect(all.body.content).toEqual({preparedMaterials:3,publishedMaterials:2,publishedPlacements:3});
    const grouped=await request(app).get(`/partners/${partnerId}/analytics?programId=${programId}&period=all&groupBy=platform`).set('Authorization',`Bearer ${token}`);
    for(const row of grouped.body.rows){const fact=all.body.breakdown.platforms.find((item:{id:string})=>item.id===row.id);expect(fact.counts).toEqual(row.counts);expect(fact.conversions).toEqual(row.conversions);expect(fact.amountsMinor).toEqual(row.amountsMinor);}
    const empty=await get('period=all&scenarioId=brand-new');expect(empty.body.counts.clicks).toBe(0);expect(empty.body.amountsMinor.netAccrued).toBe(0);expect(empty.body.content.preparedMaterials).toBe(0);
  });
  it('uses event dates: September publication is not counted as October work, while October payments are',async()=>{
    const october=await get('period=custom&from=2026-10-01&to=2026-10-01&scenarioId=a');expect(october.status,october.text).toBe(200);
    expect(october.body.content).toEqual({preparedMaterials:0,publishedMaterials:0,publishedPlacements:0});expect(october.body.counts.paymentCount).toBe(2);expect(october.body.amountsMinor.netAccrued).toBe(30000);
    expect(october.body.breakdown.formats[0]).toMatchObject({content:{preparedMaterials:0,publishedMaterials:0,publishedPlacements:0},counts:{paymentCount:2}});
    const april=await get('period=custom&from=2025-04-01&to=2025-04-30');expect(april.status,april.text).toBe(200);expect(april.body.amountsMinor.netAccrued).toBe(0);expect(april.body.content.publishedMaterials).toBe(0);expect(april.body.conversions.clickToRegistration).toBeNull();
    expect(april.body.breakdown).toEqual({formats:[],platforms:[]});
  });
  it('returns exact selected chart-bucket facts and does not mix empty dates or scenarios',async()=>{
    const range=await get('period=custom&from=2026-09-20&to=2026-10-03&scenarioId=a');expect(range.status,range.text).toBe(200);
    const point=range.body.series.points.find((item:{date:string})=>item.date==='2026-10-01');
    expect(point).toMatchObject({since:'2026-09-30T21:00:00.000Z',until:'2026-10-01T21:00:00.000Z',clicks:1,registrations:1,payments:2,earningsMinor:30000});
    const detail=await get('period=custom&from=2026-10-01&to=2026-10-01&scenarioId=a');expect(detail.status,detail.text).toBe(200);
    expect(detail.body.counts.clicks).toBe(point.clicks);expect(detail.body.counts.registrations).toBe(point.registrations);
    expect(detail.body.counts.paymentCount).toBe(point.payments);expect(detail.body.amountsMinor.netAccrued).toBe(point.earningsMinor);expect(detail.body.amountsMinor.observedPayments).toBe(point.customerPaymentsMinor);
    expect(detail.body.content.preparedMaterials).toBe(0);
    const empty=await get('period=custom&from=2026-10-02&to=2026-10-02&scenarioId=a');expect(empty.status,empty.text).toBe(200);expect(empty.body.counts.paymentCount).toBe(0);expect(empty.body.amountsMinor.netAccrued).toBe(0);
    const other=await get('period=custom&from=2026-10-01&to=2026-10-01&scenarioId=b');expect(other.body.amountsMinor.netAccrued).toBe(40000);
  });
  it('validates dates and ownership and performs no database writes when reading current values',async()=>{
    expect((await get('period=custom&from=2025-04-30&to=2025-04-01')).status).toBe(400);
    expect((await get('period=custom&from=2025-02-30&to=2025-03-01')).status).toBe(400);
    expect((await request(app).get(`/partners/${otherId}/analytics/current?programId=${programId}`).set('Authorization',`Bearer ${token}`)).status).toBe(403);
    const unknown=await request(app).get(`/partners/${partnerId}/analytics/current?programId=${ulid()}`).set('Authorization',`Bearer ${token}`);expect(unknown.status).toBe(403);
    const queries:string[]=[],listener=(query:{sql:string})=>queries.push(query.sql);appDb.on('query',listener);
    try{expect((await get('period=all')).status).toBe(200);}finally{appDb.removeListener('query',listener);}
    expect(queries.some(sql=>/^\s*(insert|update|delete|alter|truncate|create)\b/i.test(sql))).toBe(false);
  });
  it('calculates separate measured rates for each platform and content type, not averages of their percentages',async()=>{
    for(const [platformId,formatId,clicks,signups]of [['dzen','article',2,1],['dzen','post',1,0],['vk','post',4,3]] as const){
      const sourceId=ulid();await db('PartnerLinkSource').insert({id:sourceId,tenantId,partnerId,programId,linkId,sourceKey:ulid(),scenarioId:'rates',platformId,platformName:platformId,formatId,formatName:formatId,publishedAt:publicationAt});
      for(let i=0;i<clicks;i++){
        const clickId=ulid(),userId=ulid();await db('Click').insert({id:clickId,tenantId,partnerId,programId,linkId,trackingSourceId:sourceId,ts:activityAt,landingUrl:'https://syntolk.ru'});
        if(i>=signups)continue;
        for(const type of (i===0?['signup','invoice_paid']:['signup'])){
          const eventId=ulid();await db('Event').insert({id:eventId,tenantId,userId,type,value:type==='signup'?null:100,currency:type==='signup'?null:'RUB',ts:new Date(Date.parse(activityAt)+(type==='signup'?0:1000)),externalEventId:ulid()});
          await db('Attribution').insert({id:ulid(),tenantId,partnerId,programId,eventId,clickId,model:'last_click',weight:1});
        }
      }
    }
    const response=await get('period=all&scenarioId=rates');expect(response.status,response.text).toBe(200);
    const dzen=response.body.breakdown.platforms.find((row:{id:string})=>row.id==='dzen'),vk=response.body.breakdown.platforms.find((row:{id:string})=>row.id==='vk');
    expect(dzen.conversions.clickToRegistration).toBeCloseTo(1/3);expect(vk.conversions.clickToRegistration).toBe(.75);expect(vk.conversions.registrationToPayment).toBeCloseTo(1/3);
    expect(dzen.clickShare).toBeCloseTo(3/7);expect(vk.clickShare).toBeCloseTo(4/7);
    expect(dzen.formats).toHaveLength(2);expect(dzen.formats.find((row:{id:string})=>row.id==='article').conversions.clickToRegistration).toBe(.5);
    expect(dzen.formats.find((row:{id:string})=>row.id==='post').conversions.clickToRegistration).toBe(0);
    const posts=response.body.breakdown.formats.find((row:{id:string})=>row.id==='post');expect(posts.counts.clicks).toBe(5);expect(posts.conversions.clickToRegistration).toBe(.6);
  });
});
