import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, currentTenantSlug } from '../../api.js';
import { Page, Card, Button, ErrorBanner } from '../../ui.js';
import { useTenantBase } from '../../tenant-base.js';
import './coach.css';
import { PartnerAnalyticsPanel, PartnerResults } from '../PartnerAnalytics.js';
import { usePartnerSelection } from '../../lib/partner-selection.js';
import { MaterialEditor } from '../MaterialEditor.js';

interface WorkResource {id:string;name:string;url:string;note:string;selected:boolean;expectedViews:number;expectedClicks:number}
interface WorkLink {url:string;linkKey:string;label:string|null;channel:string|null;channelName:string;channelUrl:string;expectedViews:number;expectedClicks:number}
interface WorkTask { id: string; status: string; version: number; link: string | null; links?:WorkLink[]; data: { title: string; materialId?:string; scheduledDay: string; kind: string; format:string; note: string; estimatedViews?:number;estimatedClicks?:number;placements?:WorkResource[];suggestedResources?:WorkResource[] } }
interface WorkPlan { plan: { id: string; version: number; data: { startDate: string; days: number; originals: number; placements: number; snapshotId: string; scenarioId?: string; scenarioName?: string } } | null; snapshot: { id: string; createdAt: string } | null; today: string; tasks: WorkTask[] }
interface ScenarioSnapshot { id:string; data:{scenarioId?:string;scenarioName?:string}; createdAt:string }
interface WorkMe { enabled: boolean; programs: Array<{id:string;name:string}>; profile: {status:string}|null }
const dateLabel=(day:string)=>new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));
const addDays=(day:string,offset:number)=>new Date(Date.parse(`${day}T12:00:00Z`)+offset*86400000).toISOString().slice(0,10);

