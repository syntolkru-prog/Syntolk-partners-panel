import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api, currentTenantSlug, type Principal } from '../../api.js';
import { Page, Card, Button, Input, ErrorBanner } from '../../ui.js';
import './coach.css';
import { OpenRouterSettings } from './OpenRouterSettings.js';
import { CalculatorWork } from './CalculatorWork.js';
import { CoachBehaviorSettings, CoachContextInspector } from './CoachBehaviorSettings.js';
import { AdminManagement } from './CoachManagement.js';

interface Row {id:string;status:string;version:number;createdAt:string;programId?:string|null;kind?:string;data:Record<string,unknown>}
interface Task extends Row {partnerId:string;minutes:number;dueAt:string;placement:{id:string;linkKey:string}|null}
interface Overview {settings:{enabled:boolean;provider:'template'|'openai'|'openrouter';dailyRuns:number};provider:{label:string;configured:boolean};partners:Array<{id:string;name:string;email:string;revokedAt:string|null}>;runs:Row[];reviews:Task[];audit:Row[]}
const statuses:Record<string,string>={draft:'Черновик',active:'Активен',superseded:'Заменён новым планом',planned:'Запланировано',in_progress:'В работе',reviewing:'Проверяется',submitted:'Результат сохранён',needs_human:'Нужна проверка менеджера',changes_requested:'Нужны исправления',completed:'Выполнено',cancelled:'Отменено',skipped:'Пропущено',queued:'В очереди',processing:'Готовим ответ',failed:'Ошибка',disputed:'Оспорено',reviewed:'Материал разобран',sent:'Отправлено'};
const auditNames:Record<string,string>={profile_updated:'Анкета сохранена',run_queued:'Запрос поставлен в очередь',run_completed:'Запрос выполнен',run_failed:'Ошибка запроса',run_cancelled:'Запрос отменён',plan_accepted:'План принят',link_prepared:'Ссылка создана',task_start:'Задание начато',task_skip:'Задание пропущено',task_reschedule:'Задание перенесено',review_disputed:'Проверка оспорена',settings_updated:'Настройки изменены',takeover_updated:'Режим менеджера изменён',human_review:'Решение менеджера',knowledge_created:'Источник знаний добавлен'};
const text=(v:unknown)=>typeof v==='string'?v:'';
function Field({label,children}:{label:string;children:ReactNode}) {return <label className="coach-field"><span>{label}</span>{children}</label>}

