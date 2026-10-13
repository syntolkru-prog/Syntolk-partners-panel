import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, currentTenantSlug } from '../../api.js';
import { Button, Card, ErrorBanner, Input, Select, Textarea } from '../../ui.js';

export interface ManagementPolicy { style:'supportive'|'demanding'|'strict'; deadlineHours:number; maxReschedules:number; escalationHours:number; requireReason:boolean; requirePublicationUrl:boolean; reviewSlaHours:number; preventPlanReplacement:boolean }
export const defaultManagement:ManagementPolicy={style:'strict',deadlineHours:24,maxReschedules:2,escalationHours:48,requireReason:true,requirePublicationUrl:false,reviewSlaHours:24,preventPlanReplacement:true};
export interface InterviewQuestion {id:string;question:string;required:boolean}
export interface InterviewAnswer {id:string;question:string;answer:string}
export const defaultQuestions:InterviewQuestion[]=[
  {id:'motivation',question:'Зачем вам партнёрство с Syntolk? Какой доход хотите получать и что он изменит для вас?',required:true},
  {id:'content',question:'Какой контент вам нравится делать: кружочки, короткие или длинные видео, посты? Расскажите своими словами и приведите пример.',required:true},
  {id:'schedule',question:'Как часто вы готовы снимать или писать? В какие дни и сколько времени реально готовы выделять?',required:true},
  {id:'audience',question:'Кому вы хотите рассказывать о Syntolk? Где уже есть аудитория и какие её задачи вы понимаете?',required:true},
  {id:'obstacles',question:'Что может помешать вам доводить публикации до конца? Какая помощь и какой стиль контроля вам подходят?',required:true},
];

export function ManagementFields({value,onChange,disabled=false}:{value:ManagementPolicy;onChange:(value:ManagementPolicy)=>void;disabled?:boolean}) {
  const number=(field:'deadlineHours'|'maxReschedules'|'escalationHours'|'reviewSlaHours',label:string,min:number,max:number)=><label className="coach-field"><span>{label}</span><Input type="number" min={min} max={max} value={value[field]} disabled={disabled} onChange={e=>onChange({...value,[field]:Number(e.target.value)})}/></label>;
  return <fieldset disabled={disabled} className="coach-channel"><legend>Управление работой и контроль результата</legend>
    <label className="coach-field"><span>Требовательность куратора</span><Select value={value.style} onChange={e=>onChange({...value,style:e.target.value as ManagementPolicy['style']})}><option value="supportive">Поддерживающий</option><option value="demanding">Требовательный менеджер</option><option value="strict">Строгий деловой контроль</option></Select></label>
    <div className="coach-grid">{number('deadlineHours','Первый срок задания, часов',1,168)}{number('maxReschedules','Переносов без согласования менеджером',0,10)}{number('escalationHours','Передавать менеджеру после просрочки, часов',1,168)}{number('reviewSlaHours','Срок проверки менеджером, часов',1,168)}</div>
    <p><label><input type="checkbox" checked={value.requireReason} onChange={e=>onChange({...value,requireReason:e.target.checked})}/> Требовать причину переноса и отказа от задания</label></p>
    <p><label><input type="checkbox" checked={value.preventPlanReplacement} onChange={e=>onChange({...value,preventPlanReplacement:e.target.checked})}/> Не заменять незавершённую работу новым планом</label></p>
    <p><label><input type="checkbox" checked={value.requirePublicationUrl} onChange={e=>onChange({...value,requirePublicationUrl:e.target.checked})}/> Требовать URL публикации при отправке результата</label></p>
    <p className="coach-muted">Строгость влияет на требования и разбор невыполнения. Просрочки видны в разделе «Контроль работы»; ежедневные обращения включаются в настройках конкретного партнёра. Контроль не подтверждает продажу и не меняет деньги.</p>
  </fieldset>;
}