export function CalculatorWork(props:{partnerId:string;prefix?:string;view?:'calendar'|'today'|'results';embedded?:boolean}) {
  if(props.view==='results')return props.embedded?<PartnerAnalyticsPanel partnerId={props.partnerId}/>:<PartnerResults partnerId={props.partnerId}/>;
  return <WorkCalendar {...props} view={props.view??'calendar'}/>;
}
function WorkCalendar({partnerId,prefix='/coach/me',view='calendar',embedded=false}:{partnerId:string;prefix?:string;view?:'calendar'|'today';embedded?:boolean}) {
  const cache=useQueryClient(),nav=useNavigate(),base=useTenantBase(),[params]=useSearchParams();
  const tenant=currentTenantSlug(),key=useMemo(()=>['coach',tenant,partnerId,prefix],[tenant,partnerId,prefix]);
  const me=useQuery({queryKey:[...key,'me'],queryFn:()=>api<WorkMe>(prefix),staleTime:30000});
  const selection=usePartnerSelection(partnerId,me.data?.programs??[]),programId=selection.programId;
  const snapshots=useQuery({queryKey:[...key,'snapshots',programId],queryFn:()=>api<{snapshots:ScenarioSnapshot[]}>(`${prefix}/forecast-snapshots?programId=${encodeURIComponent(programId)}`),enabled:!!programId,staleTime:30000});
  const scenarios=useMemo(()=>{const grouped=new Map<string,{id:string;name:string}>();for(const snapshot of snapshots.data?.snapshots??[]){const id=snapshot.data.scenarioId??snapshot.id;if(!grouped.has(id))grouped.set(id,{id,name:snapshot.data.scenarioName?.trim()||`Сценарий ${grouped.size+1}`});}return [...grouped.values()];},[snapshots.data]);
  const requestedScenarioId=['all','new'].includes(selection.scenarioId)?'':selection.scenarioId;
  const query=useQuery({queryKey:[...key,'calculator-plan',programId,requestedScenarioId||'latest'],queryFn:()=>api<WorkPlan>(`${prefix}/calculator-plan?programId=${encodeURIComponent(programId)}${requestedScenarioId?`&scenarioId=${encodeURIComponent(requestedScenarioId)}`:''}`),enabled:!!programId,placeholderData:previous=>previous?.plan?.data.scenarioId===requestedScenarioId?previous:undefined,refetchInterval:30000});
  const [busy,setBusy]=useState(false),[error,setError]=useState<Error|null>(null);
  const [openTasks,setOpenTasks]=useState<Set<string>>(()=>new Set());
  const data=query.data,selectedScenarioId=data?.plan?.data.scenarioId||requestedScenarioId||scenarios[0]?.id||'',selectedScenarioName=data?.plan?.data.scenarioName||scenarios.find(s=>s.id===selectedScenarioId)?.name||'Сценарий',selectedDay=view==='today'?data?.today:params.get('day');
  const weeks=data?.plan?Array.from({length:Math.ceil(data.plan.data.days/7)},(_,i)=>addDays(data.plan!.data.startDate,i*7)):[];
  const currentWeek=weeks.filter(day=>day<=(selectedDay??data?.today??'')).at(-1)??weeks[0];
  const week=weeks.includes(params.get('week')??'')?params.get('week')!:currentWeek;
  const allPeriod=params.get('period')==='all';
  const monthPeriod=params.get('period')==='month';
  const allDays=data?.plan?Array.from({length:data.plan.data.days},(_,i)=>addDays(data.plan!.data.startDate,i)):[];
  const months=[...new Set(allDays.map(day=>day.slice(0,7)))];
  const selectedMonth=months.includes(params.get('month')??'')?params.get('month')!:months.includes((selectedDay??data?.today??'').slice(0,7))?(selectedDay??data!.today).slice(0,7):months[0];
  const days=view==='calendar'?(monthPeriod?allDays.filter(day=>day.startsWith(selectedMonth??'')):!allPeriod&&week?allDays.filter(day=>day>=week&&day<addDays(week,7)):allDays):[...new Set(data?.tasks?.map(t=>t.data.scheduledDay)??[])].sort();
  const tasks=data?.tasks?.filter(t=>selectedDay?t.data.scheduledDay===selectedDay:view==='calendar'?days.includes(t.data.scheduledDay):true)??[];
  const completed=tasks.filter(t=>t.status==='completed').length;

  const dayViews=Math.round(tasks.reduce((sum,task)=>sum+(Number(task.data.estimatedViews)||0),0));
  const {rememberScenario,scenarioId:rememberedScenarioId}=selection;
  useEffect(()=>{if(selectedScenarioId&&selectedScenarioId!==rememberedScenarioId)rememberScenario(selectedScenarioId);},[selectedScenarioId,rememberedScenarioId,rememberScenario]);
  const scenarioQuery=selectedScenarioId?`&scenarioId=${encodeURIComponent(selectedScenarioId)}`:'';
  const calculatorHref=prefix.startsWith('/admin/')?`${base}/admin/calculator?partnerId=${encodeURIComponent(partnerId)}&programId=${programId}${scenarioQuery}`:`${base}/calculator?programId=${programId}${scenarioQuery}`;
  const planHref=prefix.startsWith('/admin/')?`${base}/admin/coach?tab=partners&partnerId=${encodeURIComponent(partnerId)}&programId=${programId}${scenarioQuery}`:`${base}/plan?programId=${programId}${scenarioQuery}`;
  const complete=async(task:WorkTask,value:boolean)=>{setBusy(true);setError(null);try{await api(`${prefix}/calculator-plan/tasks/${task.id}/complete`,{method:'POST',body:{version:task.version,completed:value}});await cache.invalidateQueries({queryKey:key});}catch(e){setError(e as Error);}finally{setBusy(false);}};
  const scenarioPicker=!!programId&&scenarios.length>0?<div className="calculator-work-scenario-picker"><label className="coach-field"><span>Сценарий календаря</span><select aria-label="Сценарий календаря" value={selectedScenarioId} onChange={e=>selection.selectScenario(e.target.value)}>{scenarios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><Button variant="secondary" onClick={()=>nav(calculatorHref)}>Открыть в калькуляторе</Button></div>:null;
  const content=<div className="coach"><ErrorBanner error={error??me.error??query.error}/>{scenarioPicker}
    {query.isLoading||me.isLoading||snapshots.isLoading?<Card>Загружаем сценарий…</Card>:!programId?<Card>Администратору нужно назначить партнёрскую программу.</Card>:!data?.plan?<Card><h2>{scenarios.length?'У этого сценария пока нет календаря':'Начните с калькулятора'}</h2><p>{scenarios.length?'Выберите другой сценарий или откройте этот сценарий в калькуляторе и сохраните его календарь.':'Выберите форматы, количество материалов в неделю и площадки. Затем сохраните сценарий и создайте из него календарь публикаций.'}</p><Button onClick={()=>nav(calculatorHref)}>Открыть калькулятор</Button></Card>:<>
      <Card><div className="coach-row"><div><h2>{view==='today'?'Работа на сегодня':'План публикаций'}</h2><p className="coach-muted">Сценарий «{selectedScenarioName}»: {data.plan.data.days} дней · {data.plan.data.originals} материалов · {data.plan.data.placements} размещений</p></div><Button variant="secondary" onClick={()=>nav(calculatorHref)}>Изменить сценарий</Button></div>
        <p>{completed} из {tasks.length} материалов {selectedDay?'за выбранный день':'плана'} подготовлено</p>
        {dayViews>0&&<p className="coach-plan-summary">По вашим значениям калькулятора: около <strong>{dayViews.toLocaleString('ru-RU')} просмотров</strong></p>}
        <div className="coach-day__track" role="progressbar" aria-label="Выполнение плана калькулятора" aria-valuemin={0} aria-valuemax={tasks.length||1} aria-valuenow={completed}><span style={{width:`${tasks.length?completed/tasks.length*100:0}%`}}/></div>
        {view==='today'&&<div className="coach-actions"><Button variant="secondary" onClick={()=>nav(planHref)}>Весь календарь</Button><Button variant="ghost" onClick={()=>nav(`${base}/results?programId=${programId}${scenarioQuery}&period=today`)}>Результаты за сегодня</Button></div>}
      </Card>
      {<>
        {view==='calendar'&&<><div className="coach-actions"><Button variant={!allPeriod&&!monthPeriod?'primary':'secondary'} onClick={()=>nav(planHref)}>Неделя</Button><Button variant={monthPeriod?'primary':'secondary'} onClick={()=>nav(`${planHref}&period=month`)}>Месяц</Button><Button variant={allPeriod?'primary':'secondary'} onClick={()=>nav(`${planHref}&period=all`)}>Весь период</Button></div><div className="coach-actions calculator-week-picker">{monthPeriod?<label>Месяц <select aria-label="Месяц плана" value={selectedMonth??''} onChange={e=>nav(`${planHref}&period=month&month=${e.target.value}`)}>{months.map(month=><option key={month} value={month}>{new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`))}</option>)}</select></label>:!allPeriod?<label>Неделя <select aria-label="Неделя календаря" value={week??''} onChange={e=>nav(`${planHref}&week=${e.target.value}`)}>{weeks.map(day=><option key={day} value={day}>{dateLabel(day)} — {dateLabel(addDays(day,Math.min(6,data.plan!.data.days-1-Math.round((Date.parse(day)-Date.parse(data.plan!.data.startDate))/86400000))))}</option>)}</select></label>:null}</div>{monthPeriod||allPeriod?<label className="coach-field"><span>День работы</span><select aria-label="День работы" value={selectedDay??''} onChange={e=>nav(`${planHref}&period=${monthPeriod?'month':'all'}${monthPeriod?`&month=${selectedMonth}`:''}${e.target.value?`&day=${e.target.value}`:''}`)}><option value="">Все дни периода</option>{days.filter(day=>data.tasks.some(t=>t.data.scheduledDay===day)).map(day=><option key={day} value={day}>{dateLabel(day)}</option>)}</select></label>:<nav className="coach-actions" aria-label="Дни календаря"><Button variant={selectedDay?'secondary':'primary'} onClick={()=>nav(`${planHref}&week=${week}`)}>Вся неделя</Button>{days.map(day=><Button key={day} variant={selectedDay===day?'primary':'secondary'} onClick={()=>nav(`${planHref}&week=${week}&day=${day}`)}>{dateLabel(day)}</Button>)}</nav>}</>}
        {!tasks.length&&<Card>На этот день публикации по сценарию не запланированы. Весь объём виден в календаре.</Card>}
        {days.filter(day=>tasks.some(t=>t.data.scheduledDay===day)).map(day=><section key={day} className="calculator-work-day">{view==='calendar'&&<h3>{dateLabel(day)}</h3>}{tasks.filter(task=>task.data.scheduledDay===day).map(task=>{const selectedPlacements=(task.data.placements??[]).filter(resource=>resource.selected);return <div key={task.id} className="calculator-work-task calculator-work-task--guided"><div className="coach-row"><label className="calculator-work-check"><input type="checkbox" aria-label={`Материал готов: ${task.data.title}`} checked={task.status==='completed'} disabled={busy} onChange={e=>{void complete(task,e.target.checked);}}/><span><strong>{task.data.title}</strong><small>{selectedPlacements.map(l=>l.name).join(', ')}</small></span></label></div>
          <details className="calculator-task-details" onToggle={e=>{const open=e.currentTarget.open;setOpenTasks(previous=>{const next=new Set(previous);if(open)next.add(task.id);else next.delete(task.id);return next;});}}><summary>Публикации</summary>
          {openTasks.has(task.id)&&task.data.kind==='content'&&<MaterialEditor partnerId={partnerId} materialId={task.data.materialId??task.id}/>}
          </details>
        </div>;})}</section>)}
      </>}
    </>}
  </div>;
  return embedded||view==='today'?content:<Page title={'Календарь работ'}>{content}</Page>;
}

