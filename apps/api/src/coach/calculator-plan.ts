import type { Knex } from 'knex';
import { ulid } from 'ulid';
import { CoachError, profileSchema } from './schemas.js';
import { calculateCoachForecast } from './forecast-adapter.js';
import { localDay } from './daily-plan.js';
import { calendarMaterialTitle, materialFormats } from '../materials-service.js';

export const CALCULATOR_PLAN_SOURCE = 'calculator_schedule_v1';
type SnapshotRow = { id: string; data: Record<string, any>; createdAt: Date | string };

/** A scenario is a stable user-facing container; snapshots are its revisions. */
export function scenarioIdForSnapshot(snapshot: SnapshotRow) {
  return String(snapshot.data?.scenarioId ?? snapshot.id);
}
export function scenarioNameForSnapshot(snapshot: SnapshotRow, fallback = 'Сценарий') {
  const name = typeof snapshot.data?.scenarioName === 'string' ? snapshot.data.scenarioName.trim() : '';
  return name || fallback;
}

async function latestScenarioSnapshot(db: Knex, tenantId: string, partnerId: string, programId: string, scenarioId?: string) {
  return db('CoachForecastSnapshot').where({ tenantId, partnerId, programId, status: 'confirmed' }).modify(q => {
    if (scenarioId) q.andWhereRaw("(data->>'scenarioId' = ? OR (data->>'scenarioId' IS NULL AND id = ?))", [scenarioId, scenarioId]);
  }).orderBy('createdAt', 'desc').first() as Promise<SnapshotRow | undefined>;
}
/** Old clients cannot bring the discarded AI-generated planner back. */
export async function assertLegacyPlannerAvailable(db:Knex,tenantId:string,partnerId:string) {
  const migrated=await db('Config').where({tenantId,key:'coach_calculator_workflow_migration_v1'}).first();
  const usedCalculator=await db('CoachPlan').where({tenantId,partnerId}).whereRaw("data->>'source' = ?",[CALCULATOR_PLAN_SOURCE]).first();
  if(migrated||usedCalculator)throw new CoachError('calculator_workflow',410,'План теперь создаётся только из калькулятора. Откройте «Калькулятор» и выберите «Создать календарь».');
}
const addDays = (day: string, offset: number) => new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
export interface CalendarTask {
  key: string; day: string; title: string; format: string; platform: string;
  kind: 'content'; contentKey: string; note: string;
  placements: CalendarPlacement[]; suggestedResources: CalendarResource[];
  estimatedViews: number; estimatedClicks: number;
}
export interface CalendarResource {
  id:string; name:string; url:string; note:string; selected:boolean; expectedViews:number; expectedClicks:number;
}
export interface CalendarPlacement extends CalendarResource { selected:true }