export function CoachPage({principal}:{principal:Principal}) {
  const [adminParams,setAdminParams]=useSearchParams();
  const partnerId=adminParams.get('partnerId')??'', adminTab=adminParams.get('tab')||'partners';
  const selectAdmin=(tab:string,selectedPartner=partnerId)=>setAdminParams(previous=>{const next=new URLSearchParams(previous);next.set('tab',tab);if(selectedPartner)next.set('partnerId',selectedPartner);else next.delete('partnerId');next.delete('view');next.delete('taskId');return next;});
  const cache=useQueryClient();
  const [error,setError]=useState<Error|null>(null);
  const [busy,setBusy]=useState(false);
  const overview=useQuery({queryKey:['coach-admin',currentTenantSlug()],queryFn:()=>api<Overview>('/admin/coach/overview'),enabled:principal.role==='admin'});
  const knowledge=useQuery({queryKey:['coach-knowledge',currentTenantSlug()],queryFn:()=>api<{items:Row[]}>('/admin/coach/knowledge'),enabled:principal.role==='admin'&&adminTab==='knowledge'});
  const [knowledgeTitle,setKnowledgeTitle]=useState(''),[knowledgeBody,setKnowledgeBody]=useState(''),[knowledgeSource,setKnowledgeSource]=useState('https://syntolk.ru/'),[approved,setApproved]=useState(false);
  const refresh=async()=>{await Promise.all([cache.invalidateQueries({queryKey:['coach-admin']}),cache.invalidateQueries({queryKey:['coach']}),cache.invalidateQueries({queryKey:['coach-knowledge']})]);};
  const change=async(path:string,body:unknown)=>{setBusy(true);setError(null);try{await api(path,{method:'POST',body});refresh();}catch(e){setError(e as Error);}finally{setBusy(false);}};
  if(principal.role==='partner')return <Navigate to="/plan" replace />;
  return <Page title="ИИ-куратор" subtitle="Персональные планы партнёров, проверка работы и контроль сопровождения">
    <div className="coach"><ErrorBanner error={error??overview.error}/>
    {overview.data&&<Card><div className="coach-row"><div><strong>{overview.data.provider.label}</strong><p>{overview.data.settings.enabled?'Модуль включён':'Модуль отключён'} · до {overview.data.settings.dailyRuns} запросов в сутки на партнёра</p><p className="coach-muted">Настройте общий стиль общения или выберите партнёра для индивидуального сопровождения.</p></div><Button disabled={busy} onClick={()=>{setBusy(true);void api('/admin/coach/settings',{method:'PATCH',body:{enabled:!overview.data!.settings.enabled,provider:overview.data!.settings.provider,dailyRuns:overview.data!.settings.dailyRuns}}).then(refresh).catch(e=>setError(e)).finally(()=>setBusy(false));}}>{overview.data.settings.enabled?'Отключить модуль':'Включить локальный модуль'}</Button></div>
    <Field label="Режим ответов"><select value={overview.data.settings.provider} disabled={busy} onChange={e=>{setBusy(true);void api('/admin/coach/settings',{method:'PATCH',body:{enabled:overview.data!.settings.enabled,provider:e.target.value,dailyRuns:overview.data!.settings.dailyRuns}}).then(refresh).catch(e=>setError(e)).finally(()=>setBusy(false));}}><option value="template">Демонстрационный — шаблоны</option><option value="openrouter">Настоящий ИИ — OpenRouter</option><option value="openai">Настоящий ИИ — OpenAI</option></select></Field>
    {!overview.data.provider.configured&&<p className="coach-warning">{overview.data.settings.provider==='openrouter'?'Сохраните ключ, выберите модель и проверьте подключение в разделе «Подключение ИИ».':'Для OpenAI нужны серверные OPENAI_API_KEY и COACH_MODEL_ID. OpenRouter можно настроить в разделе «Подключение ИИ».'}</p>}</Card>}
    <nav className="coach-tabs" aria-label="Разделы администрирования куратора">{[['behavior','Поведение и промпт'],['connection','Подключение ИИ'],['control','Контроль работы'],['partners','Партнёры'],['reviews','Проверки'],['knowledge','База знаний'],['audit','Журнал']].map(([id,label])=><Button key={id} variant={adminTab===id?'primary':'secondary'} onClick={()=>{selectAdmin(id!);if(id==='reviews'||id==='audit')void overview.refetch();}}>{label}</Button>)}</nav>
    {adminTab==='control'&&<AdminManagement onSelect={id=>selectAdmin('partners',id)}/>}
    {adminTab==='behavior'&&<CoachBehaviorSettings onChanged={refresh}/>}
    {adminTab==='connection'&&overview.data&&<OpenRouterSettings enabled={overview.data.settings.enabled} provider={overview.data.settings.provider} dailyRuns={overview.data.settings.dailyRuns} onChanged={refresh}/>}
    {adminTab==='partners'&&<><Field label="Выберите партнёра для сопровождения"><select value={partnerId} onChange={e=>selectAdmin('partners',e.target.value)}><option value="">Выберите партнёра</option>{overview.data?.partners.filter(p=>!p.revokedAt).map(p=><option key={p.id} value={p.id}>{p.name} — {p.email}</option>)}</select></Field>{partnerId?<Workspace key={partnerId} principal={principal} partnerId={partnerId} embedded/>:<Card>Выберите партнёра. Его калькулятор и календарь будут доступны отдельно от других партнёров.</Card>}</>}
    {adminTab==='reviews'&&<><p>Завершение задания подтверждает работу, но не создаёт комиссию или выплату.</p>{overview.data?.reviews.map(task=><HumanReview key={task.id} task={task} partnerName={overview.data.partners.find(p=>p.id===task.partnerId)?.name??'Партнёр'} busy={busy} resolve={(verdict,comment)=>change(`/admin/coach/tasks/${task.id}/resolve`,{version:task.version,verdict,comment})}/>)}{!overview.data?.reviews.length&&<Card>Заданий для ручной проверки пока нет.</Card>}</>}
    {adminTab==='knowledge'&&<><Card><h2>Добавить утверждённый источник</h2><Field label="Название"><Input value={knowledgeTitle} onChange={e=>setKnowledgeTitle(e.target.value)}/></Field><Field label="Содержание"><textarea value={knowledgeBody} onChange={e=>setKnowledgeBody(e.target.value)} rows={6}/></Field><Field label="Источник"><Input value={knowledgeSource} onChange={e=>setKnowledgeSource(e.target.value)}/></Field><label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/> Я проверил содержание и разрешаю использовать его в ответах</label><div className="coach-actions"><Button disabled={busy||!knowledgeTitle||!knowledgeBody} onClick={()=>{void change('/admin/coach/knowledge',{title:knowledgeTitle,body:knowledgeBody,source:knowledgeSource,approved});}}>Сохранить источник</Button></div></Card>{knowledge.data?.items.map(item=><Card key={item.id}><strong>{text(item.data.title)}</strong><p className="coach-muted">{item.status==='approved'?'Утверждён':'Черновик'} · версия {item.version}</p><p className="coach-pre">{text(item.data.body)}</p></Card>)}</>}
    {adminTab==='audit'&&<><h2>Последние запросы</h2>{overview.data?.runs.map(r=><Card key={r.id}><strong>{statuses[r.status]??r.status}</strong><p className="coach-muted">{r.id} · {new Date(r.createdAt).toLocaleString('ru-RU')}</p></Card>)}<h2>Журнал действий</h2>{overview.data?.audit.map(r=><p key={r.id} className="coach-muted">{new Date(r.createdAt).toLocaleString('ru-RU')} · {auditNames[r.status]??'Действие куратора'}</p>)}</>}
    </div>
  </Page>;
}
function HumanReview({task,partnerName,busy,resolve}:{task:Task;partnerName:string;busy:boolean;resolve:(verdict:string,comment:string)=>Promise<void>}) {
  const [comment,setComment]=useState('');
  const submission=task.data.submission as {text?:string;publicationUrl?:string}|undefined;
  return <Card><p className="coach-muted">{partnerName}</p><h3>{text(task.data.title)}</h3><p>{statuses[task.status]}</p><p className="coach-pre">{submission?.text}</p>{submission?.publicationUrl&&<a href={submission.publicationUrl} target="_blank" rel="noopener noreferrer">Открыть публикацию</a>}<Field label="Комментарий менеджера"><textarea value={comment} onChange={e=>setComment(e.target.value)} rows={3}/></Field><div className="coach-actions"><Button disabled={busy||!comment.trim()} onClick={()=>{void resolve('completed',comment);}}>Подтвердить выполнение</Button><Button variant="secondary" disabled={busy||!comment.trim()} onClick={()=>{void resolve('changes_requested',comment);}}>Запросить исправления</Button></div></Card>;
}