export function CoachInterview({questions,answers,onChange}:{questions:InterviewQuestion[];answers:InterviewAnswer[];onChange:(answers:InterviewAnswer[])=>void}) {
  const [index,setIndex]=useState(0),[review,setReview]=useState(false);
  const question=questions[Math.min(index,questions.length-1)];
  if(!question)return null;
  const answered=questions.filter(q=>answers.some(a=>a.id===q.id&&a.answer.trim())).length;
  const answer=(q:InterviewQuestion)=>answers.find(a=>a.id===q.id)?.answer??'';
  const field=(q:InterviewQuestion)=><label key={q.id} className="coach-field"><span>{q.question}{q.required?' *':''}</span><Textarea rows={4} maxLength={3000} value={answer(q)} placeholder="Расскажите своими словами — здесь нет правильного варианта из списка" onChange={e=>onChange([...answers.filter(a=>a.id!==q.id),{...q,answer:e.target.value}].map(({id,question,answer})=>({id,question,answer})))}/></label>;
  return <section className="coach-channel" aria-label="Интервью с партнёром"><h3>Сначала познакомимся — вашими словами</h3><p>Это основа работы вашего менеджера: что вы любите делать, ваш ритм и где нужна помощь. Ответы сохраняются в анкете и доступны куратору.</p><p className="coach-muted">Ответов: {answered} из {questions.length}. * — обязательный вопрос. Точные минуты и дни укажите ниже; если ответы расходятся, куратор уточнит расписание.</p>
    {review?questions.map(field):field(question)}
    <div className="coach-actions">{!review&&<><Button variant="secondary" disabled={index===0} onClick={()=>setIndex(i=>i-1)}>Предыдущий вопрос</Button><Button disabled={question.required&&!answer(question).trim()} onClick={()=>index<questions.length-1?setIndex(i=>i+1):setReview(true)}>{index<questions.length-1?'Следующий вопрос':'Перейти к расписанию'}</Button></>}<Button variant="ghost" onClick={()=>setReview(v=>!v)}>{review?'Отвечать по одному':'Все вопросы и ответы'}</Button></div>
  </section>;
}

interface ControlTask {id:string;title:string;status:string;dueAt:string|null;overdue:boolean;overdueHours:number;reschedules:number;needsManager:boolean;reasons:string[];lastCheckIn:{at:string;state:string;text:string}|null}
interface Management {counts:{open:number;overdue:number;waitingReview:number;completed:number;needsManager:number};nextTask:ControlTask|null;policy:ManagementPolicy;tasks:ControlTask[];completedPeriodDays?:number}
const date=(value:string|null)=>value?new Date(value).toLocaleString('ru-RU'):'Не назначен';

export function PartnerManagement({prefix,partnerId,programId,onAsk}:{prefix:string;partnerId:string;programId:string;onAsk:(text:string)=>void}) {
  const query=useQuery({queryKey:['coach-management',currentTenantSlug(),partnerId,programId],queryFn:()=>api<Management>(`${prefix}/management?programId=${encodeURIComponent(programId)}`),enabled:!!programId,refetchInterval:30000,refetchIntervalInBackground:false});
  const data=query.data;
  return <Card><h2>Доводим работу до результата</h2><ErrorBanner error={query.error}/>{data?.counts?<>
    <p>В работе: {data.counts.open} · Просрочено: {data.counts.overdue} · Ожидает проверки: {data.counts.waitingReview} · Подтверждено за 30 дней: {data.counts.completed}</p>
    {data.nextTask?<><strong>{data.nextTask.title}</strong><p className={data.nextTask.overdue?'coach-warning':'coach-muted'}>Срок: {date(data.nextTask.dueAt)}{data.nextTask.overdue?` · просрочка ${data.nextTask.overdueHours} ч`:''} · Переносов: {data.nextTask.reschedules}</p>
      {data.nextTask.lastCheckIn&&<p className="coach-pre">Последний отчёт: {data.nextTask.lastCheckIn.text}</p>}
      {data.nextTask.needsManager&&<p className="coach-warning">Нужна помощь менеджера: {data.nextTask.reasons.join('; ')}.</p>}
      <Button variant="secondary" onClick={()=>onAsk(`Помоги довести до результата задание «${data.nextTask!.title}». Прочитай его срок, критерии, последний отчёт и препятствия в get_management. Дай один конкретный следующий шаг и готовый материал; не создавай новый план вместо текущей работы.`)}>Помоги закончить эту работу</Button></>:<p>Незавершённых заданий нет.{data.counts.waitingReview?' Материалы на проверке — менеджер должен дать обратную связь.':' Подготовьте и примите первый план ниже.'}</p>}
  </>:<p className="coach-muted">{query.isLoading?'Загружаем договорённости…':'Выберите программу для контроля заданий.'}</p>}</Card>;
}

export function AdminManagement({onSelect}:{onSelect:(partnerId:string)=>void}) {
  const query=useQuery({queryKey:['coach-control',currentTenantSlug()],queryFn:()=>api<{items:(Management&{partnerId:string;name:string;profileComplete:boolean})[];limit:number}>('/admin/coach/control'),refetchInterval:30000,refetchIntervalInBackground:false});
  return <Card><div className="coach-row"><div><h2>Контроль работы партнёров</h2><p className="coach-muted">Сначала — проблемы, требующие менеджера. Данные обновляются каждые 30 секунд. Показаны до {query.data?.limit??200} последних действующих партнёров.</p></div><Button variant="secondary" disabled={query.isFetching} onClick={()=>{void query.refetch();}}>Обновить контроль</Button></div><ErrorBanner error={query.error}/>
    {query.isLoading&&<p>Загружаем контроль…</p>}{query.data?.items?.map(item=><article className="coach-channel" key={item.partnerId}><div className="coach-row"><strong>{item.name}</strong><Button variant="secondary" onClick={()=>onSelect(item.partnerId)}>Открыть сопровождение</Button></div><p>В работе: {item.counts.open} · Просрочки: {item.counts.overdue} · Проверки: {item.counts.waitingReview}</p>{!item.profileComplete&&<p className="coach-warning">Знакомство не завершено.</p>}{item.tasks.filter(t=>t.needsManager).map(t=><p className="coach-warning" key={t.id}>{t.title}: {t.reasons.join('; ')}</p>)}{item.nextTask&&<p className="coach-muted">Ближайшая работа: {item.nextTask.title} · {date(item.nextTask.dueAt)}</p>}</article>)}
    {query.data?.items?.length===0&&<p>Партнёров пока нет.</p>}
  </Card>;
}

