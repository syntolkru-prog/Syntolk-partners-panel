import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import request from 'supertest';
import {ulid} from 'ulid';
import {DEFAULT_TENANT_ID as tenantId,trackingSourceParams} from '@openpartner/db';
import {createApp} from '../../app.js';
import {db,appDb} from '../../db.js';
import {assertIsolatedCoachDatabase} from '../test-guard.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!,process.env.COACH_WORKING_DB);
if(new URL(process.env.DATABASE_URL!).pathname!=='/syntolk_coach_test_20261012'||process.env.INTEGRATION!=='run')throw new Error('Use the isolated coach test runner.');
const app=createApp({enableLogger:false});
const get=(path:string)=>request(app).get(path).set('Authorization',`Bearer ${process.env.ADMIN_API_KEY}`);
const post=(path:string,body:object)=>request(app).post(path).set('Authorization',`Bearer ${process.env.ADMIN_API_KEY}`).send(body);
let a:{partnerId:string;programId:string;formatId:string;platformId:string;scenarioId:string;link:any},b:typeof a;
const emptyPeriod='period=custom&from=2025-04-01&to=2025-04-30';
async function fixture(){
  const partnerId=ulid(),programId=ulid(),suffix=ulid().toLowerCase(),scenarioId='scenario-'+suffix,formatId='format-'+suffix,platformId='custom-'+suffix;
  await db('Partner').insert({id:partnerId,tenantId,name:'Catalog '+suffix,email:suffix+'@example.test',activatedAt:new Date()});
  await db('Program').insert({id:programId,tenantId,name:'Catalog '+suffix,destinationUrl:'https://example.test',commissionRule:JSON.stringify({type:'percent',value:20,recurring:true})});
  await db('PartnerProgram').insert({id:ulid(),tenantId,partnerId,programId,source:'admin'});
  const saved=await post(`/admin/coach/partners/${partnerId}/forecast-snapshots`,{programId,confirmed:true,scenarioId,scenarioName:'Saved custom definitions',settings:{frequency:{[formatId]:1},channels:{[platformId]:{enabled:true,formats:[formatId]}},customFormats:[{id:formatId,name:'Подкаст '+suffix,base:'circle'}],customChannels:[{id:platformId,name:'Площадка '+suffix,formats:[formatId]}]}});
  expect(saved.status,saved.text).toBe(201);
  const link=await post(`/partners/${partnerId}/links`,{programId,linkKey:'catalog-'+suffix});expect(link.status,link.text).toBe(201);
  return {partnerId,programId,formatId,platformId,scenarioId,link:link.body};
}
beforeAll(async()=>{a=await fixture();b=await fixture();});
afterAll(async()=>{await Promise.all([db.destroy(),appDb.destroy()]);});

