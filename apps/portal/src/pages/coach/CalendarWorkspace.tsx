import {useEffect,useRef,useState,type DragEvent} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Link,useSearchParams} from 'react-router-dom';
import {CirclePlay,FileText,Film,Upload,Plus,Paperclip,FolderOpen,SlidersHorizontal,Search,Check,ArrowUpRight} from 'lucide-react';
import {api,currentTenantSlug} from '../../api.js';
import {Button,ErrorBanner,Input} from '../../ui.js';
import {VisualSelect} from '../../components/tremor/VisualControls.js';
import {usePartnerSelection} from '../../lib/partner-selection.js';
import {useTenantBase} from '../../tenant-base.js';
import {materialError} from '../MaterialEditor.js';
import {invalidateAnalytics} from '../results-scope.js';
import {HomePeriodTabs} from '../PartnerHome.js';
import {ResultsDatePicker,validDateRange,type DateChoice} from '../ResultsDatePicker.js';
import type {WorkdayPeriod} from '../partner-workday-data.js';
import {CreateMaterials,MaterialDrawer,type Catalog} from './CalendarMaterialDialogs.js';
import {addDays,weekStart,calendarRange,calendarDateRange,calendarSummary,dateLabel,filterCalendar,statusLabels,type CalendarData,type CalendarMaterial} from './work-calendar-model.js';
import './work-calendar.css';

const calendarDateFields=['period','day','week','month','from','to'] as const;
function calendarDateSelection(params:URLSearchParams,preferenceKey:string){
  if(calendarDateFields.some(field=>params.has(field)))return params;
  try{return new URLSearchParams(localStorage.getItem(preferenceKey)??'');}catch{return new URLSearchParams();}
}