export function TaskFollowThrough({task,busy,action,policy=defaultManagement}:{task:{status:string;dueAt:string;data:Record<string,unknown>};busy:boolean;action:(action:string,extra?:Record<string,unknown>)=>Promise<unknown>;policy?:ManagementPolicy}) {
  const [note,setNote]=useState(''),[state,setState]=useState('progress'),[reason,setReason]=useState(''),[operation,setOperation]=useState<'reschedule'|'skip'|null>(null);
  const [due,setDue]=useState(()=>{const date=new Date(Date.now()+86400000);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);});
  const editable=['planned','in_progress','changes_requested'].includes(task.status);
  const history=(task.data.checkIns??[]) as {at:string;state:string;text:string}[];
  const reschedules=(task.data.rescheduleHistory??[]) as {at:string;reason:string;from:string|null;to:string}[];
  const overdue=editable&&new Date(task.dueAt).getTime()<Date.now();
  return <section aria-label="Контроль задания"><p className={overdue?'coach-warning':'coach-muted'}>Срок задания: {date(task.dueAt)}{overdue?' · срок прошёл — нужен следующий шаг':''} · Переносов: {reschedules.length}</p>
    {editable&&<><label className="coach-field"><span>Отчёт о ходе работы</span><Textarea value={note} maxLength={3000} rows={3} placeholder="Что уже сделали? Если застряли — на каком конкретно шаге?" disabled={busy} onChange={e=>setNote(e.target.value)}/></label><label className="coach-field"><span>Состояние работы</span><Select value={state} disabled={busy} onChange={e=>setState(e.target.value)}><option value="progress">Продвигаюсь, фиксирую сделанное</option><option value="blocked">Застрял — нужна помощь</option></Select></label><Button variant="secondary" disabled={busy||!note.trim()} onClick={()=>{void action('check-in',{state,text:note}).then(ok=>{if(ok)setNote('');});}}>Сохранить отчёт о ходе работы</Button><p className="coach-muted">Отчёт попадёт в контекст куратора и контроль менеджера. Это не отметка о завершении. Чтобы получить разбор сейчас, перейдите в чат.</p>
      <div className="coach-actions"><Button variant="ghost" disabled={busy} onClick={()=>setOperation('reschedule')}>Согласовать новый срок</Button><Button variant="ghost" disabled={busy} onClick={()=>setOperation('skip')}>Отказаться от задания с причиной</Button></div>
      {operation&&<div className="coach-channel"><label className="coach-field"><span>Причина {operation==='reschedule'?'переноса':'отказа'}</span><Textarea rows={2} maxLength={1000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>{operation==='reschedule'&&<><label className="coach-field"><span>Новый срок (по времени браузера)</span><Input type="datetime-local" value={due} disabled={busy} onChange={e=>setDue(e.target.value)}/></label><p className="coach-muted">Без согласования с менеджером: до {policy.maxReschedules} переносов. После лимита новый срок меняет администратор.</p></>}
        <div className="coach-actions"><Button disabled={busy||(policy.requireReason&&!reason.trim())||(operation==='reschedule'&&(!due||!Number.isFinite(Date.parse(due))))} onClick={()=>{void action(operation,{reason,...(operation==='reschedule'?{dueAt:new Date(due).toISOString()}:{} )}).then(ok=>{if(ok){setOperation(null);setReason('');}});}}>Подтвердить {operation==='reschedule'?'перенос':'отказ'}</Button><Button variant="secondary" disabled={busy} onClick={()=>setOperation(null)}>Не менять задание</Button></div></div>}
    </>}
    {!!history.length&&<details><summary>Отчёты о ходе работы ({history.length})</summary>{history.map((entry,i)=><p className="coach-pre" key={i}>{date(entry.at)} · {entry.state==='blocked'?'Нужна помощь':'Прогресс'}: {entry.text}</p>)}</details>}
    {!!reschedules.length&&<details><summary>История переносов ({reschedules.length})</summary>{reschedules.map((entry,i)=><p key={i}>{date(entry.at)} → {date(entry.to)}: {entry.reason||'Без причины'}</p>)}</details>}
  </section>;
}
