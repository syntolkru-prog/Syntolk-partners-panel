import '../apps/api/src/env.js';
import {fileURLToPath} from 'node:url';
import {createDb} from '../packages/db/src/index.js';
import {assertIsolatedCoachDatabase} from '../apps/api/src/coach/test-guard.js';
const working=process.env.DATABASE_URL!;
const target=new URL(working);
if(!['localhost','127.0.0.1','::1'].includes(target.hostname))throw new Error('Only a local database is allowed.');
if(process.argv.includes('--test')){target.pathname='/syntolk_coach_test_20261012';assertIsolatedCoachDatabase(target.toString(),working);}
const db=await createDb({connectionString:target.toString(),bypassRls:true});
const name=process.argv.includes('--remove-reminders')?'20261025020000_remove_calendar_reminders.ts':process.argv.includes('--workflow')?'20261025010000_calendar_workflow.ts':'20261023010000_calendar_material_ready.ts';
const options={directory:fileURLToPath(new URL('../packages/db/migrations/',import.meta.url)),loadExtensions:['.ts'],disableMigrationsListValidation:true};
try{
  const [completed,pending]=await db.migrate.list(options);
  console.log(JSON.stringify({database:target.pathname.slice(1),ready:completed.some((entry:{name:string})=>entry.name===name),pending:pending.map((entry:{file:string})=>entry.file)}));
  if(process.argv.includes('--apply')&&!completed.some((entry:{name:string})=>entry.name===name)){
    const result=await db.migrate.up({...options,name});
    console.log(JSON.stringify({applied:result[1]}));
  }
}finally{await db.destroy();}