function Workspace({principal,partnerId,embedded=false}:{principal:Principal;partnerId:string;embedded?:boolean}) {
  const [params,setParams]=useSearchParams();
  const cache=useQueryClient();
  const prefix=principal.role==='admin'?`/admin/coach/partners/${partnerId}`:'/coach/me';
  const requestedMode=params.get('mode');
  const mode=requestedMode==='directives'||requestedMode==='context'?requestedMode:'calendar';
  if(principal.role==='partner')return <Navigate to="/plan" replace />;
  return <div className="coach"><nav className="coach-tabs" aria-label="Сопровождение партнёра">{[['calendar','Календарь из калькулятора'],['directives','Промпт партнёра'],['context','Контекст ИИ']].map(([id,label])=><Button key={id} variant={mode===id?'primary':'secondary'} onClick={()=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('mode',id!);next.delete('taskId');return next;})}>{label}</Button>)}</nav>
    {mode==='calendar'&&<CalculatorWork partnerId={partnerId} prefix={prefix} embedded={embedded}/>}
    {mode==='directives'&&<CoachBehaviorSettings partnerId={partnerId} onChanged={()=>cache.invalidateQueries({queryKey:['coach']})}/>}
    {mode==='context'&&<CoachContextInspector partnerId={partnerId} programId={params.get('programId')||''}/>}
  </div>;
}
