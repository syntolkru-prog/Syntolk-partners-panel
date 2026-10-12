import '../apps/api/src/env.js';
import {createDb,DEFAULT_TENANT_ID} from '../packages/db/src/index.js';
import {writeFile,mkdir} from 'node:fs/promises';
import {planSummary} from '../apps/api/src/coach/plan-validation.js';
import {profileSchema} from '../apps/api/src/coach/schemas.js';
const db=await createDb({connectionString:process.env.DATABASE_URL!,bypassRls:true});
const headers={Authorization:`Bearer ${process.env.ADMIN_API_KEY}`,'Content-Type':'application/json'};
interface Run {id:string;status:string;data:{model:string;usage:Record<string,number>;output:{message:string};error?:{message:string}}}
async function request<T=unknown>(path:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch(`http://127.0.0.1:4601${path}`,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const data=await response.json() as {error?:string;detail?:unknown};
  if(!response.ok)throw new Error(`${path}: ${response.status} ${data.error??''} ${data.detail??''}`);
  return data as T;
}
try{
  const programs=await db('Program').where({tenantId:DEFAULT_TENANT_ID}).whereNull('endsAt');
  const program=programs.find(p=>(Array.isArray(p.commissionRule)?p.commissionRule:[p.commissionRule]).some((r:{type?:string;value?:number})=>r.type==='percent'&&r.value===20));
  if(!program)throw new Error('An existing active 20% program is required; no financial policy is created by this test.');
  const email='coach-smoke-20261013@example.test';
  let partner=await db('Partner').where({tenantId:DEFAULT_TENANT_ID,email}).first();
  if(!partner)partner=await request('/partners','POST',{email,name:'Тест ИИ-куратора · 13 октября',sendInvite:false,programIds:[program.id]});
  const prefix=`/admin/coach/partners/${partner.id}`;
  const me=await request<{profile:unknown}>(prefix);
  if(!me.profile)await request(`${prefix}/profile`,'PATCH',{version:0,complete:true,profile:{goalMinor:10000000,goalMetric:'monthly_net_accrual',targetDate:'2027-01-01',weeklyMinutes:120,sessionMinutes:30,daysPerWeek:3,timezone:'Europe/Moscow',channels:[{platform:'telegram',label:'Синтетический канал для проверки',formats:['post','circle'],audience:'Юристы',views:null}],experience:'tried',productUnderstanding:'Помощник для работы с документами',preferences:'Без длинных видео. Нужны понятные посильные шаги.',mode:'on_request',quietStart:21,quietEnd:9,proactiveConsent:false,aiConsent:true}});
  await mkdir('outputs',{recursive:true});
  const result:{partnerId:string;url:string;runs:unknown[]}={partnerId:partner.id,url:`http://127.0.0.1:5673/admin/coach?partnerId=${partner.id}`,runs:[]};
  for(const kind of ['message','plan']){
    const start=await request<{run:Run}>(`${prefix}/${kind==='message'?'messages':'plans/generate'}`,'POST',{programId:program.id,requestId:`walkthrough-${kind}-20261013${kind==='plan'?'-retry2':''}`,...(kind==='message'?{text:'Привет! У меня сегодня 20 минут. Помоги написать короткий пост для юристов о Syntolk. Давай без обещаний заработка: хочу начать с одного понятного шага.'}:{weekStart:'2026-10-12'})});
    let run=start.run;
    const deadline=Date.now()+125000;
    while(['queued','processing'].includes(run.status)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1000));run=(await request<{run:Run}>(`${prefix}/runs/${run.id}`)).run;}
    if(run.status!=='completed')throw new Error(`Live ${kind}: ${run.status} ${run.data?.error?.message??''}`);
    if(kind==='plan'&&process.argv.includes('--refresh-summary')){
      // Repair presentation only for the synthetic fixture created by this script.
      await db.transaction(async trx=>{
        const owner=await trx('Partner').where({id:partner.id,tenantId:DEFAULT_TENANT_ID,email}).first();
        if(!owner)throw new Error('Not the synthetic fixture owner');
        const saved=await trx('CoachRun').where({id:run.id,partnerId:owner.id,tenantId:DEFAULT_TENANT_ID}).first();
        const profile=await trx('CoachProfile').where({partnerId:owner.id,tenantId:DEFAULT_TENANT_ID}).first();
        const summary=planSummary(saved.data.output.tasks,profileSchema.parse(profile.data));
        const plan=await trx('CoachPlan').where({id:saved.data.objectId,partnerId:owner.id,tenantId:DEFAULT_TENANT_ID,status:'draft'}).first();
        if(plan&&plan.data.message!==summary){
          await trx('CoachPlan').where({id:plan.id}).update({version:plan.version+1,data:JSON.stringify({...plan.data,message:summary})});
          await trx('CoachMessage').where({partnerId:owner.id,tenantId:DEFAULT_TENANT_ID,role:'assistant'}).whereRaw("data->>'runId' = ?",[run.id]).update({data:trx.raw("jsonb_set(data,'{body}',?::jsonb)",[JSON.stringify(summary)])});
          await trx('CoachRun').where({id:run.id}).update({data:JSON.stringify({...saved.data,providerComment:saved.data.providerComment??saved.data.output.message,output:{...saved.data.output,message:summary}})});
        }
        run.data.output.message=summary;
      });
    }
    result.runs.push({kind,id:run.id,status:run.status,model:run.data.model,usage:run.data.usage,message:run.data.output.message});
    await writeFile('outputs/coach-local-walkthrough-20261013.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify({kind,status:run.status,model:run.data.model,usage:run.data.usage,url:result.url}));
  }
  // Do not silently accept the generated plan or publish anything.
}finally{await db.destroy();}