/** Quantities, formats and channels from the calculator, distributed over selected days. */
export async function calculatorSchedule(settings: Record<string, unknown>, startDate: string, days: number, weekdays: number[]) {
  if(!Number.isInteger(days)||days<1||days>365||!weekdays.length||weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)||!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!Number.isFinite(Date.parse(startDate))||new Date(startDate).toISOString().slice(0,10)!==startDate)throw new CoachError('calendar_date',422,'Выберите дату начала, период от 1 до 365 дней и рабочие дни.');
  const forecast = await calculateCoachForecast(settings);
  const config = forecast.settings;
  if (forecast.workload.originals <= 0 || config.stopAfter === 0) throw new CoachError('calculator_empty', 422, 'В калькуляторе не выбран выпуск контента. Укажите количество материалов.');
  if(forecast.workload.unplaced.length){
    const names=forecast.formats.filter((format:{id:string})=>forecast.workload.unplaced.includes(format.id)).map((format:{name:string})=>format.name).join(', ');
    throw new CoachError('calculator_unplaced',422,`Не выбраны площадки для: ${names}. Выберите их во вкладке «Площадки».`);
  }
  const tasks: CalendarTask[] = [];
  const publicationEnd=new Date(`${startDate}T12:00:00Z`);
  const originalDay=publicationEnd.getUTCDate();
  publicationEnd.setUTCDate(1);publicationEnd.setUTCMonth(publicationEnd.getUTCMonth()+config.stopAfter);
  const monthLastDay=new Date(Date.UTC(publicationEnd.getUTCFullYear(),publicationEnd.getUTCMonth()+1,0)).getUTCDate();
  publicationEnd.setUTCDate(Math.min(originalDay,monthLastDay));
  const publicationDays=Math.min(days,Math.round((publicationEnd.getTime()-Date.parse(`${startDate}T12:00:00Z`))/86400000));
  const loads = new Map<string,number>();
  const pickDay=(dates:string[],targetIndex=0)=>{
    const day=[...dates].sort((a,b)=>(loads.get(a)??0)-(loads.get(b)??0)||Math.abs(dates.indexOf(a)-targetIndex)-Math.abs(dates.indexOf(b)-targetIndex)||a.localeCompare(b))[0]!;
    loads.set(day,(loads.get(day)??0)+1);return day;
  };
  for (let week = 0; week < Math.ceil(days / 7); week++) {
    const dates = Array.from({ length: Math.min(7, days - week * 7) }, (_, i) => addDays(startDate, week * 7 + i))
      .filter(day => weekdays.includes(new Date(`${day}T12:00:00Z`).getUTCDay()));
    if (!dates.length) continue;
    const span=Math.max(0,Math.min(7,publicationDays-week*7));
    const counts=Object.fromEntries(forecast.formats.map((format:{id:string})=>[format.id,Math.floor((week+span/7)*config.frequency[format.id]+1e-8)-Math.floor(week*config.frequency[format.id]+1e-8)]));
    const weekOriginals=Object.values(counts).reduce((sum,value)=>sum+Number(value),0);
    if(tasks.length+weekOriginals>2000)throw new CoachError('calendar_too_large',422,'Получилось больше 2000 задач. Сократите объём контента или срок плана.');
    let ordinal=0;
    for (const format of forecast.formats as Array<{ id: string; name: string }>) {
      // Fractions accumulate: 0.25/week produces one original in week four.
      const count = Number(counts[format.id]);
      for (let index = 0; index < count; index++) {
        const compatible=(forecast.channels as Array<{id:string;name:string;url?:string;note?:string;formats:string[]}>).filter(channel=>channel.formats.includes(format.id));
        const resources:CalendarResource[]=compatible.map(channel=>{
          const selected=config.channels[channel.id].enabled&&config.channels[channel.id].formats.includes(format.id);
          const expectedViews=Number(config.channels[channel.id].views)||0;
          const expectedClicks=expectedViews*(Number(config.channels[channel.id].ctr)||0)/100;
          return {id:channel.id,name:channel.name,url:channel.url??'',note:channel.note??'',selected,expectedViews,expectedClicks};
        });
        const placements=resources.filter((resource):resource is CalendarPlacement=>resource.selected) as CalendarPlacement[];
        const targetIndex=weekOriginals>1?Math.round(ordinal*(dates.length-1)/(weekOriginals-1)):0;
        ordinal++;
        const publicationDates=dates.filter(day=>day<publicationEnd.toISOString().slice(0,10));
        if(!publicationDates.length)continue;
        const day=pickDay(publicationDates,Math.min(targetIndex,publicationDates.length-1));
        const contentKey = `${week}:${format.id}:${index}`;
        const estimatedViews=placements.reduce((sum,item)=>sum+item.expectedViews,0);
        const estimatedClicks=placements.reduce((sum,item)=>sum+item.expectedClicks,0);
        const dayOrdinal=tasks.filter(task=>task.day===day&&task.format===format.id).length+1;
        tasks.push({key:`${day}:${contentKey}`,day,contentKey,kind:'content',format:format.id,platform:placements[0]?.id??'preparation',
          title:calendarMaterialTitle(format.id,format.name,day,dayOrdinal),
          note:'',
          placements,suggestedResources:resources,estimatedViews,estimatedClicks});
      }
    }
  }
  if (!tasks.length) throw new CoachError('no_calendar_work', 422, 'На выбранные дни не приходится работа. Выберите другой период или рабочие дни.');
  if (tasks.length > 2000) throw new CoachError('calendar_too_large', 422, 'Получилось больше 2000 задач. Сократите объём контента или срок плана.');
  return { forecast, tasks };
}

export async function activeCalculatorPlan(db: Knex, tenantId: string, partnerId: string, programId: string, scenarioId?: string) {
  return db('CoachPlan').where({ tenantId, partnerId, programId, status: 'active' }).whereRaw("data->>'source' = ?", [CALCULATOR_PLAN_SOURCE]).modify(q => {
    if (scenarioId) q.andWhereRaw("(data->>'scenarioId' = ? OR (data->>'scenarioId' IS NULL AND data->>'snapshotId' = ?))", [scenarioId, scenarioId]);
  }).orderBy('createdAt', 'desc').first();
}

