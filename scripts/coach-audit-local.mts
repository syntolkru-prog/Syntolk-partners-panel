import '../apps/api/src/env.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createDb,DEFAULT_TENANT_ID} from '../packages/db/src/index.js';
const backup=JSON.parse(await readFile('work/coach-baseline-20261012-verified/core-before-coach.json','utf8'));
const db=await createDb({connectionString:process.env.DATABASE_URL!,bypassRls:true});
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
const digest=(rows:Array<{id?:string}>)=>createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify([...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)))))))).digest('hex');
try{
  const tables=[];for(const table of ['Event','Commission','Payout','CommissionAdjustment']){const now=await db(table).where({tenantId:DEFAULT_TENANT_ID}).select('*');const equal=digest(now)===digest(backup.tables[table]??[]);tables.push({table,rows:now.length,unchanged:equal});if(!equal)process.exitCode=1;}
  const clicks=await db('Click as c').join('Link as l','l.id','c.linkId').where({'c.tenantId':DEFAULT_TENANT_ID}).where('l.linkKey','like','st-%').count({count:'*'}).first();
  console.log(JSON.stringify({financialBaseline:tables,browserClicksOnCoachLinks:Number(clicks?.count??0)},null,2));
}finally{await db.destroy();}
