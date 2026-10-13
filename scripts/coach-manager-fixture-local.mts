import '../apps/api/src/env.js';
import { createRequire } from 'node:module';
import { createDb, DEFAULT_TENANT_ID as tenantId } from '../packages/db/src/index.js';
import { profileSchema, validatePlan } from '../apps/api/src/coach/schemas.js';
const { ulid } = createRequire(new URL('../apps/api/package.json', import.meta.url))('ulid');

// Synthetic owner only. Creates a marked test draft, never payments or credentials.
const db=await createDb({connectionString:process.env.DATABASE_URL!,bypassRls:true});
try {
  const partner=await db('Partner').where({tenantId,email:'coach-smoke-20261013@example.test'}).first();
  if(!partner)throw new Error('Synthetic partner missing; refusing to use another owner.');
  const row=await db('CoachProfile').where({tenantId,partnerId:partner.id,status:'complete'}).first();
  if(!row)throw new Error('Complete the synthetic interview first.');
  const profile=profileSchema.parse(row.data);
  const grant=await db('PartnerProgram').where({tenantId,partnerId:partner.id}).orderBy('id').first();
  if(!grant)throw new Error('Synthetic partner has no assigned program.');
  const unfinished=await db('CoachTask').where({tenantId,partnerId:partner.id,programId:grant.programId}).whereNotIn('status',['completed','cancelled','skipped']).first();
  const drafts=await db('CoachPlan').where({tenantId,partnerId:partner.id,programId:grant.programId,status:'draft'});
  const existingDraft=drafts.find(plan=>plan.data?.fixture==='manager-local-20261013'&&plan.data?.profileVersion===row.version);
  if(unfinished){console.log(JSON.stringify({syntheticOnly:true,existingTaskId:unfinished.id,created:false}));}
  else if(existingDraft){console.log(JSON.stringify({syntheticOnly:true,existingPlanId:existingDraft.id,created:false}));}
  else {
    const task={title:'Тест менеджера: подготовить кружочек про сравнение договоров',format:'circle' as const,platform:'telegram',minutes:20,steps:[{title:'Выбрать один пример на вымышленных документах',minutes:5},{title:'Записать понятный кружочек с одним отличием',minutes:10},{title:'Подготовить свою ссылку и прислать текст на проверку',minutes:5}],draft:'Покажите одно различие в двух вымышленных редакциях договора. Объясните, почему это важно читателю, и предложите попробовать Syntolk по вашей собственной ссылке.',criteria:'Текст короткого кружочка, один конкретный пример, понятный призыв и собственная ссылка. Публикация проверяется отдельно по присланному URL.'};
    validatePlan([task],profile);
    const id=ulid();await db('CoachPlan').insert({id,tenantId,partnerId:partner.id,programId:grant.programId,status:'draft',weekStart:new Date().toISOString().slice(0,10),data:JSON.stringify({fixture:'manager-local-20261013',message:'Тестовый план для проверки управленческого цикла. Создан локальным тестовым сценарием, не ИИ.',plannedMinutes:20,profileVersion:row.version,tasks:[task]})});
    console.log(JSON.stringify({syntheticOnly:true,partnerId:partner.id,planId:id,profileAnswers:profile.interviewAnswers.length,created:true}));
  }
} finally {await db.destroy();}