export async function createCalculatorPlan(db: Knex, tenantId: string, partnerId: string, input: {
  programId: string; snapshotId: string; scenarioId?: string; startDate: string; days: number; weekdays: number[]; requestId: string; replacePlanId?: string; replaceVersion?: number;
}) {
  await db('Partner').where({ id: partnerId, tenantId }).forUpdate().first();
  const replay = await db('CoachPlan').where({ tenantId, partnerId, programId: input.programId }).whereRaw("data->>'requestId' = ?", [input.requestId]).first();
  if (replay) {
    if (replay.data.snapshotId !== input.snapshotId || (input.scenarioId && replay.data.scenarioId !== input.scenarioId) || replay.data.startDate !== input.startDate || replay.data.days !== input.days || JSON.stringify(replay.data.weekdays) !== JSON.stringify(input.weekdays)) throw new CoachError('idempotency_conflict',409,'Этот запрос уже использован для другого календаря.');
    return replay;
  }
  const snapshot = await db('CoachForecastSnapshot').where({ tenantId, partnerId, programId: input.programId, id: input.snapshotId, status: 'confirmed' }).first();
  if (!snapshot) throw new CoachError('calculator_not_saved', 409, 'Сначала сохраните свой сценарий в калькуляторе.');
  const scenarioId = String(input.scenarioId ?? snapshot.data?.scenarioId ?? snapshot.id);
  if (input.scenarioId && input.scenarioId !== scenarioId) throw new CoachError('scenario_mismatch', 409, 'Сценарий не совпадает с сохранённым расчётом.');
  const scenarioName = scenarioNameForSnapshot(snapshot, 'Сценарий');
  const profileTimezone=(await db('CoachProfile').where({tenantId,partnerId}).first())?.data?.timezone??'Europe/Moscow';
  const today=localDay(new Date(),profileTimezone);
  if(input.startDate<today||input.startDate>addDays(today,90))throw new CoachError('calendar_date',422,'Начало календаря должно быть сегодня или в ближайшие 90 дней.');
  const existing = await activeCalculatorPlan(db, tenantId, partnerId, input.programId, scenarioId);
  if (existing && (input.replacePlanId !== existing.id || input.replaceVersion !== existing.version)) throw new CoachError('calendar_exists', 409, 'Календарь уже создан. Обновите его и явно выберите перестроение по новому сценарию.');
  const { forecast, tasks } = await calculatorSchedule(snapshot.data.settings, input.startDate, input.days, input.weekdays);
  const id = ulid(), timezone = profileTimezone;
  const data = { source: CALCULATOR_PLAN_SOURCE, schemaVersion:3, scenarioId, scenarioName, snapshotId: snapshot.id, modelHash: forecast.modelHash, requestId: input.requestId, startDate: input.startDate, days: input.days, weekdays: input.weekdays, timezone,
    originals: tasks.filter(t => t.kind === 'content').length, placements: tasks.reduce((sum,t)=>sum+t.placements.length,0),
    settings: forecast.settings };
  const oldPlans = await db('CoachPlan').where({ tenantId, partnerId, programId: input.programId }).whereIn('status', ['active','draft']).whereRaw("data->>'source' = ?", [CALCULATOR_PLAN_SOURCE]).modify(q => {
    q.andWhereRaw("(data->>'scenarioId' = ? OR (data->>'scenarioId' IS NULL AND data->>'snapshotId' = ?))", [scenarioId, scenarioId]);
  }).select('id');
  const oldIds = oldPlans.map((row: { id: string }) => row.id);
  if (oldIds.length) {
    await db('PartnerMaterial').where({tenantId,partnerId,customTitle:false}).whereIn('id',db('CoachTask').where({tenantId,partnerId}).whereIn('planId',oldIds).whereNot('status','completed').select('id'))
      .whereNotIn('id',db('PartnerLinkSource').where({tenantId,partnerId}).whereNotNull('materialId').select('materialId')).update({archivedAt:new Date()});
    await db('CoachTask').where({ tenantId, partnerId }).whereIn('planId', oldIds).whereNot('status','completed').update({ status: 'cancelled', updatedAt: new Date() });
    await db('CoachPlan').where({ tenantId, partnerId }).whereIn('id', oldIds).update({ status: 'archived', updatedAt: new Date() });
  }
  const [plan] = await db('CoachPlan').insert({ id, tenantId, partnerId, programId: input.programId, status: 'active', weekStart: input.startDate, data: JSON.stringify(data) }).returning('*');
  for (const item of tasks) {
    const taskId = ulid();
    await db('PartnerMaterial').insert({id:taskId,tenantId,partnerId,programId:input.programId,scenarioId,title:item.title,formatId:item.format,
      formatName:materialFormats.find(f=>f.id===item.format)?.name??item.title.split(' · ')[0],scheduledDay:item.day,platforms:JSON.stringify(item.placements.map(p=>({id:p.id,name:p.name}))) });
    const taskData={ ...item, materialId:taskId, source: CALCULATOR_PLAN_SOURCE, snapshotId: snapshot.id, scheduledDay: item.day, steps: [{ title: item.title }], criteria: 'Подготовить материал и отметить его публикации на выбранных площадках.', draft: '' };
    await db('CoachTask').insert({ id: taskId, tenantId, partnerId, programId: input.programId, planId: id, status: 'planned',
      dueAt: new Date(`${item.day}T18:00:00Z`), data: JSON.stringify(taskData) });
  }
  // The calculator config supplies the context; a second questionnaire is not needed.
  const oldProfile = await db('CoachProfile').where({ tenantId, partnerId }).first();
  const channels = forecast.channels.filter((channel: { id: string }) => forecast.settings.channels[channel.id].enabled&&forecast.settings.channels[channel.id].formats.length).slice(0,10).map((channel: { id: string; name: string }) => ({ platform: ['telegram','vk','youtube','blog','email'].includes(channel.id) ? channel.id : 'other', label: channel.name, formats: [...new Set((forecast.settings.channels[channel.id].formats as string[]).map(id=>forecast.formats.find((f:{id:string})=>f.id===id)?.base??id))].slice(0,5), audience: '', views: null }));
  const profile = profileSchema.parse({ goalMinor: 3000000, goalMetric: 'monthly_net_accrual', targetDate: addDays(input.startDate,90), sessionMinutes: 30, timezone, experience: 'new', mode: 'on_request', quietStart: 21, quietEnd: 9, proactiveConsent: false, ...oldProfile?.data, channels,
    weeklyMinutes: 0, daysPerWeek:input.weekdays.length,productUnderstanding:'',interviewAnswers:[],onboardingVersion:0,preferences: 'Рабочий план формируется только из сохранённого сценария калькулятора. Помогай выполнять его шаги; не придумывай альтернативные задания. Калькулятор не оценивает трудозатраты. goalMinor, weeklyMinutes и sessionMinutes — старые технические поля, не параметры партнёра; не озвучивай их.' });
  const value = { status: 'complete', version: (oldProfile?.version ?? 0) + 1, data: JSON.stringify(profile), updatedAt: new Date() };
  if (oldProfile) await db('CoachProfile').where({ id: oldProfile.id }).update(value);
  else await db('CoachProfile').insert({ id: ulid(), tenantId, partnerId, ...value });
  return plan;
}