describe('saved platform and content catalogs in analytics',()=>{
  it('shows saved custom choices in admin and partner reports before any links have activity',async()=>{
    for(const path of [`/admin/analytics?view=summary&partnerIds=${a.partnerId}`,`/partners/${a.partnerId}/analytics?groupBy=platform`]){
      const response=await get(`${path}&${emptyPeriod}&programId=${a.programId}`);expect(response.status,response.text).toBe(200);
      expect(response.body.counts.clicks).toBe(0);
      expect(response.body.options.formats.some((item:any)=>item.id===a.formatId)).toBe(true);
      expect(response.body.options.platforms.some((item:any)=>item.id===a.platformId)).toBe(true);
      for(const id of ['post','short','long','article','circle'])expect(response.body.options.formats.some((item:any)=>item.id===id)).toBe(true);
      expect(response.body.options.formats.some((item:any)=>item.id===b.formatId)).toBe(false);
    }
  });
  it('does not narrow choice catalogs by the selected platform, content type or empty date range',async()=>{
    const response=await get(`/admin/analytics?view=summary&partnerIds=${a.partnerId}&programId=${a.programId}&platformIds=vk&formatIds=article&${emptyPeriod}`);
    expect(response.status,response.text).toBe(200);
    expect(response.body.options.formats.some((item:any)=>item.id===a.formatId)).toBe(true);
    expect(response.body.options.platforms.some((item:any)=>item.id===a.platformId)).toBe(true);
    const other=await get(`/admin/analytics?view=summary&partnerIds=${a.partnerId}&programId=${b.programId}&${emptyPeriod}`);
    expect(other.status,other.text).toBe(200);
    expect(other.body.options.formats.some((item:any)=>[a.formatId,b.formatId].includes(item.id))).toBe(false);
    expect(other.body.options.platforms.some((item:any)=>[a.platformId,b.platformId].includes(item.id))).toBe(false);
  });
  it('picks up new material platforms without requiring a calculator snapshot or measured traffic',async()=>{
    const formatId='format-material-'+ulid().toLowerCase(),platformId='custom-material-'+ulid().toLowerCase();
    await db('PartnerMaterial').insert({id:ulid(),tenantId,partnerId:a.partnerId,programId:a.programId,title:'New format',formatId,formatName:'Материал автора',platforms:JSON.stringify([{id:platformId,name:'Новая площадка материала'}])});
    for(const path of [`/admin/analytics?view=summary&partnerIds=${a.partnerId}`,`/partners/${a.partnerId}/analytics?groupBy=platform`]){
      const response=await get(`${path}&${emptyPeriod}`);expect(response.status,response.text).toBe(200);
      expect(response.body.options.formats.some((item:any)=>item.id===formatId)).toBe(true);
      expect(response.body.options.platforms.some((item:any)=>item.id===platformId)).toBe(true);
    }
  });
  it('counts clicks, registrations, payments and commissions for custom content and platforms in both periods and reports',async()=>{
    const source=await post(`/partners/${a.partnerId}/links/${a.link.id}/sources`,{scenarioId:a.scenarioId,formatId:a.formatId,platformId:a.platformId});expect(source.status,source.text).toBe(200);
    const params=trackingSourceParams(source.body.source),clickId=ulid(),userId=ulid();
    const click=await post('/clicks',{id:clickId,linkKey:a.link.linkKey,landingUrl:'https://example.test',ts:new Date(Date.now()-1000).toISOString(),utmCampaign:params.utm_campaign,utmSource:params.utm_source,utmMedium:params.utm_medium,utmContent:params.utm_content});expect(click.status,click.text).toBe(201);
    expect((await post('/attribution/identify',{cref:clickId,userId})).status).toBe(200);
    const signup=await post('/attribution/events',{userId,type:'signup',ts:new Date().toISOString(),externalEventId:ulid()});expect(signup.status,signup.text).toBe(200);
    const paid=await post('/payments/events',{userId,value:1000,currency:'RUB',externalEventId:ulid()});expect(paid.status,paid.text).toBe(201);
    const query=`period=today&programId=${a.programId}&formatIds=${a.formatId}&platformIds=${a.platformId}&includeSeries=true&seriesBy=format&includeComparison=true&compareFrom=2025-04-01&compareTo=2025-04-30`;
    const admin=await get(`/admin/analytics?view=summary&partnerIds=${a.partnerId}&${query}`);expect(admin.status,admin.text).toBe(200);
    const partner=await get(`/partners/${a.partnerId}/analytics?${query}`);expect(partner.status,partner.text).toBe(200);
    for(const report of [admin.body,partner.body]){
      expect(report.counts).toMatchObject({clicks:1,registrations:1,paymentCount:1,payingCustomers:1});
      expect(report.amountsMinor).toMatchObject({observedPayments:100000,netAccrued:20000});
      expect(report.comparison.counts.clicks).toBe(0);expect(report.comparison.amountsMinor.observedPayments).toBe(0);
      expect(report.series.groups.find((item:any)=>item.id===a.formatId)?.name).toMatch(/^Подкаст/);
    }
    const table=await get(`/admin/analytics/partners?partnerIds=${a.partnerId}&${query}`);expect(table.status,table.text).toBe(200);expect(table.body.items[0].counts.clicks).toBe(1);
  });
});
