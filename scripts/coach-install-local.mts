import '../apps/api/src/env.js';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDb, DEFAULT_TENANT_ID } from '../packages/db/src/index.js';
const url=new URL(process.env.DATABASE_URL!);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/openpartner')throw new Error('This helper only installs into the named local working database.');
const backup=resolve('work/coach-baseline-20261012-verified/core-before-coach.json');await access(backup);
const saved=JSON.parse(await readFile(backup,'utf8'));if(!Object.values(saved.tables as Record<string,unknown[]>).some(rows=>rows.length))throw new Error('Backup must contain real core rows.');
const db=await createDb({connectionString:url.toString(),bypassRls:true});
try{
  for(const name of ['20261012000000_partner_coach.ts','20261012001000_coach_owner_constraints.ts']){
    if(!await db('knex_migrations').where({name}).first())await db.migrate.up({name,directory:resolve('packages/db/migrations'),loadExtensions:['.ts'],disableMigrationsListValidation:true});
  }
  const old=await db('Config').where({tenantId:DEFAULT_TENANT_ID,key:'coach_settings'}).first();
  if(!old)await db('Config').insert({tenantId:DEFAULT_TENANT_ID,key:'coach_settings',value:JSON.stringify({enabled:true,provider:'template',dailyRuns:20,takeover:[]})});
  console.log(JSON.stringify({installed:true,backupVerified:true,financialRowsModified:false,mode:'template'}));
}finally{await db.destroy();}