export async function calculatorPlanView(db: Knex, tenantId: string, partnerId: string, programId: string, scenarioId?: string) {
  const plan = await activeCalculatorPlan(db, tenantId, partnerId, programId, scenarioId);
  const snapshot = plan?.data?.snapshotId
    ? await db('CoachForecastSnapshot').where({ tenantId, partnerId, programId, id: plan.data.snapshotId, status: 'confirmed' }).first()
    : await latestScenarioSnapshot(db, tenantId, partnerId, programId, scenarioId);
  if (!plan) return { plan: null, snapshot: snapshot ? { id: snapshot.id, createdAt: snapshot.createdAt } : null, tasks: [], today: localDay(new Date(), 'Europe/Moscow') };
  const tasks = await db('CoachTask').where({ tenantId, partnerId, programId, planId: plan.id }).whereNot('status','cancelled').whereRaw("COALESCE(data->>'kind', '') <> 'analytics'").orderBy('createdAt').orderBy('id');
  tasks.sort((a,b)=>String(a.data.scheduledDay??'').localeCompare(String(b.data.scheduledDay??''))||
    String(a.data.contentKey??'').localeCompare(String(b.data.contentKey??''),'en',{numeric:true})||
    Number(a.data.kind==='publish')-Number(b.data.kind==='publish')||
    String(a.data.platform??'').localeCompare(String(b.data.platform??''))||a.id.localeCompare(b.id));
  // Older saved calendars retain their history, but no longer expose duration estimates.
  const planData = { ...plan.data };
  const materials=await db('PartnerMaterial').where({tenantId,partnerId}).whereIn('id',tasks.map(task=>task.data.materialId??task.id)).select('id','title');
  delete planData.plannedMinutes;
  return { plan: { ...plan, data: planData }, snapshot: snapshot ? { id: snapshot.id, createdAt: snapshot.createdAt } : null, today: localDay(new Date(),plan.data.timezone), tasks: tasks.map(task=>{
    const value = { ...task, data: { ...task.data }, link: null, links: [] };
    const material=materials.find(m=>m.id===(task.data.materialId??task.id));
    if(material){value.data.title=material.title;value.data.materialId=material.id;}
    delete value.minutes;
    delete value.data.minutes;
    delete value.data.estimatedMinutes;
    if (Array.isArray(value.data.steps)) value.data.steps = value.data.steps.map((step: Record<string, unknown>) => {
      const data = { ...step }; delete data.minutes; return data;
    });
    return value;
  }) };
}
