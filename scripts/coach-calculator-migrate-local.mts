import '../apps/api/src/env.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDb,DEFAULT_TENANT_ID as tenantId} from '../packages/db/src/index.js';
const url=new URL(process.env.DATABASE_URL!);
if(!['127.0.0.1','localhost','::1'].includes(url.hostname)||url.pathname.includes('_test'))throw new Error('Only the working local database is allowed.');
const db=await createDb({connectionString:url.toString(),bypassRls:true});
const marker='coach_calculator_workflow_migration_v1',source='calculator_schedule_v1';
try{
 if(await db('Config').where({tenantId,key:marker}).first()){console.log(JSON.stringify({alreadyMigrated:true}));process.exitCode=0;}
 else await db.transaction(async trx=>{
  const plans=await trx('CoachPlan').where({tenantId}).whereNot('status','archived').whereRaw("coalesce(data->>'source','') <> ?",[source]);
  const ids=plans.map(p=>p.id),partners=[...new Set(plans.map(p=>p.partnerId))];
  const tasks=await trx('CoachTask').where({tenantId}).whereIn('planId',ids);
  const messages=await trx('CoachMessage').where({tenantId}).whereIn('partnerId',partners).whereNot('status','archived');
  const profiles=await trx('CoachProfile').where({tenantId}).whereIn('partnerId',partners);
  const runs=await trx('CoachRun').where({tenantId}).whereIn('partnerId',partners).whereIn('status',['queued','processing']);
  const notifications=await trx('CoachNotification').where({tenantId}).whereIn('partnerId',partners);
  const daily=await trx('Config').where({tenantId}).where('key','like','coach_daily_plan:%');
  const report={legacyPlans:plans.length,tasks:tasks.length,messages:messages.length,profiles:profiles.length,queuedRuns:runs.length};
  if(process.argv[2]!=='apply'){console.log(JSON.stringify({inspect:true,...report}));return;}
  const at=new Date().toISOString(),folder=new URL('../.local-demo/',import.meta.url);
  await mkdir(folder,{recursive:true});
  const backup=new URL(`coach-before-calculator-${at.replace(/[:.]/g,'-')}.json`,folder);
  await writeFile(backup,JSON.stringify({at,tenantId,plans,tasks,messages,profiles,runs,notifications,daily},null,2),{flag:'wx'});
  await trx('CoachTask').where({tenantId}).whereIn('planId',ids).whereNot('status','completed').update({status:'cancelled',version:trx.raw('version + 1'),updatedAt:new Date()});
  await trx('CoachPlan').where({tenantId}).whereIn('id',ids).update({status:'archived',version:trx.raw('version + 1'),updatedAt:new Date()});
  await trx('CoachMessage').where({tenantId}).whereIn('id',messages.map(m=>m.id)).update({status:'archived',updatedAt:new Date()});
  await trx('CoachProfile').where({tenantId}).whereIn('id',profiles.map(p=>p.id)).update({status:'draft',version:trx.raw('version + 1'),updatedAt:new Date()});
  await trx('CoachRun').where({tenantId}).whereIn('id',runs.map(r=>r.id)).update({status:'cancelled',updatedAt:new Date()});
  await trx('CoachNotification').where({tenantId}).whereIn('id',notifications.map(n=>n.id)).update({status:'read',updatedAt:new Date()});
  await trx('Config').insert({tenantId,key:marker,value:JSON.stringify({at,report,backup:backup.pathname})});
  console.log(JSON.stringify({archived:true,...report,backup:decodeURIComponent(backup.pathname)}));
 });
}finally{await db.destroy();}