export function PartnerWorkCalendar({partnerId}:{partnerId:string}){
  const tenant=currentTenantSlug(),cache=useQueryClient(),base=useTenantBase(),[params,setParams]=useSearchParams();
  const root=['work-calendar',tenant,partnerId];
  const me=useQuery({queryKey:['coach',tenant,partnerId,'/coach/me','me'],queryFn:()=>api<{programs:Array<{id:string;name:string}>}>('/coach/me')});
  const selection=usePartnerSelection(partnerId,me.data?.programs??[]),programId=selection.programId;
  const scenario=selection.scenarioId&&selection.scenarioId!=='new'?selection.scenarioId:'all';
  const catalog=useQuery({queryKey:['material-catalog',tenant,partnerId,programId,scenario],enabled:!!programId,queryFn:()=>api<Catalog>(`/partners/${partnerId}/material-catalog?programId=${encodeURIComponent(programId)}${scenario!=='all'?`&scenarioId=${encodeURIComponent(scenario)}`:''}`)});
  const query=useQuery({queryKey:[...root,programId,scenario],enabled:!!programId,queryFn:()=>api<CalendarData>(`/partners/${partnerId}/work-calendar?programId=${encodeURIComponent(programId)}${scenario!=='all'?`&scenarioId=${encodeURIComponent(scenario)}`:''}`),refetchInterval:30000});
  useEffect(()=>{
    if(!programId||scenario==='all'||scenario==='__none__'||!catalog.isSuccess||catalog.isFetching)return;
    if(!catalog.data.scenarios.some(item=>item.id===scenario&&item.programId===programId))selection.selectScenario('all');
  },[programId,scenario,catalog.data,catalog.isSuccess,catalog.isFetching]);
  const today=query.data?.today??new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
  const view=params.get('section')==='materials'?'materials':'plan';
  const periodPreferenceKey=`syntolk-work-calendar-period:${tenant??'default'}:${partnerId}`;
  const dateParams=calendarDateSelection(params,periodPreferenceKey);
  const requestedDay=dateParams.get('day')??dateParams.get('week')??(dateParams.get('month')?dateParams.get('month')+'-01':'');
  const selectedPeriod:WorkdayPeriod=dateParams.get('period')==='month'||dateParams.has('month')?'custom':['today','7d','30d','all','custom'].includes(dateParams.get('period')??'')?dateParams.get('period') as WorkdayPeriod:dateParams.has('week')||['week','list'].includes(dateParams.get('period')??'')?'7d':dateParams.has('from')||dateParams.has('to')||requestedDay&&requestedDay!==today?'custom':'today';
  const periodPreference=new URLSearchParams();
  for(const field of calendarDateFields){const value=dateParams.get(field);if(value&&(selectedPeriod!=='today'||field==='period'))periodPreference.set(field,value);}
  periodPreference.set('period',selectedPeriod);
  const periodPreferenceValue=periodPreference.toString();
  const dayOnlyLink=params.has('day')&&!calendarDateFields.some(field=>field!=='day'&&params.has(field));
  useEffect(()=>{if(dayOnlyLink)return;try{localStorage.setItem(periodPreferenceKey,periodPreferenceValue);}catch{/* The URL remains usable when storage is unavailable. */}},[periodPreferenceKey,periodPreferenceValue,dayOnlyLink]);
  const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[format,setFormat]=useState(''),[showAssigned,setShowAssigned]=useState(false);
  const [opened,setOpened]=useState<string|null>(params.get('materialId')),[create,setCreate]=useState<'single'|'batch'|null>(null),[newDay,setNewDay]=useState(''),[error,setError]=useState<unknown>(null),[moving,setMoving]=useState(false);
  const calendarScope=JSON.stringify([programId,scenario]),previousScope=useRef(programId?calendarScope:null);
  useEffect(()=>{if(!programId||previousScope.current===calendarScope)return;if(previousScope.current===null){previousScope.current=calendarScope;return;}previousScope.current=calendarScope;setFormat('');setOpened(null);setCreate(null);},[calendarScope,programId]);
  const filterMenu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{const outside=(event:PointerEvent)=>{const menu=filterMenu.current;if(menu?.open&&!menu.contains(event.target as Node))menu.open=false;};const escape=(event:KeyboardEvent)=>{const menu=filterMenu.current;if(event.key==='Escape'&&menu?.open){menu.open=false;menu.querySelector('summary')?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[]);
  useEffect(()=>{const id=params.get('materialId');if(id)setOpened(id);},[params.get('materialId')]);
  const all=query.data?.materials??[];
  const day=validDateRange({from:requestedDay,to:requestedDay})?requestedDay:today,customRange={from:dateParams.get('from')??(dateParams.has('day')?day:''),to:dateParams.get('to')??(dateParams.has('day')?day:'')};
  const plans=(query.data?.plans??[]).filter(plan=>scenario==='all'||plan.scenarioId===scenario);
  const starts=[...all.flatMap(m=>m.scheduledDay?[m.scheduledDay]:[]),...plans.map(plan=>plan.startDate)].sort();
  const ends=[...all.flatMap(m=>m.scheduledDay?[m.scheduledDay]:[]),...plans.map(plan=>addDays(plan.startDate,plan.days-1))].sort();
  const range=selectedPeriod==='today'?calendarRange(today,'today'):selectedPeriod==='custom'&&validDateRange(customRange)?customRange.from===customRange.to?calendarRange(customRange.from,'today'):calendarDateRange(customRange.from,customRange.to):selectedPeriod==='custom'?calendarRange(day,'month'):selectedPeriod==='all'?calendarDateRange(starts[0]??weekStart(day),ends.at(-1)??addDays(weekStart(day),6)):selectedPeriod==='30d'?calendarDateRange(day,addDays(day,29)):calendarRange(day,'week');
  const mode=range.days.length===1?'today':range.days.length===7?'week':'month';
  const filtered=filterCalendar(all,search,status,format),period=filtered.filter(m=>m.scheduledDay&&m.scheduledDay>=range.start&&m.scheduledDay<=range.end),summary=calendarSummary(period);
  const buffer=filtered.filter(m=>!m.scheduledDay),library=showAssigned?filtered.filter(m=>!m.scheduledDay||m.scheduledDay>=range.start&&m.scheduledDay<=range.end):buffer;
  const refresh=async()=>{await Promise.all([cache.invalidateQueries({queryKey:root}),cache.invalidateQueries({queryKey:['coach',tenant,partnerId]}),invalidateAnalytics(cache)]);};
  const openCreate=(kind:'single'|'batch',date='')=>{setNewDay(date);setCreate(kind);};
  const closeMaterial=()=>{setOpened(null);if(params.has('materialId'))setParams(previous=>{const next=new URLSearchParams(previous);next.delete('materialId');return next;},{replace:true});};
  const choosePeriod=(value:WorkdayPeriod,nextDay?:string,dates?:DateChoice)=>{setParams(previous=>{const next=new URLSearchParams(previous);next.set('period',value);for(const key of ['day','week','month','from','to'])next.delete(key);if(nextDay)next.set('day',nextDay);if(dates){next.set('from',dates.from);next.set('to',dates.to);}return next;});};
  const changeView=(value:string)=>{setParams(previous=>{const next=new URLSearchParams(previous);if(value==='materials')next.set('section','materials');else next.delete('section');return next;});};
  const move=async(id:string,date:string|null)=>{const item=all.find(m=>m.id===id);if(!item||item.scheduledDay===date||moving)return;setMoving(true);setError(null);try{await api(`/partners/${partnerId}/materials/${id}/workspace`,{method:'PATCH',body:{revision:item.revision,scheduledDay:date}});}catch(e){setError(e);}finally{await refresh();setMoving(false);}};
  const drop=(event:DragEvent,date:string|null)=>{event.preventDefault();const id=event.dataTransfer.getData('application/x-syntolk-material');if(id)void move(id,date);};
  const attach=async(event:DragEvent,target:CalendarMaterial)=>{
    event.preventDefault();event.stopPropagation();const source=all.find(m=>m.id===event.dataTransfer.getData('application/x-syntolk-material'));
    if(!source||source.id===target.id||moving)return;
    if(source.scheduledDay){void move(source.id,target.scheduledDay);return;}
    if(!window.confirm(`Прикрепить «${source.title}» к задаче «${target.title}»?`))return;
    setMoving(true);setError(null);try{await api(`/partners/${partnerId}/materials/${source.id}/assign`,{method:'POST',body:{revision:source.revision,targetId:target.id,targetRevision:target.revision}});setOpened(target.id);}catch(e){setError(e);}finally{await refresh();setMoving(false);}
  };
  const scenarioLabel=scenario==='all'?'Весь контент':scenario==='__none__'?'Без сценария':catalog.data?.scenarios.find(s=>s.id===scenario)?.name??query.data?.plans.find(p=>p.scenarioId===scenario)?.scenarioName??'Сценарий';
  return <div className="work-calendar wc-modern">
    <header className="wc-header"><div><h1>Календарь работ · {scenarioLabel}</h1></div><div className="wc-header-tools"><div className="wc-period-controls"><HomePeriodTabs includeToday period={selectedPeriod} onChange={value=>choosePeriod(value)} label="Период календаря"/><ResultsDatePicker label="Выбрать даты календаря" calendarLabel="Период календаря" value={{from:range.start,to:range.end}} caption={range.start===range.end?dateLabel(range.start,{day:'numeric',month:'long',year:'numeric'}):`${dateLabel(range.start)} — ${dateLabel(range.end)}`} allowFuture onChange={value=>choosePeriod('custom',undefined,value)}/></div><div className="wc-actions"><Button icon={<Plus size={16}/>} disabled={!programId} onClick={()=>openCreate('single')}>Добавить материал</Button></div></div></header>
    <ErrorBanner error={materialError(error??me.error??query.error??catalog.error)}/>
    {!me.isLoading&&!programId?<div className="wc-empty">Администратору нужно назначить партнёрскую программу.</div>:<>
      <div className="wc-workspace-nav"><nav aria-label="Раздел календаря"><button aria-pressed={view==='plan'} onClick={()=>changeView('plan')}>План</button><button aria-pressed={view==='materials'} onClick={()=>changeView('materials')}>Материалы <span>{all.filter(m=>!m.scheduledDay).length}</span></button></nav>
        <div className="wc-local-controls">
        <details ref={filterMenu} className="wc-filter-menu"><summary><SlidersHorizontal size={14}/>Фильтры{(status||format||scenario!=='all'||search)&&<i/>}</summary><div>
          {me.data?.programs.length!==1&&<label className="wc-field"><span>Программа</span><VisualSelect aria-label="Программа календаря" value={programId} onChange={e=>selection.selectProgram(e.target.value)}>{me.data?.programs.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</VisualSelect></label>}
          <label className="wc-field"><span>Сценарий</span><VisualSelect aria-label="Сценарий календаря" value={scenario} onChange={e=>selection.selectScenario(e.target.value)}><option value="all">Весь контент</option><option value="__none__">Без сценария</option>{catalog.data?.scenarios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</VisualSelect></label>
          <label className="wc-field"><span>Формат</span><VisualSelect aria-label="Формат материала" value={format} onChange={e=>setFormat(e.target.value)}><option value="">Все форматы</option>{catalog.data?.formats.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</VisualSelect></label>
          <label className="wc-field"><span>Статус</span><VisualSelect aria-label="Статус материала" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Все статусы</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</VisualSelect></label>
          <label className="wc-field"><span>Поиск</span><span className="wc-search"><Search size={14}/><Input aria-label="Поиск материалов" placeholder="Название или площадка" value={search} onChange={e=>setSearch(e.target.value)}/></span></label>
          <Button size="sm" variant="ghost" onClick={()=>{setSearch('');setStatus('');setFormat('');if(scenario!=='all')selection.selectScenario('all');}}>Сбросить отбор</Button>
        </div></details></div>
      </div>
      {query.isLoading?<div className="wc-empty" role="status">Загружаем материалы…</div>:view==='plan'?<>
        <section className="wc-compact-summary" aria-label="Сводка календаря"><span><strong>{Math.round((Date.parse(range.end)-Date.parse(range.start))/86400000)+1}</strong> {range.start===range.end?'день':'дней'}</span><span><strong>{summary.materials}</strong> материалов</span><span><strong>{summary.placements}</strong> размещений</span><span><strong>{summary.ready}</strong> подготовлено</span><span className="wc-summary-published"><Check size={13}/>{summary.published} из {summary.placements} опубликовано</span></section>
        <div className={`wc-grid wc-grid--${mode}`} aria-label="Календарь выбранного периода">
          {mode!=='today'&&<div className="wc-weekdays">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=><span key={d}>{d}</span>)}</div>}
          <div className="wc-days">{range.days.map(date=>{
            const inRange=date>=range.start&&date<=range.end,items=period.filter(m=>m.scheduledDay===date);
            if(mode==='today')items.sort((a,b)=>(a.scheduledTime??'99:99').localeCompare(b.scheduledTime??'99:99'));
            return <section key={date} className={`wc-day${date===today?' wc-day--today':''}${!inRange?' wc-day--outside':''}`} aria-label={dateLabel(date,{day:'numeric',month:'long',year:'numeric'})} onDragOver={e=>{if(inRange)e.preventDefault();}} onDrop={e=>{if(inRange)drop(e,date);}}>
              <header><span className="wc-day-date">{mode==='today'?dateLabel(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'}):mode==='week'?dateLabel(date,{weekday:'short',day:'numeric',month:'short'}):dateLabel(date)}</span>{inRange&&<button className="wc-day-add" aria-label={`Добавить материал на ${date}`} onClick={()=>openCreate('single',date)}><Plus size={15}/></button>}</header>
              {items.slice(0,mode==='today'?items.length:mode==='week'?30:3).map(m=><EventCard key={m.id} material={m} open={()=>setOpened(m.id)} attach={e=>void attach(e,m)}/>)}
              {mode==='today'&&!items.length&&<p className="wc-today-empty">На этот день материалов нет.</p>}
              {items.length>3&&mode==='month'&&<button className="wc-more" onClick={()=>{choosePeriod('7d',weekStart(date));}}>Ещё {items.length-3}</button>}
            </section>;
          })}</div>
        </div>
        <button className="wc-open-stock" onClick={()=>changeView('materials')}><FolderOpen size={17}/>Материалы без даты <b>{buffer.length}</b><span>Распределить по дням →</span></button>
        {!all.length&&<div className="wc-start"><Link to={`${base}/calculator?programId=${programId}`}>Создать план в калькуляторе <ArrowUpRight size={14}/></Link></div>}
      </>:<>
        <div className="wc-library-toolbar"><label><input type="checkbox" checked={showAssigned} onChange={e=>setShowAssigned(e.target.checked)}/> Показать назначенные</label><Button variant="secondary" size="sm" icon={<Upload size={14}/>} onClick={()=>openCreate('batch')}>Загрузить файлы</Button></div>
        <div className="wc-material-library" onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,null)}>{library.length?library.map(m=><button className="wc-library-item" key={m.id} draggable onDragStart={e=>e.dataTransfer.setData('application/x-syntolk-material',m.id)} onClick={()=>setOpened(m.id)}><span className="wc-library-icon">{['short','long','circle'].includes(m.formatId)?<Film size={19}/>:<FileText size={19}/>}</span><span><strong>{m.title}</strong><small>{m.fileCount} файлов · {m.scheduledDay?dateLabel(m.scheduledDay):'Без даты'} · {statusLabels[m.status]}</small></span><span className="wc-library-assign">{m.scheduledDay?'Открыть':'Назначить день'} <ArrowUpRight size={14}/></span></button>):<div className="wc-empty"><FolderOpen/><strong>Запас материалов</strong><p>Загрузите файлы и текст. День публикации можно назначить позже.</p><Button variant="secondary" onClick={()=>openCreate('batch')}>Загрузить файлы</Button></div>}</div>
      </>}
    </>}
    {create&&catalog.data&&<CreateMaterials key={`${create}-${programId}`} partnerId={partnerId} programId={programId} scenarioId={scenario==='all'||scenario==='__none__'?'':scenario} day={newDay} catalog={catalog.data} batch={create==='batch'} close={()=>setCreate(null)} refresh={refresh} open={id=>{setCreate(null);setOpened(id);}}/>}
    {opened&&<MaterialDrawer key={opened} partnerId={partnerId} id={opened} allMaterials={all} close={closeMaterial} refresh={refresh} open={setOpened}/>}
  </div>;
}
function EventCard({material:m,open,attach}:{material:CalendarMaterial;open:()=>void;attach:(event:DragEvent)=>void}){
  const label=m.status==='draft'?'Подготовить':m.status==='waiting'?'Готов':statusLabels[m.status];
  const Icon=m.formatId==='circle'?CirclePlay:['short','long'].includes(m.formatId)?Film:FileText;
  return <button className="wc-event" data-format={m.formatId} draggable onDragStart={e=>{e.dataTransfer.setData('application/x-syntolk-material',m.id);e.dataTransfer.effectAllowed='move';}} onDragOver={e=>e.preventDefault()} onDrop={attach} onClick={open} title={`${m.title} · ${m.formatName} · ${label}`}><span className="wc-event-heading"><Icon className="wc-event-format-icon" size={16} aria-label={m.formatName}/><span className="wc-event-title">{m.title}</span></span><small className="wc-event-platforms">{m.platforms.map(p=>p.name).join(', ')||m.formatName}</small><span className={`wc-event-status wc-${m.status}`}><i className={`wc-dot wc-${m.status}`}/>{label}</span><small className="wc-event-files">{m.fileCount>0?<><Paperclip size={12}/>{m.fileCount} файлов</>:'Нет файлов'}{m.scheduledTime?` · ${m.scheduledTime}`:''}</small></button>;
}
