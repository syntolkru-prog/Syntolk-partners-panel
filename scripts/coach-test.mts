import '../apps/api/src/env.js';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { assertIsolatedCoachDatabase } from '../apps/api/src/coach/test-guard.js';
import {createDb,COACH_TABLES} from '../packages/db/src/index.js';
const working = process.env.DATABASE_URL;
if (!working) throw new Error('Working DB URL is needed for identity guard.');
const test = new URL(working);
test.pathname = '/syntolk_coach_test_20261012';
assertIsolatedCoachDatabase(test.toString(), working);
const args=process.argv.slice(2),legacy=args[0]==='--legacy';
if(legacy){args.shift();const cleanup=await createDb({connectionString:test.toString(),bypassRls:true});try{for(const table of ['PublicationJob','PartnerMaterialFile','PublisherAccount','PartnerMaterial',...[...COACH_TABLES].reverse()])await cleanup(table).del();await cleanup('Click').update({trackingSourceId:null});await cleanup('PartnerLinkSource').del();await cleanup('ApiKey').del();}finally{await cleanup.destroy();}}
const child = spawn(process.execPath, [resolve('apps/api/node_modules/vitest/vitest.mjs'), 'run', '--config', legacy?'vitest.config.ts':'vitest.coach.config.ts', ...args], {
  cwd: resolve('apps/api'), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: test.toString(), DATABASE_URL_APP: test.toString(), COACH_WORKING_DB: working, ADMIN_API_KEY: 'coach-isolated-test-admin', OPENPARTNER_MODE: 'selfhost', OPENPARTNER_TENANCY: 'single', OPENPARTNER_ENABLE_SCHEDULER: '0', COACH_SCHEDULER_ENABLED: '0', OPENAI_API_KEY: '', COACH_MODEL_ID: '', OPENROUTER_API_KEY: '', OPENROUTER_MODEL_ID: '', INTEGRATION: 'run' },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', error => { console.error(error.message); process.exitCode=1; });
