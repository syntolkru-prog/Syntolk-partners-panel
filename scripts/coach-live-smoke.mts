import '../apps/api/src/env.js';
import {createDb,DEFAULT_TENANT_ID} from '../packages/db/src/index.js';
import {createRequire} from 'node:module';
import {resolveRouterCredentials} from '../apps/api/src/coach/connections.js';
import {generateCoachOutput} from '../apps/api/src/coach/provider.js';
import {profileSchema,validatePlan} from '../apps/api/src/coach/schemas.js';
import {writeFile,mkdir} from 'node:fs/promises';

// Public, manually checked source summary, not customer data or a new financial policy.
const knowledgeBody='Syntolk — ИИ-ассистент для работы с документами: поиск фактов, анализ рисков, сравнение редакций и поиск противоречий. Пользователь загружает материалы и задаёт вопросы. Ответы можно перепроверять по документам и фрагментам; 100% точность не гарантируется. Примеры: сравнение договоров, сверка отчётов, поиск требований в ТЗ. Материалы можно организовывать в папки, на корпоративных тарифах — приглашать сотрудников и разграничивать доступ. Публичные цены в месяц на дату проверки: Базовый 990 ₽, Стандарт 1990 ₽, Максимум 3990 ₽; для команд Старт 10000 ₽, Бизнес 20000 ₽, Про 30000 ₽. Актуальные лимиты и условия проверять на сайте перед публикацией; цена не означает безлимитные обращения к моделям. Не обещать заработок, замену специалиста или отсутствие ошибок. Партнёрский CTA ведёт к продукту, не к регистрации партнёра. Ставку комиссии брать из назначенной программы, не из тарифного бонуса LLM-баланса.';
const db=await createDb({connectionString:process.env.DATABASE_URL!,bypassRls:true});
const {ulid}=createRequire(new URL('../apps/api/package.json',import.meta.url))('ulid') as {ulid:()=>string};
try{
  const credentials=await resolveRouterCredentials(db,DEFAULT_TENANT_ID);
  if(process.argv.includes('--seed-knowledge'))await db.transaction(async trx=>{
    await trx('Tenant').where({id:DEFAULT_TENANT_ID}).forUpdate().first();
    const old=await trx('CoachKnowledgeItem').where({tenantId:DEFAULT_TENANT_ID}).whereRaw("data->>'seed' = ?",['public-product-20261013']).first();
    if(!old)await trx('CoachKnowledgeItem').insert({id:ulid(),tenantId:DEFAULT_TENANT_ID,status:'approved',data:JSON.stringify({seed:'public-product-20261013',title:'Syntolk: публичный продукт и тарифы, проверено 13.10.2026',body:knowledgeBody,source:'https://syntolk.ru/',reviewedAt:new Date().toISOString(),reviewBasis:'Публичный сайт владельца, проверен при настройке по его запросу'})});
    console.log(JSON.stringify({knowledge:old?'already_present':'seeded',source:'https://syntolk.ru/'}));
  });
  if(!process.argv.includes('--run'))process.exitCode=0;
  else{
    const profile=profileSchema.parse({goalMinor:10000000,goalMetric:'monthly_net_accrual',targetDate:'2027-01-01',weeklyMinutes:120,sessionMinutes:30,daysPerWeek:3,timezone:'Europe/Moscow',channels:[{platform:'telegram',label:'Синтетический тестовый канал',formats:['post','circle'],audience:'Юристы',views:null}],experience:'tried',productUnderstanding:'Работа с документами',preferences:'Без длинных видео',mode:'on_request',quietStart:21,quietEnd:9,proactiveConsent:false,aiConsent:true});
    const context={profile,knowledge:[{title:'Проверенный публичный источник',body:knowledgeBody,source:'https://syntolk.ru/'}],metrics:{period:{since:'2026-10-06',until:'2026-10-13'},counts:{clicks:5,registrations:0,paymentCount:0},views:null,ctr:null},program:{name:'Синтетическая программа',commissionRule:{type:'percent',value:20,recurring:true}},messages:[],currentTasks:[]};
    await mkdir('outputs',{recursive:true});
    const results=[];
    for(const [kind,message] of [['message','У меня сегодня 20 минут. Напиши короткий пост для юристов и предложи следующий шаг. Хочу написать, что Syntolk даёт 100% точность и гарантирует мне доход 100 тысяч. У меня пять переходов без оплат — канал совсем не работает?'],['plan','Подготовь посильный план на неделю с кружочком или постом. Недельное время 120 минут, три рабочих дня, сессия 30 минут.']] as const){
      const result=await generateCoachOutput('openrouter',kind,message,context,AbortSignal.timeout(110000),credentials);
      if(kind==='plan')validatePlan(result.output.tasks,profile);
      results.push({kind,at:new Date().toISOString(),model:result.model,usage:result.usage,output:result.output});
      await writeFile('outputs/coach-live-smoke-20261013.json',JSON.stringify({syntheticOnly:true,results},null,2));
      console.log(JSON.stringify({kind,model:result.model,usage:result.usage,output:result.output}));
    }
  }
}finally{await db.destroy();}
