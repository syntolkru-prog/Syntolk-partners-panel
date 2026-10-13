import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, currentTenantSlug } from '../../api.js';
import { Card, ErrorBanner } from '../../ui.js';
import { useTenantBase } from '../../tenant-base.js';
import './coach.css';

interface DayTask {status:string;data:{scheduledDay:string;estimatedMinutes:number;title:string}}
interface DayPlan {plan:{data:{days:number;startDate:string;scenarioId?:string;scenarioName?:string}}|null;today:string;tasks:DayTask[]}
export function CoachDay({partnerId}:{partnerId:string}) {
  const base=useTenantBase(),key=['coach',currentTenantSlug(),partnerId,'/coach/me'];
  const me=useQuery({queryKey:[...key,'me'],queryFn:()=>api<{programs:Array<{id:string}>}>('/coach/me'),staleTime:30000});
  const programId=me.data?.programs[0]?.id??'';
  const calendar=useQuery({queryKey:[...key,'calculator-plan',programId],queryFn:()=>api<DayPlan>(`/coach/me/calculator-plan?programId=${encodeURIComponent(programId)}`),enabled:!!programId,refetchInterval:30000});
  const data=calendar.data,today=data?.tasks.filter(t=>t.data.scheduledDay===data.today)??[];
  const completed=today.filter(t=>t.status==='completed').length;
  const minutes=Math.round(today.reduce((sum,t)=>sum+Number(t.data.estimatedMinutes||0),0));
  const scenarioId=data?.plan?.data.scenarioId??'';
  const scenarioName=data?.plan?.data.scenarioName?.trim()||'вашему сценарию';
  const query=`?programId=${encodeURIComponent(programId)}${scenarioId?`&scenarioId=${encodeURIComponent(scenarioId)}`:''}`;
  const expired=data?.plan?data.today>=new Date(Date.parse(data.plan.data.startDate)+data.plan.data.days*86400000).toISOString().slice(0,10):false;
  const next=data?.tasks.filter(t=>t.data.scheduledDay>=data.today&&t.status!=='completed').sort((a,b)=>a.data.scheduledDay.localeCompare(b.data.scheduledDay))[0];
  return <section className="coach coach-home-summary" aria-label="План из калькулятора" style={{marginBottom:20}}><ErrorBanner error={me.error??calendar.error}/><Card>
    {me.isLoading||calendar.isLoading?<p>Загружаем ваш календарь…</p>:!data?.plan?<><h2>Сначала создайте свой сценарий</h2><p>В калькуляторе выберите контент, площадки, доступное время и срок. Сохраните — появятся ваши работы на день и неделю.</p><Link className="coach-summary-link" to={`${base}/calculator${query}`}>Настроить сценарий в калькуляторе →</Link></>:expired?<><h2>Срок вашего сценария завершён</h2><p>Продолжите работу: выберите новый срок в калькуляторе и сохраните сценарий.</p><Link className="coach-summary-link" to={`${base}/calculator${query}`}>Продолжить сценарий →</Link></>:<>
      <div className="coach-row"><div><h2>{today.length?`Сегодня по сценарию «${scenarioName}»`:`Сценарий «${scenarioName}»`}</h2><p className="coach-muted">{today.length?`${completed} из ${today.length} задач выполнено · ${minutes} мин.`:next?`Ближайшая работа — ${new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(next.data.scheduledDay))}.`:'Все задачи сценария отмечены выполненными.'}</p></div><Link className="coach-summary-link" to={today.length?`${base}/plan${query}&day=${data.today}`:next?`${base}/plan${query}&day=${next.data.scheduledDay}`:`${base}/calculator${query}`}>{today.length?'Открыть задачи дня →':next?'Открыть ближайшие задачи →':'Настроить следующий сценарий →'}</Link></div>
      {today.length>0&&<div className="coach-day__track" role="progressbar" aria-label="Выполнение плана калькулятора" aria-valuemin={0} aria-valuemax={today.length} aria-valuenow={completed}><span style={{width:`${completed/today.length*100}%`}}/></div>}
      {today.length>0&&<ul className="coach-home-tasks" aria-label="Задачи на сегодня">{today.map(task=><li key={`${task.data.scheduledDay}:${task.data.title}`} className={task.status==='completed'?'is-completed':''}><span aria-hidden="true">{task.status==='completed'?'✓':'○'}</span><div><strong>{task.data.title}</strong><small>{Math.round(Number(task.data.estimatedMinutes||0))} мин.</small></div></li>)}</ul>}
      <div className="coach-home-links"><Link to={`${base}/plan${query}`}>Работа на неделю</Link><Link to={`${base}/plan${query}&period=month`}>Работа на месяц</Link><Link to={`${base}/results${query}`}>Мои результаты</Link><Link to={`${base}/calculator${query}`}>Изменить сценарий</Link></div>
    </>}
  </Card></section>;
}
