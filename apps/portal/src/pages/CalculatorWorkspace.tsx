import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, currentTenantSlug, type Principal } from '../api.js';
import { Button, Card, ErrorBanner, Page } from '../ui.js';
import { useTenantBase } from '../tenant-base.js';
import { CalculatorPage } from './Calculator.js';
import './coach/coach.css';

interface Snapshot {id:string;programId:string;data:{settings:Record<string,unknown>;scenarioId?:string;scenarioName?:string};createdAt:string}
interface PreviewTask {key:string;day:string;title:string;minutes:number;kind:string;placements:Array<{name:string}>;estimatedViews:number}
interface Preview {tasks:PreviewTask[];originals:number;placements:number;minutes:number;views:number}
const periodOptions=[[7,'Неделя'],[14,'2 недели'],[28,'4 недели'],[30,'Месяц (30 дней)'],[90,'3 месяца (90 дней)'],[180,'6 месяцев (180 дней)'],[365,'Год (365 дней)']] as const;
const dateLabel=(day:string)=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));
export function CalculatorWorkspace({principal}:{principal:Principal}) {
  const [params,setParams]=useSearchParams(),nav=useNavigate(),base=useTenantBase(),cache=useQueryClient();
  const tenant=currentTenantSlug(),admin=principal.role==='admin';
  const partnerId=admin?params.get('partnerId')??'':principal.partnerId??'';
  const partners=useQuery({queryKey:['calculator-partners',tenant],queryFn:()=>api<{partners:Array<{id:string;name:string;email:string}>}>('/partners'),enabled:admin});
  const prefix=admin?`/admin/coach/partners/${partnerId}`:'/coach/me';
  const key=['coach',tenant,partnerId,prefix];
  const me=useQuery({queryKey:[...key,'me'],queryFn:()=>api<{programs:Array<{id:string;name:string}>}>(prefix),enabled:!!partnerId});
  const programId=me.data?.programs.find(p=>p.id===params.get('programId'))?.id??me.data?.programs[0]?.id??'';
  const snapshots=useQuery({queryKey:[...key,'snapshots',programId],queryFn:()=>api<{snapshots:Snapshot[]}>(`${prefix}/forecast-snapshots?programId=${encodeURIComponent(programId)}`),enabled:!!programId});
  const scenarios=useMemo(()=>{
    const grouped=new Map<string,{id:string;name:string;snapshot:Snapshot}>();
    for(const snapshot of snapshots.data?.snapshots??[]){
      const id=snapshot.data.scenarioId??snapshot.id;
      if(!grouped.has(id))grouped.set(id,{id,name:snapshot.data.scenarioName?.trim()||`Сценарий ${grouped.size+1}`,snapshot});
    }
    return [...grouped.values()];
  },[snapshots.data]);
  const scenarioId=params.get('scenarioId')??scenarios[0]?.id??'new';
  const selectedScenario=scenarios.find(s=>s.id===scenarioId);
  const isNewScenario=scenarioId==='new'||!selectedScenario;
  const [newScenarioId,setNewScenarioId]=useState(()=>`new-${Date.now()}-${Math.random().toString(36).slice(2,10)}`);
  const planQueryId=isNewScenario?'new':scenarioId;
  const plan=useQuery({queryKey:[...key,'calculator-plan',programId,planQueryId],queryFn:()=>api<{plan:{id:string;version:number;data?:{startDate:string;days:number;weekdays:number[];scenarioId?:string;scenarioName?:string}}|null}>(`${prefix}/calculator-plan?programId=${encodeURIComponent(programId)}&scenarioId=${encodeURIComponent(planQueryId)}`),enabled:!!programId});
  const latest=selectedScenario?.snapshot;
  const storageScenarioKey=isNewScenario?newScenarioId:scenarioId;
  const storageKey=`syntolk-partner-forecast-v1:${tenant}:${partnerId||'admin-preview'}:${programId}:${storageScenarioKey}`;
  const [startDate,setStartDate]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
  const [days,setDays]=useState(30),[weekdays,setWeekdays]=useState([1,2,3,4,5]);
  const [draft,setDraft]=useState<Record<string,unknown>|null>(null),[customPeriod,setCustomPeriod]=useState(false),[previewWeek,setPreviewWeek]=useState(0);
  const [scenarioName,setScenarioName]=useState('');
  const [newScenarioSettings,setNewScenarioSettings]=useState<Record<string,unknown>|undefined>();
  const [createDialogOpen,setCreateDialogOpen]=useState(false),[createName,setCreateName]=useState(''),[createDialogError,setCreateDialogError]=useState('');
  const createRootRef=useRef<HTMLElement|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState<Error|null>(null);
  const pendingCalendar=useRef<{signature:string;body:Record<string,unknown>}|null>(null);
  const hydratedCalendar=useRef('');
  useEffect(()=>{
    setDraft(null);setPreviewWeek(0);pendingCalendar.current=null;hydratedCalendar.current='';
    setStartDate(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
    setDays(30);setCustomPeriod(false);setWeekdays([1,2,3,4,5]);
    let timer:ReturnType<typeof setTimeout>;
    const changed=(event:Event)=>{
      const root=event.target as HTMLElement;if(root?.dataset?.storageKey!==storageKey)return;
      clearTimeout(timer);timer=setTimeout(()=>{setDraft(JSON.parse(root.dataset.currentSettings??'null') as Record<string,unknown>|null);},300);
    };
    document.addEventListener('syntolk-calculator-change',changed);
    const read=()=>{const root=document.getElementById('partner-forecast');if(root?.dataset.storageKey===storageKey&&root.dataset.currentSettings)setDraft(JSON.parse(root.dataset.currentSettings) as Record<string,unknown>);};
    read();
    return()=>{clearTimeout(timer);document.removeEventListener('syntolk-calculator-change',changed);};
  },[storageKey]);
  useEffect(()=>{if(selectedScenario)setScenarioName(selectedScenario.name);},[scenarioId,selectedScenario?.name]);
  const hasContent=Object.values((draft?.frequency??{}) as Record<string,unknown>).some(value=>Number(value)>0);
  const preview=useQuery({queryKey:[...key,'calculator-preview',programId,draft,startDate,days,weekdays],queryFn:()=>api<Preview>(`${prefix}/calculator-plan/preview`,{method:'POST',body:{programId,settings:draft,startDate,days,weekdays}}),enabled:!!programId&&hasContent&&!!startDate&&days>=1&&days<=365&&!!weekdays.length,retry:false,staleTime:30000});
  useEffect(()=>{
    const scope=`${partnerId}:${programId}:${scenarioId}`;
    if(!plan.data||hydratedCalendar.current===scope)return;
    hydratedCalendar.current=scope;
    const previous=plan.data.plan?.data;
    if(previous){
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      setStartDate(previous.startDate<today?today:previous.startDate);setDays(previous.days);setCustomPeriod(!periodOptions.some(([n])=>n===previous.days));setWeekdays(previous.weekdays);
    }else{
      setDays(30);setCustomPeriod(false);setWeekdays([1,2,3,4,5]);
    }
  },[partnerId,programId,plan.data]);
  const save=async()=>{
    setBusy(true);setError(null);
    try{
      const raw=document.getElementById('partner-forecast')?.dataset.currentSettings;
      if(!raw)throw new Error('Дождитесь загрузки калькулятора.');
      const settings=JSON.parse(raw) as Record<string,unknown>;
      if(!Object.values((settings.frequency??{}) as Record<string,unknown>).some(value=>Number(value)>0))throw new Error('Укажите количество материалов и выберите площадки для нового сценария.');
      const cleanName=scenarioName.trim();
      if(!cleanName)throw new Error('Укажите название сценария.');
      const signature=JSON.stringify({partnerId,programId,scenarioId:storageScenarioKey,scenarioName:cleanName,settings,startDate,days,weekdays});
      if(pendingCalendar.current?.signature!==signature){
        const {snapshot}=await api<{snapshot:Snapshot}>(`${prefix}/forecast-snapshots`,{method:'POST',body:{programId,confirmed:true,settings,scenarioId:storageScenarioKey,scenarioName:cleanName}});
        const savedScenarioId=snapshot.data?.scenarioId??storageScenarioKey;
        pendingCalendar.current={signature,body:{programId,snapshotId:snapshot.id,scenarioId:savedScenarioId,startDate,days,weekdays,requestId:crypto.randomUUID(),...(plan.data?.plan?{replacePlanId:plan.data.plan.id,replaceVersion:plan.data.plan.version}:{})}};
      }
      await api(`${prefix}/calculator-plan`,{method:'POST',body:pendingCalendar.current!.body});
      const savedScenarioId=String(pendingCalendar.current!.body.scenarioId??scenarioId);
      pendingCalendar.current=null;
      await cache.invalidateQueries({queryKey:key});
      await cache.invalidateQueries({queryKey:['links',partnerId]});
      await cache.invalidateQueries({queryKey:['coach-home-calendar',partnerId]});
      nav(admin?`${base}/admin/coach?tab=partners&partnerId=${partnerId}&programId=${programId}&scenarioId=${encodeURIComponent(savedScenarioId)}`:`${base}/plan?programId=${programId}&scenarioId=${encodeURIComponent(savedScenarioId)}`);
    }catch(e){setError(e as Error);}finally{setBusy(false);}
  };
  const switchScenario=(value:string)=>{
    setParams(previous=>{const next=new URLSearchParams(previous);next.set('scenarioId',value);return next;});
  };
  const createScenario=(root:HTMLElement)=>{
    createRootRef.current=root;
    setCreateName(`Сценарий ${scenarios.length+1}`);
    setCreateDialogError('');
    setCreateDialogOpen(true);
  };
  const confirmCreateScenario=()=>{
    const root=createRootRef.current;
    const cleanName=createName.trim();
    if(!cleanName){setCreateDialogError('Введите название сценария.');return;}
    if(!root){setCreateDialogError('Не удалось открыть калькулятор. Обновите страницу и попробуйте ещё раз.');return;}
    root.dispatchEvent(new CustomEvent('syntolk-calculator-reset',{bubbles:true,detail:{persist:false}}));
    try {
      const resetSettings=JSON.parse(root.dataset.currentSettings??'null') as Record<string,unknown>|null;
      if(resetSettings)setNewScenarioSettings(resetSettings);
    } catch { setNewScenarioSettings(undefined); }
    setScenarioName(cleanName);
    setNewScenarioId(`new-${Date.now()}-${Math.random().toString(36).slice(2,10)}`);
    setParams(previous=>{const next=new URLSearchParams(previous);next.set('scenarioId','new');return next;});
    setCreateDialogOpen(false);
    createRootRef.current=null;
  };
  const deleteScenario=async()=>{
    if(isNewScenario||!window.confirm(`Удалить сценарий «${selectedScenario?.name??'Сценарий'}»? Незавершённые задачи будут убраны, выполненная история сохранится.`))return;
    setBusy(true);setError(null);
    try{
      await api(`${prefix}/forecast-snapshots/${encodeURIComponent(scenarioId)}?programId=${encodeURIComponent(programId)}`,{method:'DELETE'});
      await cache.invalidateQueries({queryKey:[...key,'snapshots',programId]});
      await cache.invalidateQueries({queryKey:[...key,'calculator-plan',programId]});
      setScenarioName('');
      setNewScenarioSettings(undefined);
      setNewScenarioId(`new-${Date.now()}-${Math.random().toString(36).slice(2,10)}`);
      setParams(previous=>{const next=new URLSearchParams(previous);next.set('scenarioId','new');return next;});
    }catch(e){setError(e as Error);}finally{setBusy(false);}
  };
  const disabled=busy||!programId||!hasContent||plan.isLoading||!!plan.error||!startDate||!weekdays.length||days<1||days>365||!!preview.error||(isNewScenario&&!scenarioName.trim());
  const scopePicker=<div className="coach calculator-intro">
    <ErrorBanner error={error??partners.error??me.error??snapshots.error??plan.error}/>
    {admin&&<label className="coach-field"><span>Калькулятор партнёра</span><select aria-label="Калькулятор партнёра" value={partnerId} onChange={e=>{setParams(previous=>{const next=new URLSearchParams(previous);next.set('partnerId',e.target.value);next.delete('programId');next.delete('scenarioId');return next;});}}><option value="">Предпросмотр без сохранения</option>{partners.data?.partners.map(p=><option key={p.id} value={p.id}>{p.name} — {p.email}</option>)}</select></label>}
    {!!partnerId&&me.data?.programs.length!==1&&<label className="coach-field"><span>Партнёрская программа</span><select aria-label="Партнёрская программа" value={programId} onChange={e=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('programId',e.target.value);next.delete('scenarioId');return next;})}>{me.data?.programs.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    {!!programId&&scenarios.length>0&&<div className="calculator-scenario-picker"><label className="coach-field"><span>Сохранённые сценарии</span><select aria-label="Сохранённый сценарий" value={isNewScenario?'':scenarioId} onChange={e=>{if(e.target.value)switchScenario(e.target.value);}}><option value="">Выберите сохранённый сценарий</option>{scenarios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{!isNewScenario&&<div className="coach-actions"><Button variant="ghost" onClick={()=>{void deleteScenario();}} disabled={busy}>Удалить сценарий</Button></div>}</div>}
    {isNewScenario&&scenarioName&&<div className="calculator-new-scenario"><strong>Новый сценарий: {scenarioName}</strong><span>Настройте контент и площадки ниже, затем сохраните сценарий и составьте план.</span></div>}
    {!isNewScenario&&<p className="coach-muted">Сценарий «{selectedScenario?.name}» загружен. Изменения сохранятся в его новом календаре.</p>}
  </div>;
  const planning=programId?<section className="coach calculator-planning" aria-label="Период рабочего сценария"><Card>
      <div className="coach-grid"><label className="coach-field"><span>Начало работы</span><input aria-label="Начало календаря" type="date" value={startDate} onChange={e=>{setStartDate(e.target.value);setPreviewWeek(0);}}/></label><label className="coach-field"><span>План работ на</span><select aria-label="Период календаря" value={customPeriod?'custom':days} onChange={e=>{setCustomPeriod(e.target.value==='custom');if(e.target.value!=='custom')setDays(Number(e.target.value));setPreviewWeek(0);}}>{periodOptions.map(([n,label])=><option key={n} value={n}>{label}</option>)}<option value="custom">Свой срок</option></select></label>{customPeriod&&<label className="coach-field"><span>Количество дней</span><input aria-label="Количество дней плана" type="number" min="1" max="365" value={days} onChange={e=>{setDays(Number(e.target.value));setPreviewWeek(0);}}/></label>}</div>
      <div className="coach-row"><span className="coach-muted">Рабочие дни</span><div className="coach-actions" role="group" aria-label="Рабочие дни">{[[1,'Пн'],[2,'Вт'],[3,'Ср'],[4,'Чт'],[5,'Пт'],[6,'Сб'],[0,'Вс']].map(([day,label])=><Button key={day} variant={weekdays.includes(Number(day))?'primary':'secondary'} aria-pressed={weekdays.includes(Number(day))} onClick={()=>setWeekdays(current=>current.includes(Number(day))?current.filter(d=>d!==day):[...current,Number(day)])}>{label}</Button>)}</div></div>
  </Card></section>:null;
  const connection=<section className="coach calculator-connection" aria-label="Сохранение сценария и календарь"><Card>
    {programId?<><h2>Работы по этому сценарию</h2>
      <ErrorBanner error={preview.error}/>
      {!hasContent?<p className="coach-muted">Укажите количество материалов и выберите площадки — здесь появится план нового сценария.</p>:!weekdays.length?<p>Выберите хотя бы один рабочий день.</p>:preview.data?<><p className="coach-plan-summary">За {days} дней: <strong>{preview.data.originals} материалов</strong> · {preview.data.placements} размещений · {Math.round(preview.data.minutes)} мин. · ≈ {Math.round(preview.data.views).toLocaleString('ru-RU')} просмотров по вашим значениям.</p><details className="calculator-preview"><summary>Посмотреть распределение по дням</summary><label className="coach-field"><span>Неделя плана</span><select aria-label="Неделя предварительного плана" value={Math.min(previewWeek,Math.ceil(days/7)-1)} onChange={e=>setPreviewWeek(Number(e.target.value))}>{Array.from({length:Math.ceil(days/7)},(_,i)=><option key={i} value={i}>{i+1}</option>)}</select></label><ul>{preview.data.tasks.filter(t=>{const offset=Math.round((Date.parse(t.day)-Date.parse(startDate))/86400000);return offset>=previewWeek*7&&offset<(previewWeek+1)*7;}).map(task=><li key={task.key}><span>{dateLabel(task.day)}</span><div><strong>{task.title}</strong><small>{Math.round(task.minutes)} мин.{task.placements.length?` · ${task.placements.map(p=>p.name).join(', ')}`:''}</small></div></li>)}</ul>{!preview.data.tasks.some(t=>{const offset=Math.round((Date.parse(t.day)-Date.parse(startDate))/86400000);return offset>=previewWeek*7&&offset<(previewWeek+1)*7;})&&<p className="coach-muted">На этой неделе материалов по заданной частоте нет.</p>}</details></>:!preview.error?<p className="coach-muted">{preview.isFetching?'Рассчитываем объём работ…':'Измените контент и площадки — здесь появится объём работ на выбранный срок.'}</p>:null}
      <div className="coach-actions calculator-save-actions"><Button disabled={disabled} onClick={()=>{void save();}}>{busy?'Сохраняем и составляем план…':plan.data?.plan?'Сохранить изменения и перестроить план':'Сохранить сценарий и составить план'}</Button></div>
      <p className="coach-muted">Один материал — одна задача с выбранными площадками. Календарь распределит публикации по выбранным дням.</p>
      {plan.data?.plan&&<p className="coach-muted">Перестроение заменяет незавершённые шаги новым сценарием. История выполненных шагов и финансовый учёт сохраняются.</p>}
      {latest&&<small className="coach-muted">Последнее сохранение «{selectedScenario?.name}»: {new Date(latest.createdAt).toLocaleString('ru-RU')}</small>}
    </>:<p className="coach-muted">{admin?'Выберите партнёра, чтобы сохранить его сценарий и создать календарь.':'Администратору нужно назначить вам партнёрскую программу.'}</p>}
  </Card></section>;
  if(partnerId&&(me.isLoading||(programId&&snapshots.isLoading)))return <Page title="Калькулятор"><Card>Загружаем сохранённый сценарий…</Card></Page>;
  return <>
    <CalculatorPage key={storageKey} principal={principal} scope={{key:storageKey,settings:isNewScenario?newScenarioSettings:latest?.data.settings}} onCreateScenario={createScenario} intro={scopePicker} planning={planning} connection={connection}/>
    {createDialogOpen&&<div className="calculator-scenario-dialog-backdrop" role="presentation">
      <section className="calculator-scenario-dialog" role="dialog" aria-modal="true" aria-labelledby="calculator-scenario-dialog-title">
        <h2 id="calculator-scenario-dialog-title">Название сценария</h2>
        <p className="coach-muted">Задайте название, затем настройте контент и площадки. Сохранение сценария и календаря будет доступно после настройки.</p>
        <label className="coach-field"><span>Название</span><input autoFocus aria-label="Название сценария" value={createName} onChange={event=>{setCreateName(event.target.value);setCreateDialogError('');}} onKeyDown={event=>{if(event.key==='Enter')confirmCreateScenario();if(event.key==='Escape'){setCreateDialogOpen(false);createRootRef.current=null;}}}/></label>
        {createDialogError&&<p className="coach-warning" role="alert">{createDialogError}</p>}
        <div className="coach-actions calculator-scenario-dialog-actions"><Button variant="secondary" onClick={()=>{setCreateDialogOpen(false);createRootRef.current=null;}}>Отмена</Button><Button onClick={confirmCreateScenario}>Создать и настроить</Button></div>
      </section>
    </div>}
  </>;
}
