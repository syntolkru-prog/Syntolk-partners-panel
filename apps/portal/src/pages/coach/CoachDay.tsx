import {VisualButton} from '../../components/tremor/VisualControls.js';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, Check, ClipboardCheck, Grid2X2, Grid3X3, List, ListTodo } from 'lucide-react';
import { api, currentTenantSlug } from '../../api.js';
import { ErrorBanner } from '../../ui.js';
import { useTenantBase } from '../../tenant-base.js';
import './coach.css';
import { usePartnerSelection } from '../../lib/partner-selection.js';
import { TremorProgressBar } from '../../components/tremor/HomePrimitives.js';
import { ProgressBar } from '../../components/tremor/raw/components/ProgressBar/ProgressBar.js';

interface DayTask {status:string;data:{scheduledDay:string;title:string}}
interface DayPlan {plan:{data:{days:number;startDate:string;scenarioId?:string;scenarioName?:string}}|null;today:string;tasks:DayTask[]}
type HomeTaskView = 'row' | 'small' | 'large';

function readHomeTaskView(partnerId: string, fallback:HomeTaskView='small'): HomeTaskView {
  if (typeof window === 'undefined') return fallback;
  const value = window.localStorage.getItem(`syntolk-home-task-view:${partnerId}`);
  return value === 'row' || value === 'large' || value === 'small' ? value : fallback;
}

