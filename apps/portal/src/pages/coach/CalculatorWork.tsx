import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, currentTenantSlug } from '../../api.js';
import { Page, Card, Button, ErrorBanner } from '../../ui.js';
import { useTenantBase } from '../../tenant-base.js';
import './coach.css';
import './calculator-work.css';
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
const shortDate=(day:string)=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));
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

  const data=query.data;
  const selectedScenarioId=data?.plan?.data.scenarioId||requestedScenarioId||scenarios[0]?.id||'';
  const selectedScenarioName=data?.plan?.data.scenarioName||scenarios.find(s=>s.id===selectedScenarioId)?.name||'Сценарий';
  const selectedDay=view==='today'?data?.today:params.get('day');
  const weeks=data?.plan?Array.from({length:Math.ceil(data.plan.data.days/7)},(_,i)=>addDays(data.plan!.data.startDate,i*7)):[];
  const currentWeek=weeks.filter(day=>day<=(selectedDay??data?.today??'')).at(-1)??weeks[0];
  const week=weeks.includes(params.get('week')??'')?params.get('week')!:currentWeek;
  const allPeriod=params.get('period')==='all';
  const monthPeriod=params.get('period')==='month';
  const allDays=data?.plan?Array.from({length:data.plan.data.days},(_,i)=>addDays(data.plan.data.startDate,i)):[];
  const months=[...new Set(allDays.map(day=>day.slice(0,7)))];
  const currentMonth=(selectedDay??data?.today??'').slice(0,7);
  const selectedMonth=months.includes(params.get('month')??'')?params.get('month')!:months.includes(currentMonth)?currentMonth:months[0];
  const days=view==='calendar'?(monthPeriod?allDays.filter(day=>day.startsWith(selectedMonth??'')):!allPeriod&&week?allDays.filter(day=>day>=week&&day<addDays(week,7)):allDays):[...new Set(data?.tasks?.map(t=>t.data.scheduledDay)??[])].sort();
  const tasks=data?.tasks?.filter(t=>selectedDay?t.data.scheduledDay===selectedDay:view==='calendar'?days.includes(t.data.scheduledDay):true)??[];
  const completed=tasks.filter(t=>t.status==='completed').length;
  const allTasks=data?.tasks??[];
  const planCompleted=allTasks.filter(t=>t.status==='completed').length;
  const overviewTotal=view==='today'?tasks.length:allTasks.length;
  const overviewCompleted=view==='today'?completed:planCompleted;
  const progress=overviewTotal?Math.round((overviewCompleted/overviewTotal)*100):0;
  const trackerSegments=24;
  const filledSegments=Math.round((progress/100)*trackerSegments);

  const {rememberScenario,scenarioId:rememberedScenarioId}=selection;
  useEffect(()=>{if(selectedScenarioId&&selectedScenarioId!==rememberedScenarioId)rememberScenario(selectedScenarioId);},[selectedScenarioId,rememberedScenarioId,rememberScenario]);
  const scenarioQuery=selectedScenarioId?`&scenarioId=${encodeURIComponent(selectedScenarioId)}`:'';
  const calculatorHref=prefix.startsWith('/admin/')?`${base}/admin/calculator?partnerId=${encodeURIComponent(partnerId)}&programId=${programId}${scenarioQuery}`:`${base}/calculator?programId=${programId}${scenarioQuery}`;
  const planHref=prefix.startsWith('/admin/')?`${base}/admin/coach?tab=partners&partnerId=${encodeURIComponent(partnerId)}&programId=${programId}${scenarioQuery}`:`${base}/plan?programId=${programId}${scenarioQuery}`;
  const complete=async(task:WorkTask,value:boolean)=>{setBusy(true);setError(null);try{await api(`${prefix}/calculator-plan/tasks/${task.id}/complete`,{method:'POST',body:{version:task.version,completed:value}});await cache.invalidateQueries({queryKey:key});}catch(e){setError(e as Error);}finally{setBusy(false);}};

  const scenarioPicker=!!programId&&scenarios.length>0?<div className="work-calendar-scenario"><label><span>Сценарий</span><select aria-label="Сценарий календаря" value={selectedScenarioId} onChange={e=>selection.selectScenario(e.target.value)}>{scenarios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><Button variant="secondary" size="sm" onClick={()=>nav(calculatorHref)}>Открыть в калькуляторе</Button></div>:null;

  const content=<div className="coach work-calendar"><ErrorBanner error={error??me.error??query.error}/>{scenarioPicker}
    {query.isLoading||me.isLoading||snapshots.isLoading?<Card>Загружаем сценарий…</Card>:!programId?<Card>Администратору нужно назначить партнёрскую программу.</Card>:!data?.plan?<Card><h2>{scenarios.length?'У этого сценария пока нет календаря':'Начните с калькулятора'}</h2><p>{scenarios.length?'Выберите другой сценарий или откройте этот сценарий в калькуляторе и сохраните его календарь.':'Выберите форматы, количество материалов в неделю и площадки. Затем сохраните сценарий и создайте из него календарь публикаций.'}</p><Button onClick={()=>nav(calculatorHref)}>Открыть калькулятор</Button></Card>:<>
      <section className="work-calendar-overview" aria-label="Сводка плана публикаций">
        <div className="work-calendar-overview__top">
          <div>
            <p className="work-calendar-eyebrow">{view==='today'?'Работа на сегодня':'План публикаций'}</p>
            <h2>{selectedScenarioName}</h2>
            <p className="work-calendar-muted">{view==='today'?dateLabel(data.today):`${data.plan.data.days} дней · ${data.plan.data.originals} материалов · ${data.plan.data.placements} размещений`}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={()=>nav(calculatorHref)}>Изменить сценарий</Button>
        </div>

        {view==='calendar'&&<div className="work-calendar-metrics">
          <div className="work-calendar-metric"><span>Длительность</span><strong>{data.plan.data.days} дней</strong></div>
          <div className="work-calendar-metric"><span>Материалы</span><strong>{data.plan.data.originals}</strong></div>
          <div className="work-calendar-metric"><span>Размещения</span><strong>{data.plan.data.placements}</strong></div>
        </div>}

        <div className="work-calendar-progress__header">
          <strong>{overviewCompleted} из {overviewTotal} {view==='today'?'задач':'материалов'} подготовлено</strong>
          <span>{progress}%</span>
        </div>
        <div className="work-calendar-tracker" role="progressbar" aria-label="Выполнение плана" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          {Array.from({length:trackerSegments},(_,index)=><span key={index} className={index<filledSegments?'is-filled':''}/>) }
        </div>
        {view==='today'&&<div className="work-calendar-inline-actions"><Button variant="secondary" size="sm" onClick={()=>nav(planHref)}>Весь календарь</Button><Button variant="ghost" size="sm" onClick={()=>nav(`${base}/results?programId=${programId}${scenarioQuery}&period=today`)}>Результаты за сегодня</Button></div>}
      </section>

      {view==='calendar'&&<>
        <div className="work-calendar-toolbar">
          <div className="work-calendar-segmented" role="group" aria-label="Период календаря">
            <button className={!allPeriod&&!monthPeriod?'is-active':''} onClick={()=>nav(planHref)}>Неделя</button>
            <button className={monthPeriod?'is-active':''} onClick={()=>nav(`${planHref}&period=month`)}>Месяц</button>
            <button className={allPeriod?'is-active':''} onClick={()=>nav(`${planHref}&period=all`)}>Весь период</button>
          </div>
          {monthPeriod?<label className="work-calendar-compact-select"><span>Месяц</span><select aria-label="Месяц плана" value={selectedMonth??''} onChange={e=>nav(`${planHref}&period=month&month=${e.target.value}`)}>{months.map(month=><option key={month} value={month}>{new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`))}</option>)}</select></label>:!allPeriod?<label className="work-calendar-compact-select"><span>Неделя</span><select aria-label="Неделя календаря" value={week??''} onChange={e=>nav(`${planHref}&week=${e.target.value}`)}>{weeks.map(day=><option key={day} value={day}>{dateLabel(day)} — {dateLabel(addDays(day,Math.min(6,data.plan!.data.days-1-Math.round((Date.parse(day)-Date.parse(data.plan!.data.startDate))/86400000))))}</option>)}</select></label>:null}
        </div>

        {monthPeriod||allPeriod?<label className="work-calendar-period-day"><span>День работы</span><select aria-label="День работы" value={selectedDay??''} onChange={e=>nav(`${planHref}&period=${monthPeriod?'month':'all'}${monthPeriod?`&month=${selectedMonth}`:''}${e.target.value?`&day=${e.target.value}`:''}`)}><option value="">Все дни периода</option>{days.filter(day=>data.tasks.some(t=>t.data.scheduledDay===day)).map(day=><option key={day} value={day}>{dateLabel(day)}</option>)}</select></label>:<nav className="work-calendar-days" aria-label="Дни календаря"><button className={!selectedDay?'is-active':''} onClick={()=>nav(`${planHref}&week=${week}`)}>Вся неделя</button>{days.map(day=><button key={day} className={selectedDay===day?'is-active':''} onClick={()=>nav(`${planHref}&week=${week}&day=${day}`)}>{dateLabel(day)}</button>)}</nav>}
      </>}

      {!tasks.length&&<Card>На этот день публикации по сценарию не запланированы. Весь объём виден в календаре.</Card>}
      <div className="work-calendar-list">
        {days.filter(day=>tasks.some(t=>t.data.scheduledDay===day)).map(day=>{
          const dayTasks=tasks.filter(task=>task.data.scheduledDay===day);
          return <section key={day} className="work-calendar-day">{view==='calendar'&&<div className="work-calendar-day__heading"><h3>{dateLabel(day)}</h3><span>{dayTasks.length} {dayTasks.length===1?'задача':dayTasks.length<5?'задачи':'задач'}</span></div>}
            <div className="work-calendar-day__tasks">{dayTasks.map(task=>{
              const selectedPlacements=(task.data.placements??[]).filter(resource=>resource.selected);
              const visiblePlacements=selectedPlacements.slice(0,5);
              const extraPlacements=Math.max(0,selectedPlacements.length-visiblePlacements.length);
              const isCompleted=task.status==='completed';
              return <article key={task.id} className={`work-calendar-task${isCompleted?' is-completed':''}`}>
                <div className="work-calendar-task__row">
                  <label className="work-calendar-task__check"><input type="checkbox" aria-label={`Материал готов: ${task.data.title}`} checked={isCompleted} disabled={busy} onChange={e=>{void complete(task,e.target.checked);}}/><span aria-hidden="true" className="work-calendar-task__box"/></label>
                  <div className="work-calendar-task__body"><strong>{task.data.title}</strong>{selectedPlacements.length>0&&<div className="work-calendar-chips">{visiblePlacements.map(resource=><span key={resource.id}>{resource.name}</span>)}{extraPlacements>0&&<span>+{extraPlacements}</span>}</div>}</div>
                  <time className="work-calendar-task__date" dateTime={task.data.scheduledDay}>{shortDate(task.data.scheduledDay)}</time>
                </div>
                <details className="work-calendar-task__details" onToggle={e=>{const open=e.currentTarget.open;setOpenTasks(previous=>{const next=new Set(previous);if(open)next.add(task.id);else next.delete(task.id);return next;});}}><summary>Публикации{selectedPlacements.length?` (${selectedPlacements.length})`:''}</summary>{openTasks.has(task.id)&&task.data.kind==='content'&&<div className="work-calendar-task__editor"><MaterialEditor partnerId={partnerId} materialId={task.data.materialId??task.id}/></div>}</details>
              </article>;
            })}</div>
          </section>;
        })}
      </div>
    </>}
  </div>;
  return embedded||view==='today'?content:<Page title="План публикаций">{content}</Page>;
}
