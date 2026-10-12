import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import { DEFAULT_TENANT_ID } from '@openpartner/db';
import { createApp } from '../../app.js';
import { db, appDb } from '../../db.js';
import { generateApiKey } from '../../auth.js';
import { __resetCryptoKeyForTests } from '../../crypto.js';
import { exportAll, buildSqlDump, SCHEMA_VERSION } from '../../export.js';
import { assertIsolatedCoachDatabase } from '../test-guard.js';
import { CONNECTION_KEY, listRouterModels, publicRouterConnection, recordRouterVerification, removeRouterConnection, resolveRouterCredentials, saveRouterConnection, testRouterConnection } from '../connections.js';
import { profileSchema } from '../schemas.js';
import { processCoachJob } from '../worker.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!, process.env.COACH_WORKING_DB);
const app=createApp({enableLogger:false}), tenantId=DEFAULT_TENANT_ID, admin=process.env.ADMIN_API_KEY!;
const fakeKey='sk-or-v1-FAKE-LOCAL-TEST-ONLY-NOT-A-SECRET';
const headers=(token=admin)=>({Authorization:`Bearer ${token}`});
let partnerId:string,partnerKey:string;
const put=(body:object,token=admin)=>request(app).put('/admin/coach/openrouter').set(headers(token)).send(body);
const save=()=>saveRouterConnection(db,tenantId,{version:'env',apiKey:fakeKey,model:'test/model'});
const answer=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({message:'Привет! Помогу с первым шагом.',tasks:[],verdict:'not_applicable',limitations:[]})}}],usage:{prompt_tokens:10,completion_tokens:10,cost:0}}));
beforeEach(async()=>{
  vi.stubEnv('SECRETS_ENCRYPTION_KEY','a'.repeat(64));__resetCryptoKeyForTests();
  await db('Config').where({tenantId,key:CONNECTION_KEY}).del();
  await db('Config').insert({tenantId,key:'coach_settings',value:JSON.stringify({enabled:true,provider:'template',dailyRuns:20,takeover:[]})}).onConflict(['tenantId','key']).merge({value:JSON.stringify({enabled:true,provider:'template',dailyRuns:20,takeover:[]})});
  partnerId=ulid();const k=generateApiKey();partnerKey=k.plaintext;
  await db('Partner').insert({id:partnerId,tenantId,name:'Тест подключения',email:`${partnerId}@example.test`,activatedAt:new Date()});
  await db('ApiKey').insert({id:ulid(),tenantId,partnerId,prefix:k.prefix,keyHash:k.hash,label:'connection test'});
});
afterEach(async()=>{await db('Config').where({tenantId,key:CONNECTION_KEY}).del();vi.unstubAllGlobals();vi.unstubAllEnvs();__resetCryptoKeyForTests();});
afterAll(async()=>{await db.destroy();await appDb.destroy();});
describe('OpenRouter admin configuration',()=>{
  it('denies partner access to settings, models, save, delete and paid probe',async()=>{
    for(const path of ['/admin/coach/openrouter','/admin/coach/openrouter/models'])expect((await request(app).get(path).set(headers(partnerKey))).status).toBe(403);
    expect((await put({version:'env',apiKey:fakeKey,model:'test/model'},partnerKey)).status).toBe(403);
    expect((await request(app).delete('/admin/coach/openrouter').set(headers(partnerKey)).send({version:'env'})).status).toBe(403);
    expect((await request(app).post('/admin/coach/openrouter/test').set(headers(partnerKey)).send({version:'env',acceptCost:true})).status).toBe(403);
  });
  it('encrypts at rest, exposes no secret/ciphertext and does not call a provider on save',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const response=await put({version:'env',apiKey:fakeKey,model:'test/model'});expect(response.status,response.text).toBe(200);expect(response.body.hasKey).toBe(true);expect(response.body.keySource).toBe('ui');
    expect(response.text).not.toContain(fakeKey);expect(response.text).not.toContain('ciphertext');expect(fetch).not.toHaveBeenCalled();
    const row=await db('Config').where({tenantId,key:CONNECTION_KEY}).first();expect(JSON.stringify(row)).not.toContain(fakeKey);expect(row.value.ciphertext.length).toBeGreaterThan(20);
    expect((await resolveRouterCredentials(db,tenantId)).key).toBe(fakeKey);
    const audit=await db('CoachAuditEvent').where({tenantId,status:'connection_saved'});expect(JSON.stringify(audit)).not.toContain(fakeKey);
    const publicState=await request(app).get('/admin/coach/openrouter').set(headers());expect(publicState.headers['cache-control']).toBe('no-store');expect(publicState.text).not.toContain(row.value.ciphertext);
  });
  it('keeps an existing key when omitted and rejects a stale browser version',async()=>{
    await save();const before=await publicRouterConnection(db,tenantId);
    const response=await put({version:before.version,model:'test/another'});expect(response.status).toBe(200);expect((await resolveRouterCredentials(db,tenantId)).key).toBe(fakeKey);
    expect((await put({version:before.version,model:'test/another'})).status).toBe(409);
  });
  it('does not accept unknown fields, header injection or invalid model IDs',async()=>{
    for(const body of [{version:'env',apiKey:fakeKey,model:'test/model',url:'https://evil.test'}, {version:'env',apiKey:fakeKey+'\r\nx:1',model:'test/model'}, {version:'env',apiKey:fakeKey,model:'invalid model'}])expect((await put(body)).status).toBe(422);
    expect((await put({version:'env',apiKey:fakeKey,model:'~test/latest'})).status).toBe(200);
  });
  it('requires secure master-key configuration for UI secrets',async()=>{
    vi.stubEnv('SECRETS_ENCRYPTION_KEY','');expect((await put({version:'env',apiKey:fakeKey,model:'test/model'})).status).toBe(503);
    expect(await db('Config').where({tenantId,key:CONNECTION_KEY}).first()).toBeUndefined();
  });
  it('requires successful verification to activate and rotation returns to demo',async()=>{
    await save();const body={enabled:true,provider:'openrouter',dailyRuns:20};
    expect((await request(app).patch('/admin/coach/settings').set(headers()).send(body)).status).toBe(409);
    const old=await publicRouterConnection(db,tenantId);await recordRouterVerification(db,tenantId,old.version,{ok:true,model:'test/model',detail:'Test'});
    expect((await request(app).patch('/admin/coach/settings').set(headers()).send(body)).status).toBe(200);
    await saveRouterConnection(db,tenantId,{version:old.version,apiKey:fakeKey+'2',model:'test/model'});
    expect((await db('Config').where({tenantId,key:'coach_settings'}).first()).value.provider).toBe('template');expect((await publicRouterConnection(db,tenantId)).verification).toBeNull();
  });
  it('removal blocks implicit env fallback and preserves business records',async()=>{
    await save();const old=await publicRouterConnection(db,tenantId);vi.stubEnv('OPENROUTER_API_KEY','server-key-not-to-fall-back');
    await removeRouterConnection(db,tenantId,old.version);expect((await publicRouterConnection(db,tenantId)).hasKey).toBe(false);expect((await resolveRouterCredentials(db,tenantId)).key).toBe('');expect(await db('Partner').where({tenantId,id:partnerId}).first()).toBeTruthy();
    await expect(saveRouterConnection(db,tenantId,{version:(await publicRouterConnection(db,tenantId)).version,model:'test/model'})).rejects.toThrow('Вставьте');
  });
  it('isolates stored credentials by tenant',async()=>{
    await save();const other=ulid();await db('Tenant').insert({id:other,slug:`t-${other.toLowerCase()}`,displayName:'Другой tenant',approvalStatus:'approved'});
    expect((await publicRouterConnection(db,other)).hasKey).toBe(false);expect((await resolveRouterCredentials(db,other)).key).toBe('');
  });
  it('excludes provider configuration from both JSON and SQL export',async()=>{
    await save();const bundle=await exportAll(db,tenantId);expect(Object.hasOwn(bundle,'Config')).toBe(false);expect(JSON.stringify(bundle)).not.toContain(fakeKey);expect(buildSqlDump({schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),tables:bundle})).not.toContain(CONNECTION_KEY);
  });
  it('filters models by tools + JSON schema support and returns per-million prices',async()=>{
    const fake=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:[{id:'test/good',name:'Good',supported_parameters:['tools','structured_outputs'],pricing:{prompt:'0.000001',completion:'0.000002'},context_length:10000},{id:'test/no-tools',name:'Not compatible',supported_parameters:['structured_outputs']},{id:'test/no-schema',name:'Not compatible',supported_parameters:['tools','response_format']},{id:'test/good:batch',name:'Batch',supported_parameters:['tools','structured_outputs']}]})));vi.stubGlobal('fetch',fake);
    expect(await listRouterModels()).toEqual([{id:'test/good',name:'Good',contextLength:10000,inputPerMillion:1,outputPerMillion:2}]);expect(fake.mock.calls[0]![1].headers).toBeUndefined();
  });
  it('reports unavailable catalogue and rejected key without leaking upstream error text',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(fakeKey,{status:401})));
    await expect(listRouterModels()).rejects.toThrow('каталог');await expect(testRouterConnection({key:fakeKey,model:'test/model',version:'x'})).rejects.toThrow('отклонил ключ');
  });
  it('runs a cost-consented synthetic probe via the actual structured adapter and persists its result',async()=>{
    await save();const old=await publicRouterConnection(db,tenantId);const fake=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:{}}))).mockResolvedValueOnce(answer());vi.stubGlobal('fetch',fake);
    const r=await request(app).post('/admin/coach/openrouter/test').set(headers()).send({version:old.version,acceptCost:true});expect(r.status,r.text).toBe(200);expect(r.body.ok).toBe(true);expect((await publicRouterConnection(db,tenantId)).verification?.ok).toBe(true);
    const sent=JSON.parse(fake.mock.calls[1]![1].body);expect(sent.max_completion_tokens).toBe(1000);expect(JSON.stringify(sent)).not.toContain(partnerId);expect(JSON.stringify(sent)).not.toContain(fakeKey);expect(sent.provider.zdr).toBe(true);
  });
  it('does not verify changed credentials after a concurrent save during external I/O',async()=>{
    await save();const old=await publicRouterConnection(db,tenantId);const fake=vi.fn().mockImplementationOnce(async()=>{await db.transaction(trx=>saveRouterConnection(trx,tenantId,{version:old.version,model:'test/new'}));return new Response(JSON.stringify({data:{}}));}).mockResolvedValueOnce(answer());vi.stubGlobal('fetch',fake);
    const r=await request(app).post('/admin/coach/openrouter/test').set(headers()).send({version:old.version,acceptCost:true});expect(r.status,r.text).toBe(409);expect((await publicRouterConnection(db,tenantId)).verification).toBeNull();
  });
  it('worker uses tenant UI credentials without putting them in run output',async()=>{
    await save();const conn=await publicRouterConnection(db,tenantId);await recordRouterVerification(db,tenantId,conn.version,{ok:true,model:'test/model',detail:'Test'});
    await db('Config').where({tenantId,key:'coach_settings'}).update({value:JSON.stringify({enabled:true,provider:'openrouter',dailyRuns:20,takeover:[]})});
    const programId=ulid();await db('Program').insert({id:programId,tenantId,name:'Test',destinationUrl:'https://syntolk.ru',commissionRule:JSON.stringify({type:'percent',value:20})});await db('PartnerProgram').insert({id:ulid(),tenantId,partnerId,programId,source:'admin'});
    const profile=profileSchema.parse({goalMinor:100,goalMetric:'monthly_net_accrual',targetDate:'2027-01-01',weeklyMinutes:30,sessionMinutes:30,daysPerWeek:1,timezone:'Europe/Moscow',channels:[],experience:'new',productUnderstanding:'',preferences:'',mode:'on_request',quietStart:21,quietEnd:9,proactiveConsent:false,aiConsent:true});
    await db('CoachProfile').insert({id:ulid(),tenantId,partnerId,status:'complete',version:1,data:JSON.stringify(profile)});
    const fake=vi.fn().mockResolvedValue(answer());vi.stubGlobal('fetch',fake);
    const r=await request(app).post('/coach/me/messages').set(headers(partnerKey)).send({programId,requestId:ulid(),text:'Помоги с постом'});expect(r.status,r.text).toBe(202);
    await processCoachJob();const run=await db('CoachRun').where({id:r.body.run.id}).first();expect(run.status).toBe('completed');expect(fake.mock.calls[0]![1].headers.Authorization).toBe(`Bearer ${fakeKey}`);expect(JSON.stringify(run)).not.toContain(fakeKey);
  });
});
