import {VisualSelect} from '../components/tremor/VisualControls.js';
import {Ellipsis,Pencil,CalendarDays,Trash2,Plus,Save,Check} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, currentTenantSlug, type Principal } from '../api.js';
import { Button, Card, ErrorBanner, Page } from '../ui.js';
import { useTenantBase } from '../tenant-base.js';
import { CalculatorPage } from './Calculator.js';
import './coach/coach.css';
import { usePartnerSelection } from '../lib/partner-selection.js';
import { invalidateAnalytics } from './results-scope.js';
import {useUnsavedChanges} from '../lib/useUnsavedChanges.js';
import {CalculatorCurrentValues,type CurrentValuesFilter} from './CalculatorCurrentValues.js';
import {DateInput} from './DateInput.js';
import {ResultsDatePicker} from './ResultsDatePicker.js';
import {Button as TremorButton} from '../components/tremor/raw/components/Button/Button.js';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator} from '../components/tremor/raw/components/DropdownMenu/DropdownMenu.js';
import {CalendarDialog} from './coach/CalendarMaterialDialogs.js';

interface Snapshot {id:string;programId:string;data:{settings:Record<string,unknown>;scenarioId?:string;scenarioName?:string};createdAt:string}
interface PreviewTask {key:string;day:string;title:string;kind:string;placements:Array<{name:string}>;estimatedViews:number}
interface Preview {tasks:PreviewTask[];originals:number;placements:number;views:number}
const periodOptions=[[7,'Неделя'],[14,'2 недели'],[30,'Месяц']] as const;
const endOfPeriod=(start:string,days:number)=>{const date=new Date(`${start}T12:00:00Z`);if(!Number.isFinite(date.getTime()))return '';date.setUTCDate(date.getUTCDate()+days-1);return date.toISOString().slice(0,10);};
const dateLabel=(day:string)=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));
function calculatorError(error:unknown){
  const detail=(error as {detail?:{detail?:unknown}}|null)?.detail?.detail;
  return typeof detail==='string'?new Error(detail):error;
}
export function CalculatorWorkspace({principal}:{principal:Principal}) {
  const closeScenarioDialog=()=>{setCreateDialogOpen(false);createRootRef.current=null;};
  const [params,setParams]=useSearchParams(),nav=useNavigate(),base=useTenantBase(),cache=useQueryClient();
  const tenant=currentTenantSlug(),admin=principal.role==='admin';
  const [currentValuesActive,setCurrentValuesActive]=useState(false);
  const [currentValuesFilter,setCurrentValuesFilter]=useState<CurrentValuesFilter>({period:'30d',from:'',to:'',allContent:false});
  const partnerId=admin?params.get('partnerId')??'':principal.partnerId??'';
  const partners=useQuery({queryKey:['calculator-partners',tenant],queryFn:()=>api<{partners:Array<{id:string;name:string;email:string}>}>('/partners'),enabled:admin});
  const prefix=admin?`/admin/coach/partners/${partnerId}`:'/coach/me';
  const key=['coach',tenant,partnerId,prefix];
  const me=useQuery({queryKey:[...key,'me'],queryFn:()=>api<{programs:Array<{id:string;name:string}>}>(prefix),enabled:!!partnerId});
  const selection=usePartnerSelection(partnerId,me.data?.programs??[]),programId=selection.programId;
  const snapshots=useQuery({queryKey:[...key,'snapshots',programId,'latest'],queryFn:()=>api<{snapshots:Snapshot[]}>(`${prefix}/forecast-snapshots?programId=${encodeURIComponent(programId)}&latestPerScenario=true`),enabled:!!programId,refetchInterval:30000,refetchOnWindowFocus:true});
  const scenarios=useMemo(()=>{
    const grouped=new Map<string,{id:string;name:string;snapshot:Snapshot}>();
    for(const snapshot of snapshots.data?.snapshots??[]){
      const id=snapshot.data.scenarioId??snapshot.id;
      if(!grouped.has(id))grouped.set(id,{id,name:snapshot.data.scenarioName?.trim()||`Сценарий ${grouped.size+1}`,snapshot});
    }
    return [...grouped.values()];
  },[snapshots.data]);
  const requestedScenario=params.get('scenarioId');
  const scenarioId=requestedScenario&&!['all','__none__'].includes(requestedScenario)?requestedScenario:selection.scenarioIds[0]??scenarios[0]?.id??'new';
  const selectedScenario=scenarios.find(s=>s.id===scenarioId);
  const isNewScenario=scenarioId==='new';
  const missingScenario=!snapshots.isPending&&!isNewScenario&&!selectedScenario;
  const [newScenarioId,setNewScenarioId]=useState(()=>`new-${Date.now()}-${Math.random().toString(36).slice(2,10)}`);
  const planQueryId=isNewScenario?'new':scenarioId;
  const plan=useQuery({queryKey:[...key,'calculator-plan',programId,planQueryId],queryFn:()=>api<{plan:{id:string;version:number;data?:{startDate:string;days:number;weekdays:number[];scenarioId?:string;scenarioName?:string}}|null}>(`${prefix}/calculator-plan?programId=${encodeURIComponent(programId)}&scenarioId=${encodeURIComponent(planQueryId)}`),enabled:!!programId,refetchInterval:30000,refetchOnWindowFocus:true});
  const latest=selectedScenario?.snapshot;
  const storageScenarioKey=isNewScenario?newScenarioId:scenarioId;
  useEffect(()=>{setCurrentValuesFilter(previous=>({...previous,allContent:false}));},[partnerId,programId,storageScenarioKey]);
  const storageKey=`syntolk-partner-forecast-v1:${tenant}:${partnerId||'admin-preview'}:${programId}:${storageScenarioKey}`;
  const [startDate,setStartDate]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
  const [days,setDays]=useState(30),[weekdays,setWeekdays]=useState([1,2,3,4,5]);
  const [savedSchedule,setSavedSchedule]=useState<{startDate:string;days:number;weekdays:number[]}|null>(null);
  const [draft,setDraft]=useState<Record<string,unknown>|null>(null),[customPeriod,setCustomPeriod]=useState(false),[previewWeek,setPreviewWeek]=useState(0);
  const [savedSettings,setSavedSettings]=useState<string|null>(null);
  const [scenarioName,setScenarioName]=useState('');
  const [savedNotice,setSavedNotice]=useState<string|null>(null);
  const [snapshotConflict,setSnapshotConflict]=useState(false),[calendarConflict,setCalendarConflict]=useState(false);
  const [newScenarioSettings,setNewScenarioSettings]=useState<Record<string,unknown>|undefined>();
  const [createDialogOpen,setCreateDialogOpen]=useState(false),[createName,setCreateName]=useState(''),[createDialogError,setCreateDialogError]=useState('');
  const [createMode,setCreateMode]=useState<'new'|'save'>('new');
  const createRootRef=useRef<HTMLElement|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState<Error|null>(null);
  const [deleteTarget,setDeleteTarget]=useState<{id:string;name:string;programId:string;partnerId:string}|null>(null);
  const deleting=useRef(false);
  useEffect(()=>{setDeleteTarget(null);},[partnerId,programId,scenarioId]);
  const saving=useRef(false);
  const scheduleChanged=!!savedSchedule&&(startDate!==savedSchedule.startDate||days!==savedSchedule.days||weekdays.length!==savedSchedule.weekdays.length||weekdays.some(day=>!savedSchedule.weekdays.includes(day)));
  const settingsChanged=!!draft&&savedSettings!==null&&JSON.stringify(draft)!==savedSettings;

  useEffect(()=>{
    setScenarioName('');setNewScenarioSettings(undefined);setSavedNotice(null);
    setCreateDialogOpen(false);createRootRef.current=null;
  },[partnerId,programId]);
  useEffect(()=>{setError(null);},[startDate,days,weekdays]);
  const pendingCalendar=useRef<{signature:string;body:Record<string,unknown>;snapshot:Snapshot}|null>(null);
  const hydratedCalendar=useRef('');
  useEffect(()=>{
    setCreateDialogOpen(false);createRootRef.current=null;setDraft(null);setSavedSettings(null);setSnapshotConflict(false);setCalendarConflict(false);setError(null);setPreviewWeek(0);setSavedSchedule(null);pendingCalendar.current=null;hydratedCalendar.current='';
    setStartDate(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
    setDays(30);setCustomPeriod(false);setWeekdays([1,2,3,4,5]);
    let timer:ReturnType<typeof setTimeout>;
    const changed=(event:Event)=>{
      const root=event.target as HTMLElement;if(root?.dataset?.storageKey!==storageKey)return;
      clearTimeout(timer);timer=setTimeout(()=>{const raw=root.dataset.currentSettings??'null';setDraft(JSON.parse(raw) as Record<string,unknown>|null);if(raw!=='null')setSavedSettings(previous=>root.dataset.savedSettings||previous||raw);setSnapshotConflict(root.dataset.snapshotConflict==='true');},300);
    };
    document.addEventListener('syntolk-calculator-change',changed);
    const read=()=>{const root=document.getElementById('partner-forecast');if(root?.dataset.storageKey===storageKey&&root.dataset.currentSettings){setDraft(JSON.parse(root.dataset.currentSettings) as Record<string,unknown>);setSavedSettings(root.dataset.savedSettings||root.dataset.currentSettings);setSnapshotConflict(root.dataset.snapshotConflict==='true');}};
    read();
    return()=>{clearTimeout(timer);document.removeEventListener('syntolk-calculator-change',changed);};
  },[storageKey]);
  const activeScenarioName=isNewScenario?scenarioName:selectedScenario?.name??'';
  const editorEnabled=admin||!!selectedScenario||!!scenarioName.trim();
  const hasContent=Object.values((draft?.frequency??{}) as Record<string,unknown>).some(value=>Number(value)>0);
  const allowNavigation=useUnsavedChanges(settingsChanged||scheduleChanged||isNewScenario&&!!scenarioName.trim()&&hasContent,busy);
  const preview=useQuery({queryKey:[...key,'calculator-preview',programId,draft,startDate,days,weekdays],queryFn:()=>api<Preview>(`${prefix}/calculator-plan/preview`,{method:'POST',body:{programId,settings:draft,startDate,days,weekdays}}),enabled:editorEnabled&&!!programId&&hasContent&&!!startDate&&days>=1&&days<=365&&!!weekdays.length,retry:false,staleTime:30000});
  useEffect(()=>{
    const scope=`${partnerId}:${programId}:${scenarioId}:${plan.data?.plan?.id??'none'}:${plan.data?.plan?.version??0}`;
    if(!plan.data||hydratedCalendar.current===scope||busy)return;
    if(hydratedCalendar.current&&scheduleChanged){setCalendarConflict(true);return;}
    hydratedCalendar.current=scope;setCalendarConflict(false);
    const previous=plan.data.plan?.data;
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(previous){
      const initialStart=previous.startDate<today?today:previous.startDate;
      setStartDate(initialStart);setDays(previous.days);setCustomPeriod(!periodOptions.some(([n])=>n===previous.days));setWeekdays(previous.weekdays);setSavedSchedule({startDate:initialStart,days:previous.days,weekdays:previous.weekdays});
    }else{
      setDays(30);setCustomPeriod(false);setWeekdays([1,2,3,4,5]);setSavedSchedule({startDate:today,days:30,weekdays:[1,2,3,4,5]});
    }
  },[partnerId,programId,scenarioId,plan.data,busy,scheduleChanged,savedSchedule]);
  const save=async(name=activeScenarioName)=>{
    if(saving.current)return;
    saving.current=true;
    setBusy(true);setError(null);setSavedNotice(null);
    try{
      const raw=document.getElementById('partner-forecast')?.dataset.currentSettings;
      if(!raw)throw new Error('Дождитесь загрузки калькулятора.');
      const settings=JSON.parse(raw) as Record<string,unknown>;
      const root=document.getElementById('partner-forecast')!;
      const conflict=root.dataset.snapshotConflict==='true'||calendarConflict;
      if(conflict&&!window.confirm('Сценарий изменён в другом кабинете. Сохранить ваш вариант поверх актуальной версии и перестроить календарь?'))return;
      const expectedSnapshotId=(conflict?root.dataset.serverRevision:root.dataset.baseSnapshotId)||null;
      if(!Object.values((settings.frequency??{}) as Record<string,unknown>).some(value=>Number(value)>0))throw new Error('Укажите количество материалов и выберите площадки для нового сценария.');
      const cleanName=name.trim();
      const signature=JSON.stringify({partnerId,programId,scenarioId:storageScenarioKey,scenarioName:cleanName,settings,startDate,days,weekdays});
      if(pendingCalendar.current?.signature!==signature){
        await api(`${prefix}/calculator-plan/preview`,{method:'POST',body:{programId,settings,startDate,days,weekdays}});
        if(!cleanName){if(admin){setCreateMode('save');setCreateName(`Сценарий ${scenarios.length+1}`);setCreateDialogError('');setCreateDialogOpen(true);return;}throw new Error('Сначала создайте черновик сценария.');}
        if(plan.data?.plan&&!conflict&&!window.confirm(`Сохранить изменения сценария «${cleanName}» и перестроить календарь? Незавершённые задачи будут заменены. Выполненная история и подготовленные материалы сохранятся.`))return;
        const {snapshot}=await api<{snapshot:Snapshot}>(`${prefix}/forecast-snapshots`,{method:'POST',body:{programId,confirmed:true,settings,scenarioId:storageScenarioKey,scenarioName:cleanName,expectedSnapshotId}});
        await invalidateAnalytics(cache);
        const savedScenarioId=snapshot.data?.scenarioId??storageScenarioKey;
        pendingCalendar.current={signature,snapshot:{...snapshot,programId:snapshot.programId??programId,data:{...snapshot.data,settings:snapshot.data?.settings??settings,scenarioId:savedScenarioId,scenarioName:cleanName}},body:{programId,snapshotId:snapshot.id,expectedSnapshotId:snapshot.id,scenarioId:savedScenarioId,startDate,days,weekdays,requestId:crypto.randomUUID(),...(plan.data?.plan?{replacePlanId:plan.data.plan.id,replaceVersion:plan.data.plan.version}:{})}};
      }
      await api(`${prefix}/calculator-plan`,{method:'POST',body:pendingCalendar.current!.body});
      setSavedSchedule({startDate,days,weekdays});
      setSavedSettings(JSON.stringify(settings));
      const savedScenarioId=String(pendingCalendar.current!.body.scenarioId??scenarioId);
      const committed=pendingCalendar.current!.snapshot;
      pendingCalendar.current=null;setSnapshotConflict(false);setCalendarConflict(false);
      root.dispatchEvent(new CustomEvent('syntolk-calculator-saved',{detail:{settings:committed.data.settings,revision:committed.id}}));
      if(!admin){
        cache.setQueryData<{snapshots:Snapshot[]}>([...key,'snapshots',programId,'latest'],previous=>({snapshots:[committed,...(previous?.snapshots??[]).filter(s=>s.id!==committed.id)].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id))}));
        selection.rememberScenario(savedScenarioId);
        allowNavigation();setParams(previous=>{const next=new URLSearchParams(previous);next.set('programId',programId);next.set('scenarioId',savedScenarioId);return next;});
        setSavedNotice(`Сценарий «${committed.data.scenarioName}» сохранён`);
      }
      await cache.invalidateQueries({queryKey:admin?key:[...key,'calculator-plan']});
      await cache.invalidateQueries({queryKey:['links',partnerId]});
      await cache.invalidateQueries({queryKey:['coach-home-calendar',partnerId]});
      await cache.invalidateQueries({queryKey:['work-calendar',tenant,partnerId]});
      await cache.invalidateQueries({queryKey:['material-catalog',tenant,partnerId]});
      await invalidateAnalytics(cache);
      if(admin){allowNavigation();nav(`${base}/admin/coach?tab=partners&partnerId=${partnerId}&programId=${programId}&scenarioId=${encodeURIComponent(savedScenarioId)}`);}
    }catch(e){
      const code=(e as {detail?:{error?:string}})?.detail?.error;
      if(code==='snapshot_conflict'||code==='calendar_exists')pendingCalendar.current=null;
      setError(e as Error);await cache.invalidateQueries({queryKey:key});
    }finally{saving.current=false;setBusy(false);}
  };
  const switchScenario=(value:string)=>{
    setSavedNotice(null);
    selection.selectScenario(value);
  };
  const createScenario=(root:HTMLElement)=>{
    setSavedNotice(null);
    setCreateMode('new');
    createRootRef.current=root;
    setCreateName(`Сценарий ${scenarios.length+1}`);
    setCreateDialogError('');
    setCreateDialogOpen(true);
  };
  const confirmCreateScenario=()=>{
    const root=createRootRef.current;
    const cleanName=createName.trim();
    if(!cleanName){setCreateDialogError('Введите название сценария.');return;}
    if(createMode==='save'){setScenarioName(cleanName);setCreateDialogOpen(false);void save(cleanName);return;}
    if(!root){setCreateDialogError('Не удалось открыть калькулятор. Обновите страницу и попробуйте ещё раз.');return;}
    if((settingsChanged||scheduleChanged)&&!window.confirm('Начать новый сценарий? Несохранённый черновик текущего сценария останется в этом браузере.'))return;
    allowNavigation();
    // Naming the initial draft must not erase inputs entered before naming it.
    if(!isNewScenario||scenarioName.trim())root.dispatchEvent(new CustomEvent('syntolk-calculator-reset',{bubbles:true,detail:{persist:false,fresh:true}}));
    try {
      const resetSettings=JSON.parse(root.dataset.currentSettings??'null') as Record<string,unknown>|null;
      if(resetSettings)setNewScenarioSettings(resetSettings);
    } catch { setNewScenarioSettings(undefined); }
    setScenarioName(cleanName);
    setCurrentValuesActive(false);
    setNewScenarioId(`new-${Date.now()}-${Math.random().toString(36).slice(2,10)}`);
    setParams(previous=>{const next=new URLSearchParams(previous);next.set('scenarioId','new');return next;});
    setCreateDialogOpen(false);
    createRootRef.current=null;
  };
  const requestDeleteScenario=()=>{
    if(isNewScenario||busy)return;
    setError(null);
    setDeleteTarget({id:scenarioId,name:selectedScenario?.name??'Сценарий',programId,partnerId});
  };
  const deleteScenario=async()=>{
    if(!deleteTarget||busy||deleting.current||deleteTarget.id!==scenarioId||deleteTarget.programId!==programId||deleteTarget.partnerId!==partnerId)return;
    deleting.current=true;
    setBusy(true);setError(null);
    try{
      await api(`${prefix}/forecast-snapshots/${encodeURIComponent(deleteTarget.id)}?programId=${encodeURIComponent(deleteTarget.programId)}`,{method:'DELETE'});
      try{localStorage.removeItem(storageKey);}catch{/* Optional browser draft storage. */}
      await cache.invalidateQueries({queryKey:[...key,'snapshots',programId,'latest']});
      await cache.invalidateQueries({queryKey:[...key,'calculator-plan',programId]});
      selection.rememberScenario('all');
      await Promise.all([invalidateAnalytics(cache),cache.invalidateQueries({queryKey:['material-catalog',tenant,partnerId]}),cache.invalidateQueries({queryKey:['work-calendar',tenant,partnerId]}),cache.invalidateQueries({queryKey:['coach',tenant,partnerId]}),cache.invalidateQueries({queryKey:['partner-material',tenant,partnerId]}),cache.invalidateQueries({queryKey:['link-sources',partnerId]})]);
      setScenarioName('');
      setNewScenarioSettings(undefined);
      setNewScenarioId(`new-${Date.now()}-${Math.random().toString(36).slice(2,10)}`);
      setDeleteTarget(null);
      allowNavigation();setParams(previous=>{const next=new URLSearchParams(previous);next.set('scenarioId','new');return next;});
    }catch(e){setError(e as Error);}finally{deleting.current=false;setBusy(false);}
  };
  const disabled=missingScenario||busy||createDialogOpen||!programId||!draft||plan.isLoading||!!plan.error||(!admin&&(!activeScenarioName.trim()||!hasContent||!weekdays.length||!startDate||days<1||days>365));
  useEffect(()=>{if((scheduleChanged||settingsChanged)&&savedNotice)setSavedNotice(null);},[scheduleChanged,settingsChanged,savedNotice]);
  const reloadSaved=()=>{
    if(busy||!latest)return;
    if((settingsChanged||scheduleChanged)&&!window.confirm('Загрузить сохранённую версию? Несохранённые изменения этого сценария будут заменены.'))return;
    pendingCalendar.current=null;hydratedCalendar.current='';setSavedSchedule(null);setCalendarConflict(false);setSnapshotConflict(false);
    document.getElementById('partner-forecast')?.dispatchEvent(new CustomEvent('syntolk-calculator-load',{detail:{storageKey,settings:latest.data.settings,revision:latest.id,force:true}}));
    void plan.refetch();
  };
  const syncNotice=(snapshotConflict||calendarConflict)?<div className="coach-connection-info" role="status">Сценарий изменён в другом кабинете. Ваш черновик сохранён. <Button variant="secondary" size="sm" disabled={busy||!latest} onClick={reloadSaved}>Загрузить сохранённую версию</Button></div>:null;
  const saveLabel=busy?'Сохраняем…' :isNewScenario?'Сохранить сценарий':'Сохранить изменения';
  const saveAction=<div className="coach-actions calculator-save-actions">{admin?<Button disabled={disabled} onClick={()=>{void save();}}>{saveLabel}</Button>:<TremorButton data-op-variant="primary" disabled={disabled} onClick={()=>{void save();}} aria-label={saveLabel} title={!activeScenarioName.trim()?'Сначала создайте сценарий':!hasContent?'Добавьте контент и выберите площадки':saveLabel}><Save size={14}/>{saveLabel}</TremorButton>}</div>;
  const scenarioPicker=!admin?<div className="calculator-library-controls">
    <VisualSelect aria-label="Сохранённый сценарий" title={selectedScenario?.name} value={isNewScenario?'':scenarioId} disabled={busy||!scenarios.length} onChange={e=>{if(e.target.value)switchScenario(e.target.value);}}>
      <option value="" hidden disabled/>
      {scenarios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
    </VisualSelect>
    <DropdownMenu modal={false}><DropdownMenuTrigger asChild><TremorButton variant="secondary" aria-label="Управление выбранным сценарием" title="Управление сценарием" disabled={busy||isNewScenario}><Ellipsis size={16}/></TremorButton></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="calculator-library-menu">
        <DropdownMenuItem onSelect={()=>{const root=document.getElementById('partner-forecast');root?.querySelector<HTMLButtonElement>('[data-pf-tab="content"]')?.click();requestAnimationFrame(()=>{const input=root?.querySelector<HTMLInputElement>('.pf-format-frequency');input?.scrollIntoView({block:'center'});input?.focus({preventScroll:true});});}}><Pencil size={14}/>Изменить параметры</DropdownMenuItem>
        <DropdownMenuItem onSelect={()=>nav(`${base}/plan?programId=${encodeURIComponent(programId)}&scenarioId=${encodeURIComponent(scenarioId)}`)}><CalendarDays size={14}/>Открыть календарь</DropdownMenuItem>
        <DropdownMenuSeparator/>
        <DropdownMenuItem className="calculator-library-delete" onSelect={requestDeleteScenario}><Trash2 size={14}/>Удалить сценарий</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>:undefined;
  const scopePicker=<div className="coach calculator-intro">
    <ErrorBanner error={missingScenario?new Error('Сохранённый сценарий удалён или недоступен. Выберите другой сценарий или создайте новый; локальный черновик сохранён.'):calculatorError(partners.error??me.error??snapshots.error??plan.error)}/>{syncNotice}
    {admin&&<label className="coach-field"><span>Калькулятор партнёра</span><VisualSelect aria-label="Калькулятор партнёра" value={partnerId} onChange={e=>{setParams(previous=>{const next=new URLSearchParams(previous);next.set('partnerId',e.target.value);next.delete('programId');next.delete('scenarioId');return next;});}}><option value="">Предпросмотр без сохранения</option>{partners.data?.partners.map(p=><option key={p.id} value={p.id}>{p.name} — {p.email}</option>)}</VisualSelect></label>}
    {!!partnerId&&me.data?.programs.length!==1&&<label className="coach-field"><span>Партнёрская программа</span><VisualSelect aria-label="Партнёрская программа" value={programId} onChange={e=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('programId',e.target.value);next.delete('scenarioId');return next;})}>{me.data?.programs.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</VisualSelect></label>}
    {admin&&!!programId&&scenarios.length>0&&<div className="calculator-scenario-picker"><label className="coach-field"><span>Сохранённые сценарии</span><VisualSelect aria-label="Сохранённый сценарий" value={isNewScenario?'':scenarioId} onChange={e=>{if(e.target.value)switchScenario(e.target.value);}}><option value="" hidden disabled/>{scenarios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</VisualSelect></label>{!isNewScenario&&<div className="coach-actions"><Button variant="ghost" onClick={requestDeleteScenario} disabled={busy}>Удалить сценарий</Button></div>}</div>}
    {admin&&isNewScenario&&scenarioName&&<div className="calculator-new-scenario"><strong>Черновик: {scenarioName}</strong></div>}
    {admin&&!isNewScenario&&<p className="coach-muted">Сценарий «{selectedScenario?.name}» загружен. Изменения сохранятся в его новом календаре.</p>}
    {!admin&&<>
      <div className="calculator-scenario-heading-row">
        <div className="calculator-scenario-state" role="status" aria-live="polite">
          {(savedNotice||busy||isNewScenario||!editorEnabled)&&<span className="calculator-scenario-status" data-state={savedNotice?'saved':editorEnabled?'editing':'inactive'}>{savedNotice?<><Check size={12}/>Сохранено</>:busy?'Сохраняем…':editorEnabled?'Черновик':'Не активен'}</span>}
        </div>
        <TremorButton className="calculator-new-scenario-button" data-attention={!editorEnabled&&!!programId&&!busy&&!createDialogOpen?true:undefined} variant={editorEnabled?'secondary':'primary'} disabled={busy||!programId||createDialogOpen} onClick={()=>{const root=document.getElementById('partner-forecast');if(root)createScenario(root);}}><Plus size={14}/>{editorEnabled?'Новый сценарий':'Создать сценарий'}</TremorButton>
      </div>
      <div className="calculator-scenario-actions">{saveAction}{editorEnabled&&(scheduleChanged||settingsChanged)&&!busy&&<span className="calculator-save-hint" role="status">Изменения не сохранены</span>}</div>
      <ErrorBanner error={calculatorError(error??preview.error)}/>
    </>}
  </div>;
  const scenarioCreation=!admin&&createDialogOpen?<form className="calculator-create-inline" aria-label="Новый сценарий" onSubmit={event=>{event.preventDefault();confirmCreateScenario();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();closeScenarioDialog();}}}>
    <label className="coach-field"><span>Название сценария</span><input autoFocus maxLength={80} aria-label="Название сценария" value={createName} onChange={event=>{setCreateName(event.target.value);setCreateDialogError('');}}/></label>
    <div className="calculator-create-actions"><TremorButton type="submit" disabled={!createName.trim()}>Начать настройку</TremorButton><TremorButton type="button" variant="secondary" onClick={closeScenarioDialog}>Отмена</TremorButton></div>
    {createDialogError&&<p className="coach-warning" role="alert">{createDialogError}</p>}
  </form>:undefined;
  const planning=programId?<section className="coach calculator-planning" aria-label="Период рабочего сценария"><Card><fieldset disabled={!editorEnabled||busy} onChange={()=>setSavedNotice(null)}>
      <div className="coach-grid calculator-schedule-grid"><div className="coach-field"><span>Начало работы</span><DateInput label="Начало календаря" disabled={busy} value={startDate} onChange={value=>{setSavedNotice(null);setStartDate(value);setPreviewWeek(0);}}/></div><div className="coach-field"><span>План работ на</span><div className="calculator-period-options" role="group" aria-label="Период календаря">{periodOptions.map(([n,label])=><Button key={n} disabled={busy} variant={!customPeriod&&days===n?'primary':'secondary'} aria-pressed={!customPeriod&&days===n} onClick={()=>{setSavedNotice(null);setCustomPeriod(false);setDays(n);setPreviewWeek(0);}}>{label}</Button>)}<ResultsDatePicker label="Свой срок" disabled={busy} caption="Свой срок" triggerClassName={customPeriod?'is-active':''} value={{from:startDate,to:endOfPeriod(startDate,days)}} allowFuture maxRangeDays={365} onChange={range=>{setSavedNotice(null);setStartDate(range.from);setDays(Math.round((Date.parse(range.to)-Date.parse(range.from))/86400000)+1);setCustomPeriod(true);setPreviewWeek(0);}}/></div></div><div className="coach-row calculator-schedule-weekdays"><span className="coach-muted">Рабочие дни</span><div className="coach-actions" role="group" aria-label="Рабочие дни">{[[1,'Пн'],[2,'Вт'],[3,'Ср'],[4,'Чт'],[5,'Пт'],[6,'Сб'],[0,'Вс']].map(([day,label])=><Button key={day} disabled={busy} variant={weekdays.includes(Number(day))?'primary':'secondary'} aria-pressed={weekdays.includes(Number(day))} onClick={()=>{setSavedNotice(null);setWeekdays(current=>current.includes(Number(day))?current.filter(d=>d!==day):[...current,Number(day)]);}}>{label}</Button>)}</div></div>{startDate&&endOfPeriod(startDate,days)&&<div className="calculator-period-range">с {startDate.split('-').reverse().join('.')} по {endOfPeriod(startDate,days).split('-').reverse().join('.')}</div>}</div>
  </fieldset></Card></section>:null;
  const connection=<section className="coach calculator-connection" aria-label="Сохранение сценария и календарь"><Card>
    {programId?<><h2>Работы по этому сценарию</h2>
      {!hasContent?<p className="coach-muted">Укажите количество материалов и выберите площадки — здесь появится план нового сценария.</p>:preview.data&&!!weekdays.length?<><p className="coach-plan-summary">За {days} дней: <strong>{preview.data.originals} материалов</strong> · {preview.data.placements} размещений<span hidden={!admin&&currentValuesActive}> · ≈ {Math.round(preview.data.views).toLocaleString('ru-RU')} просмотров по вашим значениям</span>.</p><details className="calculator-preview"><summary>Посмотреть распределение по дням</summary><label className="coach-field"><span>Неделя плана</span><VisualSelect aria-label="Неделя предварительного плана" value={Math.min(previewWeek,Math.ceil(days/7)-1)} onChange={e=>setPreviewWeek(Number(e.target.value))}>{Array.from({length:Math.ceil(days/7)},(_,i)=><option key={i} value={i}>{i+1}</option>)}</VisualSelect></label><ul>{preview.data.tasks.filter(t=>{const offset=Math.round((Date.parse(t.day)-Date.parse(startDate))/86400000);return offset>=previewWeek*7&&offset<(previewWeek+1)*7;}).map(task=><li key={task.key}><span>{dateLabel(task.day)}</span><div><strong>{task.title}</strong><small>{task.placements.map(p=>p.name).join(', ')}</small></div></li>)}</ul>{!preview.data.tasks.some(t=>{const offset=Math.round((Date.parse(t.day)-Date.parse(startDate))/86400000);return offset>=previewWeek*7&&offset<(previewWeek+1)*7;})&&<p className="coach-muted">На этой неделе материалов по заданной частоте нет.</p>}</details></>:<p className="coach-muted">{preview.isFetching?'Рассчитываем объём работ…':'План появится после выбора контента, площадок и рабочих дней.'}</p>}
      {admin&&<ErrorBanner error={calculatorError(error)}/>}
      {admin&&saveAction}
      <p className="coach-muted">Один материал — одна задача с выбранными площадками. Календарь распределит публикации по выбранным дням.</p>
      {plan.data?.plan&&<p className="coach-muted">Перестроение заменяет незавершённые шаги новым сценарием. История выполненных шагов и финансовый учёт сохраняются.</p>}
      {latest&&<small className="coach-muted">Последнее сохранение «{selectedScenario?.name}»: {new Date(latest.createdAt).toLocaleString('ru-RU')}</small>}
    </>:<p className="coach-muted">{admin?'Выберите партнёра, чтобы сохранить его сценарий и создать календарь.':'Администратору нужно назначить вам партнёрскую программу.'}</p>}
  </Card></section>;
  if(partnerId&&(me.isLoading||(programId&&snapshots.isLoading)))return <Page title="Калькулятор"><Card>Загружаем сохранённый сценарий…</Card></Page>;
  return <>
    <CalculatorPage principal={principal} scope={{key:storageKey,settings:isNewScenario?newScenarioSettings:latest?.data.settings,revision:latest?.id,holdRemote:busy||scheduleChanged||!!pendingCalendar.current}} onCreateScenario={createScenario} intro={scopePicker} scenarioPicker={scenarioPicker} scenarioCreation={scenarioCreation} editable={editorEnabled&&!busy&&!createDialogOpen} onEdit={()=>setSavedNotice(null)} planning={planning} connection={connection}
      onCurrentValuesChange={setCurrentValuesActive}
      currentValues={!admin?(root)=><CalculatorCurrentValues partnerId={partnerId} programId={programId} scenarioId={storageScenarioKey} scenarioName={activeScenarioName||'Текущий сценарий'} active={currentValuesActive} filter={currentValuesFilter} onFilter={setCurrentValuesFilter} root={root}/>:undefined}/>
    {deleteTarget&&<CalendarDialog title={`Удалить «${deleteTarget.name}»?`} close={()=>{if(!busy)setDeleteTarget(null);}}>
      <div className="calculator-delete-warning">
        <p className="calculator-delete-consequence">Календарь, материалы, тексты и файлы этого сценария будут удалены без возможности восстановления.</p>
        <p>Созданные и опубликованные ссылки останутся в «Публикациях и ссылках». Статистика, партнёрские начисления и выплаты сохранятся.</p>
        <p className="calculator-delete-independent">Материалы без сценария останутся.</p>
        <ErrorBanner error={calculatorError(error)}/>
        <div className="calculator-delete-actions"><Button variant="secondary" disabled={busy} onClick={()=>setDeleteTarget(null)}>Отмена</Button><Button variant="danger" disabled={busy} onClick={()=>{void deleteScenario();}}>{busy?'Удаляем…':'Удалить'}</Button></div>
      </div>
    </CalendarDialog>}
    {admin&&createDialogOpen&&<div className="calculator-scenario-dialog-backdrop" role="presentation">
      <section className="calculator-scenario-dialog" role="dialog" aria-modal="true" aria-labelledby="calculator-scenario-dialog-title" onKeyDown={event=>{if(event.key==='Escape')closeScenarioDialog();}}>
        <h2 id="calculator-scenario-dialog-title">{createMode==='new'?'Новый сценарий':'Название сценария'}</h2>
        <label className="coach-field"><span>Название</span><input autoFocus maxLength={80} aria-label="Название сценария" value={createName} onChange={event=>{setCreateName(event.target.value);setCreateDialogError('');}} onKeyDown={event=>{if(event.key==='Enter')confirmCreateScenario();if(event.key==='Escape'){setCreateDialogOpen(false);createRootRef.current=null;}}}/></label>
        {createDialogError&&<p className="coach-warning" role="alert">{createDialogError}</p>}
        <div className="coach-actions calculator-scenario-dialog-actions"><Button variant="secondary" onClick={()=>{setCreateDialogOpen(false);createRootRef.current=null;}}>Отмена</Button><Button onClick={confirmCreateScenario}>{createMode==='save'?'Сохранить и составить план':'Начать настройку'}</Button></div>
      </section>
    </div>}
  </>;
}
