import '../apps/api/src/env.js';
import { createDb, DEFAULT_TENANT_ID } from '../packages/db/src/index.js';
import { resolveRouterCredentials, recordRouterVerification, testRouterConnection, publicRouterConnection } from '../apps/api/src/coach/connections.js';
import { responseJsonSchema } from '../apps/api/src/coach/provider.js';
const db = await createDb({connectionString:process.env.DATABASE_URL!,bypassRls:true});
try {
  const credentials=await resolveRouterCredentials(db,DEFAULT_TENANT_ID);
  const redact=(v:unknown)=>JSON.stringify(v).replaceAll(credentials.key,'[REDACTED]').replace(/sk-or-[A-Za-z0-9_-]+/g,'[REDACTED]');
  const meta=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:`Bearer ${credentials.key}`},redirect:'error',signal:AbortSignal.timeout(15000)});
  const data=await meta.json() as {data?:{limit_remaining?:number|null;is_free_tier?:boolean};error?:{code?:unknown;message?:unknown}};
  console.log(redact({keyStatus:meta.status,remainingKeyLimit:data.data?.limit_remaining,freeTier:data.data?.is_free_tier,error:data.error?.code}));
  const endpoints=await fetch(`https://openrouter.ai/api/v1/models/${credentials.model}/endpoints`,{redirect:'error',signal:AbortSignal.timeout(15000)});
  const catalog=await endpoints.json() as {data?:{endpoints?:Array<{provider_name:string;supported_parameters:string[];status:number}>}};
  const active = catalog.data?.endpoints?.filter(e=>e.status===0) ?? [];
  console.log(redact({model:credentials.model,status:endpoints.status,activeEndpoints:active.length,supportParallelFlag:active.filter(e=>e.supported_parameters.includes('parallel_tool_calls')).length}));
  if(process.argv.includes('--verify')) {
    const result = await testRouterConnection(credentials);
    await db.transaction(async trx => {
      await recordRouterVerification(trx,DEFAULT_TENANT_ID,credentials.version,result);
      if(process.argv.includes('--enable')) {
        const row = await trx('Config').where({tenantId:DEFAULT_TENANT_ID,key:'coach_settings'}).first();
        await trx('Config').where({tenantId:DEFAULT_TENANT_ID,key:'coach_settings'}).update({value:JSON.stringify({...row?.value,enabled:true,provider:'openrouter'}),updatedAt:new Date()});
      }
    });
    console.log(redact({verified:result,connection:await publicRouterConnection(db,DEFAULT_TENANT_ID),enabled:process.argv.includes('--enable')}));
  }
  if(process.argv.includes('--probe')){
    const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${credentials.key}`,'Content-Type':'application/json'},body:JSON.stringify({model:credentials.model,messages:[{role:'user',content:'Технический тест. Верни JSON: message="Привет", tasks=[], verdict="not_applicable", limitations=[].'}],max_completion_tokens:300,provider:{require_parameters:true,data_collection:'deny',zdr:true,allow_fallbacks:false},response_format:{type:'json_schema',json_schema:{name:'coach_response',strict:true,schema:responseJsonSchema}},tools:[{type:'function',function:{name:'get_metrics',description:'Тестовые показатели',parameters:{type:'object',properties:{},additionalProperties:false,required:[]},strict:true}}],...(process.argv.includes('--without-parallel')?{}:{parallel_tool_calls:false})})});
    const result=await response.json() as {error?:unknown;usage?:unknown;choices?:Array<{finish_reason:string}>};
    console.log(redact({probeStatus:response.status,error:result.error,usage:result.usage,finish:result.choices?.[0]?.finish_reason}));
  }
}finally{await db.destroy();}
