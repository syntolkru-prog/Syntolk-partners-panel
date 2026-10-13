import '../apps/api/src/env.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDb, DEFAULT_TENANT_ID as tenantId } from '../packages/db/src/index.js';
import { CALCULATOR_PLAN_SOURCE, createCalculatorPlan } from '../apps/api/src/coach/calculator-plan.js';
import { localDay } from '../apps/api/src/coach/daily-plan.js';
import { randomUUID } from 'node:crypto';

// Upgrade only local, unfinished calendars. A backup precedes every write.
const url=new URL(process.env.DATABASE_URL!);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname.includes('_test'))throw new Error('Expected the local working database.');
const db=await createDb({connectionString:url.toString(),bypassRls:true});
try {
  const plans=await db('CoachPlan').where({tenantId,status:'active'}).whereRaw("data->>'source' = ?",[CALCULATOR_PLAN_SOURCE]).whereRaw("coalesce(data->>'schemaVersion','1') <> '2'");
  const candidates=[];
  for(const plan of plans){
    const tasks=await db('CoachTask').where({tenantId,partnerId:plan.partnerId,planId:plan.id});
    const completed=tasks.filter(task=>task.status==='completed').length;
    const snapshot=await db('CoachForecastSnapshot').where({tenantId,partnerId:plan.partnerId,programId:plan.programId,id:plan.data.snapshotId}).first();
    candidates.push({plan,tasks,completed,snapshot});
  }
  console.log(JSON.stringify({inspect:true,calendars:candidates.map(({plan,tasks,completed,snapshot})=>({partnerId:plan.partnerId,planId:plan.id,tasks:tasks.length,completed,canUpgrade:completed===0&&!!snapshot}))}));
  if(process.argv[2]==='apply'){
    const at=new Date().toISOString(),folder=new URL('../.local-demo/',import.meta.url);
    await mkdir(folder,{recursive:true});
    const backup=new URL(`calculator-before-v2-${at.replace(/[:.]/g,'-')}.json`,folder);
    await writeFile(backup,JSON.stringify({at,tenantId,candidates},null,2),{flag:'wx'});
    for(const {plan,completed,snapshot} of candidates){
      if(completed||!snapshot)continue;
      const today=localDay(new Date(),plan.data.timezone??'Europe/Moscow');
      const rebuilt=await db.transaction(trx=>createCalculatorPlan(trx,tenantId,plan.partnerId,{
        programId:plan.programId,snapshotId:snapshot.id,startDate:plan.data.startDate<today?today:plan.data.startDate,
        days:plan.data.days,weekdays:plan.data.weekdays,requestId:`upgrade-${randomUUID()}`,replacePlanId:plan.id,replaceVersion:plan.version,
      }));
      console.log(JSON.stringify({upgraded:true,partnerId:plan.partnerId,originals:rebuilt.data.originals,placements:rebuilt.data.placements}));
    }
    console.log(JSON.stringify({backup:decodeURIComponent(backup.pathname)}));
  }
} finally { await db.destroy(); }