export function CoachDay({partnerId,appearance}:{partnerId:string;appearance?:'workspace'|'workday'}) {
  const base=useTenantBase(),key=['coach',currentTenantSlug(),partnerId,'/coach/me'];
  const me=useQuery({queryKey:[...key,'me'],queryFn:()=>api<{programs:Array<{id:string}>}>('/coach/me'),staleTime:30000});
  const selection=usePartnerSelection(partnerId,me.data?.programs??[]),programId=selection.programId;
  const requestedScenarioId=selection.scenarioId&&selection.scenarioId!=='all'?selection.scenarioId:'';
  const calendar=useQuery({queryKey:[...key,'calculator-plan',programId,requestedScenarioId||'latest'],queryFn:()=>api<DayPlan>(`/coach/me/calculator-plan?programId=${encodeURIComponent(programId)}${requestedScenarioId?`&scenarioId=${encodeURIComponent(requestedScenarioId)}`:''}`),enabled:!!programId,placeholderData:previous=>previous?.plan?.data.scenarioId===requestedScenarioId?previous:undefined,refetchInterval:30000});
  const [taskView,setTaskView]=useState<HomeTaskView>(()=>readHomeTaskView(partnerId,appearance==='workspace'?'row':'small'));
  const data=calendar.data,today=data?.tasks.filter(t=>t.data.scheduledDay===data.today)??[];
  const completed=today.filter(t=>t.status==='completed').length;

  const scenarioId=data?.plan?.data.scenarioId??'';
  const {rememberScenario,scenarioId:rememberedScenarioId}=selection;
  useEffect(()=>{if(scenarioId&&scenarioId!==rememberedScenarioId)rememberScenario(scenarioId);},[scenarioId,rememberedScenarioId,rememberScenario]);
  const scenarioName=data?.plan?.data.scenarioName?.trim()||'вашему сценарию';
  const query=`?programId=${encodeURIComponent(programId)}${scenarioId?`&scenarioId=${encodeURIComponent(scenarioId)}`:''}`;
  const expired=data?.plan?data.today>=new Date(Date.parse(data.plan.data.startDate)+data.plan.data.days*86400000).toISOString().slice(0,10):false;
  const next=data?.tasks.filter(t=>t.data.scheduledDay>=data.today&&t.status!=='completed').sort((a,b)=>a.data.scheduledDay.localeCompare(b.data.scheduledDay))[0];
  const displayDay=today.length?data?.today:next?.data.scheduledDay;
  const dayTasks=data?.tasks.filter(task=>task.data.scheduledDay===displayDay)??[];
  const dayCompleted=dayTasks.filter(task=>task.status==='completed').length;
  const dayLabel=displayDay?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(displayDay)):'';
  const taskViewOptions=[
    {value:'row' as const,label:'Список',icon:<List size={17} strokeWidth={2}/>},
    {value:'small' as const,label:'Маленькие квадраты',icon:<Grid3X3 size={17} strokeWidth={2}/>},
    {value:'large' as const,label:'Большие квадраты',icon:<Grid2X2 size={17} strokeWidth={2}/>},
  ];
  if(appearance==='workday')return <section className="wd-day" aria-label="План из калькулятора">
    <ErrorBanner error={me.error??calendar.error}/>
    {me.isLoading||calendar.isLoading?<p className="wd-empty" role="status">Загружаем ваш календарь…</p>:!data?.plan||expired?<div className="wd-day-empty"><span className="wd-day-symbol"><ClipboardCheck size={36}/></span><div><h2>{expired?'Сценарий завершён':'С чего начнём?'}</h2><p>{expired?'Выберите новый срок в калькуляторе и сохраните сценарий.':'Создайте ссылку на публикацию или составьте сценарий работ с задачами в календаре.'}</p><div><Link className="wd-link-button" to={`${base}/calculator${query}`}>{expired?'Продолжить сценарий':'Создать сценарий'} <ArrowUpRight size={13}/></Link>{!expired&&<Link className="wd-link-button" to={`${base}/links?section=create&view=publications&create=publication`}>Создать ссылку на публикацию <ArrowUpRight size={13}/></Link>}</div></div></div>:<>
      <div className="wd-day-summary"><div className="wd-day-summary-heading"><span className="wd-day-symbol"><ClipboardCheck size={36}/></span><div><h2>{today.length?'Результаты работы на сегодня':displayDay?`Ближайшие задачи · ${dayLabel}`:'План работ'}</h2><p>{today.length?<>Выполнено задач: <strong>{dayCompleted} из {dayTasks.length}</strong></>:displayDay?'На сегодня задач нет.':'Все задачи сценария отмечены выполненными.'}</p></div>{today.length>0&&<span className="wd-day-percent"><strong>{Math.round(dayCompleted/dayTasks.length*100)}%</strong> выполнено</span>}</div>
        {today.length>0&&<ProgressBar className="wd-segmented" variant="success" value={dayCompleted} max={dayTasks.length} showAnimation={false} aria-label="Выполнение плана калькулятора"/>}
      </div>
      <div className="wd-day-tasks"><div className="wd-day-tasks-heading"><h2><span className="wd-icon"><ListTodo size={18}/></span>{today.length?'Задачи на сегодня':'Ближайшие задачи'}</h2><strong>{dayCompleted} из {dayTasks.length}</strong></div>
        <div className="wd-task-list">{dayTasks.map((task,index)=><Link key={`${task.data.scheduledDay}:${task.data.title}`} className={`wd-task${task.status==='completed'?' is-completed':''}`} to={`${base}/plan${query}&day=${encodeURIComponent(task.data.scheduledDay)}`} aria-label={`${task.data.title}, задача ${index+1}`}><span className="wd-task-number">{String(index+1).padStart(2,'0')}</span><span className="wd-task-check">{task.status==='completed'&&<Check size={12}/>}</span><span className="wd-task-title">{task.data.title}</span><ArrowUpRight size={14}/></Link>)}</div>
      </div>
    </>}
  </section>;
  if(appearance==='workspace')return <section className="ph-plan" aria-label="План из калькулятора">
    <ErrorBanner error={me.error??calendar.error}/>
    {me.isLoading||calendar.isLoading?<div className="ph-plan__empty" role="status"><CalendarDays size={25} aria-hidden="true"/><h2>Ваш план</h2><p>Загружаем ваш календарь…</p></div>
      :!data?.plan?<div className="ph-plan__empty"><CalendarDays size={25} strokeWidth={1.5} aria-hidden="true"/><h2>С чего начнём?</h2><p>Создайте ссылку на публикацию или составьте сценарий работ с задачами в календаре.</p><div className="ph-plan__empty-links"><Link to={`${base}/calculator${query}`}>Создать сценарий <ArrowUpRight size={14} aria-hidden="true"/></Link><Link to={`${base}/links?section=create&view=publications&create=publication`}>Создать ссылку на публикацию <ArrowUpRight size={14} aria-hidden="true"/></Link><Link to={`${base}/links${query}`}>Открыть ссылки <ArrowUpRight size={14} aria-hidden="true"/></Link></div></div>
      :expired?<div className="ph-plan__empty"><CalendarDays size={25} strokeWidth={1.5} aria-hidden="true"/><h2>Сценарий завершён</h2><p>Выберите новый срок в калькуляторе и сохраните сценарий.</p><div className="ph-plan__empty-links"><Link to={`${base}/calculator${query}`}>Продолжить сценарий <ArrowUpRight size={14} aria-hidden="true"/></Link></div></div>
      :<>
        <div className="ph-plan__top">
          <div className="ph-plan__heading"><h2>{today.length?'Задачи на сегодня':displayDay?`Ближайшие задачи · ${dayLabel}`:'План работ'}</h2>
            {dayTasks.length>0&&<div className="ph-plan__view" role="group" aria-label="Вид задач на главной">{taskViewOptions.map(({value,label,icon})=><VisualButton key={value} type="button" aria-label={label} title={label} aria-pressed={taskView===value} onClick={()=>{setTaskView(value);window.localStorage.setItem(`syntolk-home-task-view:${partnerId}`,value);}}>{icon}</VisualButton>)}</div>}
          </div>
          <p className="ph-plan__scenario">Сценарий «{scenarioName}»</p>
          {today.length>0?<><div className="ph-plan__progress"><span>{dayCompleted===dayTasks.length?'Всё на сегодня выполнено':'Выполнение плана'}</span><strong>{dayCompleted} из {dayTasks.length}</strong></div><TremorProgressBar value={dayCompleted} max={dayTasks.length} aria-label="Выполнение плана калькулятора"/></>
            :<p className="ph-plan__notice">{displayDay?'На сегодня задач нет.':'Все задачи сценария отмечены выполненными.'}</p>}
        </div>
        {dayTasks.length>0&&<div className={`ph-task-list ph-task-list--${taskView}`} aria-label={today.length?'Задачи на сегодня':`Задачи на ${dayLabel}`}>
          {dayTasks.map((task,index)=><Link key={`${task.data.scheduledDay}:${task.data.title}`} className={`ph-task${task.status==='completed'?' is-completed':''}`} to={`${base}/plan${query}&day=${encodeURIComponent(task.data.scheduledDay)}`} aria-label={`${task.data.title}, задача ${index+1}`}>
            <span className="ph-task__status" aria-hidden="true">{task.status==='completed'?<Check size={14}/>:String(index+1).padStart(2,'0')}</span>
            <span className="ph-task__title">{task.data.title}</span><ArrowUpRight className="ph-task__arrow" size={14} aria-hidden="true"/>
          </Link>)}
        </div>}
        <nav className="ph-plan__footer" aria-label="Навигация по сценарию"><Link to={`${base}/plan${query}`}>Работа на неделю</Link><Link to={`${base}/plan${query}&period=month`}>Работа на месяц</Link><Link to={`${base}/results${query}`}>Мои результаты</Link><Link to={`${base}/calculator${query}`}>Изменить сценарий</Link></nav>
      </>}
  </section>;
  return <section className="coach coach-home-summary" aria-label="План из калькулятора" style={{marginBottom:20}}><ErrorBanner error={me.error??calendar.error}/>
    {me.isLoading||calendar.isLoading?<p>Загружаем ваш календарь…</p>:!data?.plan?<><h2>Ссылки и план публикаций</h2><p className="coach-muted">Создайте партнёрскую ссылку для своих материалов. Если нужен прогноз дохода и задачи в календаре — составьте сценарий в калькуляторе.</p><div className="coach-actions"><Link className="coach-summary-link" to={`${base}/links${query}`}>Открыть ссылки →</Link><Link className="coach-summary-link" to={`${base}/calculator${query}`}>Рассчитать доход и составить план →</Link></div></>:expired?<><h2>Срок вашего сценария завершён</h2><p>Продолжите работу: выберите новый срок в калькуляторе и сохраните сценарий.</p><Link className="coach-summary-link" to={`${base}/calculator${query}`}>Продолжить сценарий →</Link></>:<>
      <div className="coach-row coach-home-summary__header">
        <h2>{today.length?`Сегодня по сценарию «${scenarioName}»`:`Сценарий «${scenarioName}»`}</h2>
        {dayTasks.length>0&&<div className="coach-home-task-view" role="group" aria-label="Вид задач на главной">
          {taskViewOptions.map(({value,label,icon})=><VisualButton key={value} type="button" className={taskView===value?'is-selected':''} aria-label={label} title={label} aria-pressed={taskView===value} onClick={()=>{setTaskView(value);window.localStorage.setItem(`syntolk-home-task-view:${partnerId}`,value);}}>{icon}</VisualButton>)}
        </div>}
      </div>
      <div className="coach-home-summary__day">
        <div>
          <h3>{today.length?'Задачи на сегодня':displayDay?`Задачи на ${dayLabel}`:'Задачи на день'}</h3>
          <p className="coach-muted">{today.length?`${completed} из ${today.length} задач выполнено`:displayDay?'На сегодня задач нет.':'Все задачи сценария отмечены выполненными.'}</p>
        </div>
      </div>
      {today.length>0&&<div className="coach-day__track" role="progressbar" aria-label="Выполнение плана калькулятора" aria-valuemin={0} aria-valuemax={dayTasks.length} aria-valuenow={dayCompleted}><span style={{width:`${dayCompleted/dayTasks.length*100}%`}}/></div>}
      {dayTasks.length>0&&<div className={`coach-home-tasks coach-home-tasks--${taskView}`} aria-label={today.length?"Задачи на сегодня":`Задачи на ${dayLabel}`}>{dayTasks.map((task,index)=><Link key={`${task.data.scheduledDay}:${task.data.title}`} className={`coach-home-task-card${task.status==='completed'?' is-completed':''}`} to={`${base}/plan${query}&day=${encodeURIComponent(task.data.scheduledDay)}`} aria-label={`${task.data.title}, задача ${index+1}`}><div className="coach-home-task-card__top"><span className="coach-home-task-card__status" aria-hidden="true">{task.status==='completed'?'✓':'○'}</span><span>Задача {index+1}</span></div><strong>{task.data.title}</strong></Link>)}</div>}
      <div className="coach-home-links"><Link to={`${base}/plan${query}`}>Работа на неделю</Link><Link to={`${base}/plan${query}&period=month`}>Работа на месяц</Link><Link to={`${base}/results${query}`}>Мои результаты</Link><Link to={`${base}/calculator${query}`}>Изменить сценарий</Link></div>
    </>}
  </section>;
}
