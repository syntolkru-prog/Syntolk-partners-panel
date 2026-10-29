import {afterAll,beforeEach,describe,expect,it} from 'vitest';
import request from 'supertest';
import {ulid} from 'ulid';
import {DEFAULT_TENANT_ID as tenantId,trackingSourceForClick} from '@openpartner/db';
import {createApp} from '../../app.js';
import {db,appDb} from '../../db.js';
import {generateApiKey} from '../../auth.js';
import {assertIsolatedCoachDatabase} from '../test-guard.js';
assertIsolatedCoachDatabase(process.env.DATABASE_URL!,process.env.COACH_WORKING_DB);
const app=createApp({enableLogger:false});
let partnerId:string,otherId:string,programId:string,key:string;
const post=(body:object,id=partnerId)=>request(app).post(`/partners/${id}/publications`).set('Authorization',`Bearer ${key}`).send(body);
const input=()=>({requestId:ulid(),programId,title:'Обзор сервиса',formatId:'short',platform:{id:'ytshorts',name:'YouTube Shorts'}});
beforeEach(async()=>{
  partnerId=ulid();otherId=ulid();programId=ulid();const credential=generateApiKey();key=credential.plaintext;
  await db('Partner').insert([partnerId,otherId].map(id=>({id,tenantId,name:'Standalone publication test',email:`${id}@example.test`,activatedAt:new Date()})));
  await db('Program').insert({id:programId,tenantId,name:'Standalone publications',destinationUrl:'https://syntolk.ru/',commissionRule:JSON.stringify({type:'percent',value:20})});
  await db('PartnerProgram').insert({id:ulid(),tenantId,partnerId,programId,source:'admin'});
  await db('ApiKey').insert({id:ulid(),tenantId,partnerId,prefix:credential.prefix,keyHash:credential.hash});
});
afterAll(async()=>{await db.destroy();await appDb.destroy();});
describe('standalone publication links share canonical attribution',()=>{
  it('creates a prepared tracking link without any calculator profile, scenario or plan',async()=>{
    const response=await post(input());expect(response.status,response.text).toBe(201);
    expect(response.body.material.scenarioId).toBeNull();expect(response.body.source.publishedAt).toBeNull();
    expect(response.body.params).toMatchObject({utm_campaign:'__none__',utm_source:'ytshorts',utm_medium:'short',utm_content:response.body.source.id});
    const link=await db('Link').where({id:response.body.source.linkId}).first();expect(link.partnerId).toBe(partnerId);
    const p=response.body.params;
    expect(await trackingSourceForClick(db,link,{campaign:p.utm_campaign,source:p.utm_source,medium:p.utm_medium,content:p.utm_content})).toBe(response.body.source.id);
    expect(await trackingSourceForClick(db,link,{})).toBeNull();
    for(const table of ['CoachProfile','CoachPlan','CoachForecastSnapshot','CoachTask','Commission'])expect(await db(table).where({partnerId})).toHaveLength(0);
  });
  it('reuses an existing link and returns the same source on retry without duplicating anything',async()=>{
    const linkId=ulid();await db('Link').insert({id:linkId,tenantId,partnerId,programId,linkKey:ulid()});
    const body={...input(),linkId};const first=await post(body),again=await post(body);
    expect(first.status,first.text).toBe(201);expect(again.status,again.text).toBe(201);
    expect(again.body.source.id).toBe(first.body.source.id);expect(first.body.source.linkId).toBe(linkId);
    for(const table of ['Link','PartnerMaterial','PartnerLinkSource'])expect(await db(table).where({partnerId})).toHaveLength(1);
    expect((await post({...body,platform:{id:'vk',name:'ВКонтакте'}})).status).toBe(409);
  });
  it('serializes double-submit and allocates only one base link',async()=>{
    const body=input();const [one,two]=await Promise.all([post(body),post(body)]);
    expect(one.status,one.text).toBe(201);expect(two.status,two.text).toBe(201);expect(one.body.source.id).toBe(two.body.source.id);
    expect(await db('Link').where({partnerId})).toHaveLength(1);
  });
  it('counts attributed clicks, registrations and payments equally in admin, Results and calculator fact',async()=>{
    const created=await post({...input(),published:true,publicationUrl:'https://youtube.com/shorts/test'});expect(created.status,created.text).toBe(201);
    const source=created.body.source,clickId=ulid(),userId=ulid(),ts=new Date();
    await db('Click').insert({id:clickId,tenantId,partnerId,programId,linkId:source.linkId,trackingSourceId:source.id,ts,landingUrl:'https://syntolk.ru'});
    for(const type of ['signup','invoice_paid']){
      const eventId=ulid(),attributionId=ulid(),value=type==='signup'?null:1000;
      await db('Event').insert({id:eventId,tenantId,userId,type,value,currency:value?'RUB':null,ts,externalEventId:ulid()});
      await db('Attribution').insert({id:attributionId,tenantId,partnerId,programId,eventId,clickId,model:'last_click',weight:1});
      if(value)await db('Commission').insert({id:ulid(),tenantId,partnerId,attributionId,amount:200,currency:'RUB',status:'accrued',accruedAt:ts});
    }
    const query=`programId=${programId}&period=all`;
    const get=(path:string,token=key)=>request(app).get(path).set('Authorization',`Bearer ${token}`);
    const results=await get(`/partners/${partnerId}/analytics?${query}&groupBy=source`);
    const fact=await get(`/partners/${partnerId}/analytics/current?${query}`);
    const admin=await get(`/admin/analytics?${query}&partnerId=${partnerId}&view=summary`,process.env.ADMIN_API_KEY!);
    for(const response of [results,fact,admin]){
      expect(response.status,response.text).toBe(200);expect(response.body.counts).toMatchObject({clicks:1,registrations:1,paymentCount:1});
      expect(response.body.amountsMinor).toMatchObject({observedPayments:100000,netAccrued:20000});
    }
    expect(fact.body.content).toMatchObject({publishedMaterials:1,publishedPlacements:1});
    const byLink=await get(`/partners/${partnerId}/analytics?${query}&groupBy=link`);
    expect(byLink.body.counts).toEqual(results.body.counts);expect(byLink.body.rows[0].amountsMinor.netAccrued).toBe(20000);
    const scenario=await get(`/partners/${partnerId}/analytics/current?${query}&scenarioId=unrelated`);expect(scenario.body.counts.clicks).toBe(0);
  });
  it('rolls back the whole operation when the selected base link is invalid',async()=>{
    const response=await post({...input(),linkId:ulid()});expect(response.status,response.text).toBe(404);
    for(const table of ['Link','PartnerMaterial','PartnerLinkSource'])expect(await db(table).where({partnerId})).toHaveLength(0);
  });
  it('keeps optional scenario and custom formats/platforms connected to source options',async()=>{
    await db('CoachForecastSnapshot').insert({id:ulid(),tenantId,partnerId,programId,status:'confirmed',data:JSON.stringify({scenarioId:'own',scenarioName:'Мой сценарий',settings:{customFormats:[{id:'format-live',name:'Прямой эфир',base:'long'}]}})});
    const created=await post({...input(),scenarioId:'own',formatId:'format-live',platform:{id:'custom-channel',name:'Моя площадка'},published:true});
    expect(created.status,created.text).toBe(201);expect(created.body.source).toMatchObject({scenarioId:'own',scenarioName:'Мой сценарий',formatId:'format-live',formatName:'Прямой эфир'});
    const catalog=await request(app).get(`/partners/${partnerId}/material-catalog?programId=${programId}`).set('Authorization',`Bearer ${key}`);
    expect(catalog.body.platforms).toContainEqual(expect.objectContaining({id:'custom-channel',name:'Моя площадка',formats:expect.arrayContaining(['format-live'])}));
    expect(catalog.body.formats).toContainEqual({id:'format-live',name:'Прямой эфир'});
    expect(catalog.body.scenarios).toContainEqual({id:'own',name:'Мой сценарий',programId});
  });
  it('rejects unknown scenarios, unknown formats and unsafe publication URLs without writes',async()=>{
    expect((await post({...input(),scenarioId:'foreign'})).status).toBe(404);
    expect((await post({...input(),formatId:'unknown'})).status).toBe(422);
    expect((await post({...input(),publicationUrl:'javascript:alert(1)'})).status).toBe(422);
    for(const table of ['Link','PartnerMaterial','PartnerLinkSource'])expect(await db(table).where({partnerId})).toHaveLength(0);
  });
  it('rejects foreign partners and ungranted programs',async()=>{
    expect((await post(input(),otherId)).status).toBe(403);
    const response=await post({...input(),programId:ulid()});expect(response.status,response.text).toBe(403);
    expect(await db('PartnerMaterial').where({partnerId})).toHaveLength(0);
  });
});
