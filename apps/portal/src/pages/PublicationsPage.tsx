import {VisualButton,VisualSelect} from '../components/tremor/VisualControls.js';
import { VisualTable, VisualTableHead, VisualTableHeader, VisualTableBody, VisualTableRow, VisualTableCell } from '../components/tremor/VisualTable.js';
import {Fragment,useEffect,useState,type CSSProperties,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useSearchParams} from 'react-router-dom';
import {BarChart3,Check,ChevronDown,ChevronLeft,ChevronRight,Copy,Download,ExternalLink,FilePlus2,Link2,Plus,RefreshCw,Search} from 'lucide-react';
import {api,currentTenantSlug} from '../api.js';
import {Page,ErrorBanner} from '../ui.js';
import {theme} from '../theme.js';
import {TenantLink} from '../tenant-link.js';
import {trackingShareUrl} from '../lib/share-links.js';
import {usePartnerSelection} from '../lib/partner-selection.js';
import type {AnalyticsReport} from './PartnerAnalytics.js';
import {ResultsDatePicker,applyResultsPeriods,calendarDay,clearResultsComparison,reportRange,validDateRange,type DateChoice,type ResultsPeriod} from './ResultsDatePicker.js';
import {ResultsDrawer,dateLabel} from './ResultsDetails.js';
import {MaterialEditor} from './MaterialEditor.js';
import {CreatePublication} from './CreatePublication.js';
import {PublicationMetricCell} from './PublicationMetricCell.js';
import {measuredPublication,publicationMetrics,publicationRow,publicationSummary,publicationValue,publicationsCsv,type LinkStatistics,type PublicationSource} from './publications-model.js';
import './results.css';
import './publications.css';
import {Tabs,TabsList,TabsTrigger} from '../components/tremor/raw/components/Tabs/Tabs.js';

const safeHref=(value:string|null)=>{try{const url=new URL(value??'');return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const number=(value:number)=>value.toLocaleString('ru-RU');
const presetRange=(period:ResultsPeriod,today:string):DateChoice=>{const start=new Date(today+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-(period==='7d'?6:period==='30d'?29:0));return {from:period==='all'?'2000-01-01':start.toISOString().slice(0,10),to:today};};
const publicationTheme={'--pub-surface':theme.surface,'--pub-raised':theme.surface2,'--pub-border':theme.border,'--pub-muted':theme.textMuted,'--pub-text':theme.text,'--pub-accent':theme.accent} as CSSProperties;

export interface PermanentLinksMode {creationOnly?:boolean;onClose?:()=>void}
export function PartnerPublicationsPage({partnerId,permanentLinks}:{partnerId:string;permanentLinks:(stats:LinkStatistics,mode?:PermanentLinksMode)=>ReactNode}){
  const tenant=currentTenantSlug(),cache=useQueryClient(),[params,setParams]=useSearchParams();
  const view=params.get('view')==='links'?'links':'publications';
  // Old creation deep links still open a form; a plain /links always opens analytics.
  const section=params.get('section')==='create'?'create':params.get('section')==='analytics'?'analytics':['publication','partner'].includes(params.get('create')??'')?'create':'analytics';
  const creationType=params.get('create')==='partner'?'partner':'publication';
  const programs=useQuery({queryKey:['me-campaigns',tenant,partnerId],queryFn:()=>api<{programs:Array<{id:string;name:string}>}>('/me/programs')});
  const selection=usePartnerSelection(partnerId,programs.data?.programs??[]),programId=selection.programId;
  const period:ResultsPeriod=['today','7d','30d','all','custom'].includes(params.get('period')??'')?params.get('period') as ResultsPeriod:'30d';
  const from=params.get('from')??'',to=params.get('to')??'',compareFrom=params.get('compareFrom')??'',compareTo=params.get('compareTo')??'';
  const customReady=period!=='custom'||validDateRange({from,to});
  const comparing=params.get('compare')==='true'&&validDateRange({from:compareFrom,to:compareTo});
  const query=new URLSearchParams({programId,groupBy:view==='links'?'link':'source',period,currency:'RUB'});
  if(period==='custom'){query.set('from',from);query.set('to',to);}
  if(view==='publications')for(const field of ['platformId','formatId'])if(params.get(field))query.set(field,params.get(field)!);
  const previousQuery=new URLSearchParams(query);previousQuery.set('period','custom');previousQuery.set('from',compareFrom);previousQuery.set('to',compareTo);
  const enabled=section==='analytics'&&!!programId&&customReady;
  const report=useQuery({queryKey:['partner-analytics',tenant,partnerId,query.toString()],queryFn:()=>api<AnalyticsReport>(`/partners/${partnerId}/analytics?${query}`),enabled,refetchInterval:30000,refetchOnWindowFocus:true});
  const comparison=useQuery({queryKey:['partner-analytics',tenant,partnerId,previousQuery.toString()],queryFn:()=>api<AnalyticsReport>(`/partners/${partnerId}/analytics?${previousQuery}`),enabled:enabled&&comparing,refetchInterval:30000,refetchOnWindowFocus:true});
  const sources=useQuery({queryKey:['link-sources',partnerId,tenant,programId],queryFn:()=>api<{sources:PublicationSource[]}>(`/partners/${partnerId}/link-sources?programId=${encodeURIComponent(programId)}`),enabled:section==='analytics'&&!!programId&&view==='publications',refetchInterval:30000,refetchOnWindowFocus:true});
  const data=customReady?report.data:undefined,previous=comparing?comparison.data:undefined;
  const timezone=data?.timezone??'Europe/Moscow',today=calendarDay(new Date().toISOString(),timezone);
  const primaryRange:DateChoice=period==='custom'&&from&&to?{from,to}:reportRange(data?.period,timezone)??presetRange(period,today);
  const comparisonRange={from:compareFrom,to:compareTo};
  const currentRows=new Map(data?.rows.map(row=>[row.id,row])??[]),previousRows=new Map(previous?.rows.map(row=>[row.id,row])??[]);
  const [expanded,setExpanded]=useState<string|null>(null),[editing,setEditing]=useState<string|null>(null),[details,setDetails]=useState<PublicationSource|null>(null),[copied,setCopied]=useState(''),[copyFallback,setCopyFallback]=useState(''),[downloadError,setDownloadError]=useState<Error|null>(null);
  useEffect(()=>{setExpanded(null);setEditing(null);setDetails(null);setCopied('');setCopyFallback('');},[partnerId,programId,view]);
  useEffect(()=>{setDetails(null);},[query.toString()]);
  const update=(field:string,value:string)=>setParams(current=>{const next=new URLSearchParams(current);if(value)next.set(field,value);else next.delete(field);if(field!=='page')next.delete('page');return next;});
  const switchView=(value:string)=>setParams(current=>{const next=new URLSearchParams(current);next.set('view',value);next.delete('page');return next;});
  const applyPeriods=(main:DateChoice,comp:DateChoice|null)=>setParams(current=>{const next=applyResultsPeriods(current,main,comp);next.delete('page');return next;});
  const inventory=sources.data?.sources??[],search=(params.get('search')??'').trim().toLocaleLowerCase('ru-RU');
  const platform=params.get('platformId')??'',format=params.get('formatId')??'';
  const status=['published','draft','all'].includes(params.get('publicationStatus')??'')?params.get('publicationStatus')!:'published',activity=['all','results','empty'].includes(params.get('activity')??'')?params.get('activity')!:'all',publishedDuring=params.get('publishedDuring')==='period',sort=['date','clicks','payments','earnings'].includes(params.get('sort')??'')?params.get('sort')!:'date';
  const filtered=inventory.filter(source=>{
    if(platform&&source.platformId!==platform||format&&source.formatId!==format)return false;
    if(status==='published'&&!source.publishedAt||status==='draft'&&source.publishedAt)return false;
    if(publishedDuring&&(!source.publishedAt||calendarDay(source.publishedAt,timezone)<primaryRange.from||calendarDay(source.publishedAt,timezone)>primaryRange.to))return false;
    if(data&&activity==='results'&&!measuredPublication(currentRows.get(source.id))||data&&activity==='empty'&&measuredPublication(currentRows.get(source.id)))return false;
    return !search||[source.materialTitle,source.platformName,source.formatName,source.channelName,source.publicationUrl,source.linkKey,source.scenarioName].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU').includes(search);
  }).sort((a,b)=>(sort==='date'?0:publicationValue(currentRows.get(b.id),sort==='earnings'?'earnings':sort==='payments'?'payments':'clicks')-publicationValue(currentRows.get(a.id),sort==='earnings'?'earnings':sort==='payments'?'payments':'clicks'))||(b.publishedAt??b.createdAt).localeCompare(a.publishedAt??a.createdAt)||a.id.localeCompare(b.id));
  const summary=publicationSummary(filtered,status==='draft'),platforms=new Map(inventory.map(source=>[source.platformId,source.platformName])),formats=new Map(inventory.map(source=>[source.formatId,source.formatName]));
  const optionOwner=JSON.stringify([tenant,partnerId,programId]),[lastOptions,setLastOptions]=useState<{owner:string;options:AnalyticsReport['options']}|null>(null);
  useEffect(()=>{if(data?.options)setLastOptions({owner:optionOwner,options:data.options});},[data,optionOwner]);
  const options=data?.options??(lastOptions?.owner===optionOwner?lastOptions.options:undefined);
  for(const option of options?.platforms??[])platforms.set(option.id,option.name);for(const option of options?.formats??[])formats.set(option.id,option.name);
  const pageSize=25,pageCount=Math.max(1,Math.ceil(filtered.length/pageSize)),page=Math.max(1,Math.min(pageCount,Math.floor(Number(params.get('page')))||1)),visible=filtered.slice((page-1)*pageSize,page*pageSize);
  const copy=async(source:PublicationSource)=>{if(!source.linkKey||!source.params)return;const value=trackingShareUrl(source.linkKey,source.params);try{await navigator.clipboard.writeText(value);setCopied(source.id);setCopyFallback('');}catch{setCopyFallback(value);}};
  const reset=()=>setParams(current=>{const next=new URLSearchParams(current);for(const field of ['platformId','formatId','publicationStatus','activity','publishedDuring','sort','search','page'])next.delete(field);return next;});
  const refresh=()=>{void Promise.all([cache.invalidateQueries({queryKey:['partner-analytics',tenant,partnerId]}),cache.invalidateQueries({queryKey:['link-sources',partnerId]}),cache.invalidateQueries({queryKey:['links',partnerId]})]);};
  const closeCreate=()=>setParams(current=>{const next=new URLSearchParams(current);next.set('section','analytics');next.set('view',creationType==='partner'?'links':'publications');next.delete('create');return next;});
  const openCreation=(kind:'publication'|'partner')=>setParams(current=>{const next=new URLSearchParams(current);next.set('section','create');next.set('create',kind);next.set('view',kind==='partner'?'links':'publications');return next;});
  const switchSection=(value:'create'|'analytics')=>{
    if(value==='create'){openCreation(view==='links'?'partner':'publication');return;}
    setParams(current=>{const next=new URLSearchParams(current);next.set('section','analytics');next.delete('create');return next;});
  };
  const totalRow=data?.counts&&data?.amountsMinor?{...data,id:'total',name:'Итого',archived:false}:undefined;
  const previousTotal=previous?.counts&&previous?.amountsMinor?{...previous,id:'total',name:'Итого',archived:false}:undefined;
  const csv=()=>{if(!data||comparing&&!previous)return;try{const url=URL.createObjectURL(new Blob([publicationsCsv(filtered,data,previous)],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='syntolk-publications.csv';document.body.append(link);try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}setDownloadError(null);}catch{setDownloadError(new Error('Не удалось выгрузить CSV. Повторите попытку.'));}};
  return <div className="publications-page results-page" style={publicationTheme}><Page title="Публикации и ссылки" subtitle="Создание ссылок и подробная аналитика материалов и размещений." actions={section==='analytics'?<>
    <div className="publications-period-field"><span>Результаты за период</span>
      <ResultsDatePicker label="Результаты за период" calendarLabel="Свои даты результатов публикаций" period={period} value={primaryRange} timezone={timezone} onPeriodChange={value=>{const next=new URLSearchParams(params);next.set('period',value);next.delete('page');if(value==='custom'){next.set('from',primaryRange.from);next.set('to',primaryRange.to);}else{next.delete('from');next.delete('to');}setParams(next);}} onChange={range=>applyPeriods(range,comparing?comparisonRange:null)}/>
    </div>
    <ResultsDatePicker label="Сравнить периоды публикаций" comparison active={comparing} value={comparisonRange} primaryValue={primaryRange} timezone={timezone} disabled={!data||!enabled} onChange={range=>applyPeriods(primaryRange,range)} onApply={(main,comp)=>applyPeriods(main??primaryRange,comp)} onClear={()=>setParams(current=>clearResultsComparison(current))}/>
    <VisualButton className="results-icon-button" type="button" aria-label="Обновить публикации и статистику" title="Обновить без сброса фильтров" disabled={report.isFetching||sources.isFetching||comparison.isFetching} onClick={refresh}><RefreshCw size={16}/></VisualButton>
  </>:undefined}>
    <div className="publications-navigation">
      <Tabs value={section} onValueChange={value=>switchSection(value as 'create'|'analytics')}><TabsList variant="solid" aria-label="Раздел публикаций и ссылок" className="publications-main-menu">
        <TabsTrigger value="create" id="publications-create-tab" aria-controls="publications-create-panel" onClick={()=>{if(section!=='create')switchSection('create');}}><Plus size={17}/>Создание</TabsTrigger>
        <TabsTrigger value="analytics" id="publications-analytics-tab" aria-controls="publications-analytics-panel" onClick={()=>{if(section!=='analytics')switchSection('analytics');}}><BarChart3 size={17}/>Аналитика</TabsTrigger>
      </TabsList></Tabs>
      {(programs.data?.programs.length??0)>1&&<label>Программа<VisualSelect aria-label="Программа публикаций" value={programId} onChange={event=>selection.selectProgram(event.target.value)}>{programs.data?.programs.map(program=><option key={program.id} value={program.id}>{program.name}</option>)}</VisualSelect></label>}
      <TenantLink className="publications-calendar-link" to="/plan">Календарь работ →</TenantLink>
    </div>
    {section==='create'?<section role="tabpanel" id="publications-create-panel" aria-labelledby="publications-create-tab" className="publications-creation-panel">
      <div className="publications-section-heading"><div><h2>Какую ссылку создаём?</h2><p>Калькулятор не обязателен. Выберите назначение ссылки — статистика будет учитываться автоматически.</p></div></div>
      <div className="publications-creation-types" role="group" aria-label="Назначение новой ссылки">
        <VisualButton type="button" aria-pressed={creationType==='publication'} onClick={()=>openCreation('publication')}><FilePlus2 size={21}/><span><strong>Для публикации</strong><small>Пост, ролик или статья с отдельной статистикой</small></span><Check size={16} className="publications-type-check"/></VisualButton>
        <VisualButton type="button" aria-pressed={creationType==='partner'} onClick={()=>openCreation('partner')}><Link2 size={21}/><span><strong>Партнёрская ссылка</strong><small>Для профиля, закрепа и личной переписки</small></span><Check size={16} className="publications-type-check"/></VisualButton>
      </div>
      <ErrorBanner error={programs.error}/>
      {programs.isPending?<p role="status" className="publications-basis">Загружаем доступные программы…</p>:!programId?<p className="publications-empty">Нет доступной программы для создания ссылки.</p>:creationType==='partner'?permanentLinks({programId,comparing:false},{creationOnly:true,onClose:closeCreate}):<CreatePublication key={`${partnerId}:${programId}`} partnerId={partnerId} programId={programId} onClose={closeCreate} onCreated={created=>setParams(current=>{const next=new URLSearchParams(current);next.set('view','publications');next.set('publicationStatus',created.source.publishedAt?'published':'draft');for(const field of ['platformId','formatId','search','activity','publishedDuring','page'])next.delete(field);return next;})}/>}
    </section>:<section role="tabpanel" id="publications-analytics-panel" aria-labelledby="publications-analytics-tab">
    <div className="publications-toolbar"><div role="tablist" aria-label="Отчёт по публикациям и ссылкам" className="publications-tabs"><VisualButton type="button" role="tab" aria-selected={view==='publications'} onClick={()=>switchView('publications')}>Публикации</VisualButton><VisualButton type="button" role="tab" aria-selected={view==='links'} onClick={()=>switchView('links')}>Постоянные ссылки</VisualButton></div><VisualButton type="button" className="results-button publications-new-link" disabled={!programId} onClick={()=>openCreation(view==='links'?'partner':'publication')}><Plus size={15}/>Создать ссылку</VisualButton></div>
    <div className="publications-totals" aria-label="Сводная аналитика за период">{publicationMetrics.map(([metric,label])=><div key={metric}><span>{label}</span><PublicationMetricCell metric={metric} row={totalRow} previous={previousTotal} ready={!!totalRow} comparing={comparing} comparisonReady={!!previousTotal} currency={data?.currency}/></div>)}</div>
    <ErrorBanner error={programs.error??report.error??(comparing?comparison.error:null)??(view==='publications'?sources.error:null)??downloadError??(!customReady?new Error('Укажите корректные даты результатов.'):null)}/>
    <p className="publications-basis">Переходы, регистрации, оплаты и заработок — за выбранный период. Список публикаций — за всё время, если не выбран отбор по дате публикации.</p>
    {comparing&&<p className="publications-comparison">Сравниваем {primaryRange.from} — {primaryRange.to} с {compareFrom} — {compareTo}. В каждой строке показаны значения обоих периодов.</p>}
    {view==='links'?permanentLinks({programId,current:data,previous,comparing}):<section role="tabpanel" aria-label="Публикации">
      <div className="publications-filters"><label>Площадка<VisualSelect aria-label="Площадка публикаций" value={platform} onChange={event=>update('platformId',event.target.value)}><option value="">Все площадки</option>{[...platforms].sort((a,b)=>a[1].localeCompare(b[1],'ru')).map(([id,name])=><option key={id} value={id}>{name}</option>)}</VisualSelect></label><label>Формат<VisualSelect aria-label="Формат публикаций" value={format} onChange={event=>update('formatId',event.target.value)}><option value="">Все форматы</option>{[...formats].sort((a,b)=>a[1].localeCompare(b[1],'ru')).map(([id,name])=><option key={id} value={id}>{name}</option>)}</VisualSelect></label><label>Статус<VisualSelect aria-label="Статус публикаций" value={status} onChange={event=>update('publicationStatus',event.target.value)}><option value="published">Опубликованные</option><option value="draft">Подготовленные ссылки</option><option value="all">Все размещения</option></VisualSelect></label><label>Когда опубликовано<VisualSelect aria-label="Когда опубликовано" value={publishedDuring?'period':'all'} onChange={event=>update('publishedDuring',event.target.value==='period'?'period':'')}><option value="all">Любая дата</option><option value="period">В выбранном периоде</option></VisualSelect></label></div>
      <div className="publications-summary" aria-label="Количество публикаций"><div><span>{status==='draft'?'Подготовлено ссылок':'Опубликовано размещений'}</span><strong>{sources.isPending?'—':number(summary.published)}</strong></div><div><span>Уникальных материалов</span><strong>{sources.isPending?'—':number(summary.materials)}</strong></div><div><span>{status==='draft'?'Подготовлено площадок':'Площадок с публикациями'}</span><strong>{sources.isPending?'—':number(summary.platforms)}</strong></div></div>
      {summary.formats.length>0&&<p className="publications-formats">{summary.formats.map(item=><span key={item.id}>{item.name}: <strong>{number(item.placements)}</strong></span>)}</p>}
      <div className="publications-list-tools"><label className="publications-search"><Search size={16} aria-hidden="true"/><input aria-label="Поиск публикаций" placeholder="Материал, канал или ссылка" value={params.get('search')??''} onChange={event=>update('search',event.target.value)}/></label><VisualSelect aria-label="Активность публикаций" value={activity} disabled={!data} onChange={event=>update('activity',event.target.value)}><option value="all">Все результаты</option><option value="results">С результатами</option><option value="empty">Без результатов</option></VisualSelect><VisualSelect aria-label="Сортировка публикаций" value={sort} onChange={event=>update('sort',event.target.value)}><option value="date">Сначала новые</option><option value="clicks">Больше переходов</option><option value="payments">Больше оплат</option><option value="earnings">Больше заработок</option></VisualSelect><VisualButton type="button" className="results-button" onClick={reset}>Сбросить отбор</VisualButton><VisualButton type="button" className="results-button" disabled={!data||!filtered.length||comparing&&!previous} onClick={csv}><Download size={14}/>CSV</VisualButton></div>
      {!customReady?<p className="publications-empty">Выберите начало и конец периода результатов.</p>:programs.isError||sources.isError&&!sources.data?<p className="publications-empty">Не удалось загрузить список публикаций. Повторите обновление.</p>:!programs.isPending&&!programId?<p className="publications-empty">Нет доступной программы для просмотра публикаций.</p>:sources.isPending||programs.isPending?<p className="publications-empty" role="status">Загружаем публикации…</p>:!filtered.length?<div className="publications-empty"><strong>{inventory.length?'По выбранному отбору публикаций нет':'Размещения пока не созданы'}</strong><p>{inventory.length?'Измените площадку, формат или статус. Подготовленная ссылка не считается публикацией.':'Создайте материал в календаре, получите ссылку для площадки и отметьте публикацию — она появится здесь.'}</p>{inventory.some(source=>!source.publishedAt)&&status==='published'&&<VisualButton type="button" className="results-button" onClick={()=>update('publicationStatus','draft')}>Показать подготовленные ссылки</VisualButton>}</div>:<>
        <div className="publications-table-scroll" aria-busy={report.isFetching}><VisualTable className="publications-table"><VisualTableHead><VisualTableRow><VisualTableHeader>Материал / публикация</VisualTableHeader><VisualTableHeader>Площадка</VisualTableHeader><VisualTableHeader>Опубликовано</VisualTableHeader>{publicationMetrics.map(([metric,label])=><VisualTableHeader key={metric}>{label}</VisualTableHeader>)}</VisualTableRow></VisualTableHead><VisualTableBody>{visible.map(source=>{
          const open=expanded===source.id,href=safeHref(source.publicationUrl),tracking=source.linkKey&&source.params?trackingShareUrl(source.linkKey,source.params):null;
          return <Fragment key={source.id}>
            <VisualTableRow>
              <VisualTableCell data-label="Материал">
                <VisualButton type="button" className="publication-title" aria-expanded={open} aria-controls={`publication-${source.id}`} onClick={()=>{setExpanded(open?null:source.id);setEditing(null);setCopyFallback('');}}>
                  <ChevronDown size={15} className={open?'is-open':''}/><span>{source.materialTitle||'Материал не указан'}</span>
                </VisualButton>
                <small className="publication-subtitle">{source.formatName}{source.materialDeleted?' · Материал удалён':source.materialArchivedAt?' · Архив материала':''}</small>
                <div className="publication-row-actions">
                  {href&&<a href={href} target="_blank" rel="noopener noreferrer">Публикация <ExternalLink size={12}/></a>}
                  <VisualButton type="button" disabled={!data} onClick={()=>setDetails(source)} aria-label={`Статистика: ${source.materialTitle||source.platformName}`}><BarChart3 size={13}/>Статистика</VisualButton>
                </div>
              </VisualTableCell>
              <VisualTableCell data-label="Площадка"><strong>{source.platformName}</strong>{source.channelName&&source.channelName!==source.platformName&&<small className="publication-subtitle">{source.channelName}</small>}</VisualTableCell>
              <VisualTableCell data-label="Опубликовано">{source.publishedAt?dateLabel(source.publishedAt,timezone):<span className="publication-draft">Не отмечено</span>}</VisualTableCell>
              {publicationMetrics.map(([metric,label])=><VisualTableCell key={metric} data-label={label}><PublicationMetricCell metric={metric} row={currentRows.get(source.id)} previous={previousRows.get(source.id)} ready={!!data} comparing={comparing} comparisonReady={!!previous} currency={data?.currency}/></VisualTableCell>)}
            </VisualTableRow>
            {open&&<VisualTableRow className="publication-details-row"><VisualTableCell colSpan={7}><div id={`publication-${source.id}`} className="publication-details">
              <dl>
                <div><dt>Материал</dt><dd>{source.materialTitle||'Материал не указан'}</dd></div>
                <div><dt>Публикация</dt><dd>{href?<a href={href} target="_blank" rel="noopener noreferrer">{href}<ExternalLink size={13}/></a>:'Адрес публикации не указан'}</dd></div>
                <div><dt>Отслеживаемая ссылка</dt><dd>{tracking?<><code>{tracking}</code><VisualButton className="results-icon-button" type="button" onClick={()=>{void copy(source);}} aria-label="Скопировать ссылку публикации">{copied===source.id?<Check size={15}/>:<Copy size={15}/>}</VisualButton></>:'Ссылка недоступна'}</dd></div>
                <div><dt>Сценарий</dt><dd>{source.scenarioName||'Без сценария'}</dd></div>
              </dl>
              {copyFallback&&<label>Скопируйте ссылку вручную<input aria-label="Ссылка для ручного копирования" readOnly value={copyFallback} onFocus={event=>event.target.select()}/></label>}
              {source.materialId&&<VisualButton type="button" className="results-button" aria-expanded={editing===source.id} onClick={()=>setEditing(editing===source.id?null:source.id)}>{editing===source.id?'Закрыть редактирование':source.materialDeleted?'Ссылка и публикация':'Материал и его размещения'}</VisualButton>}
              {editing===source.id&&source.materialId&&<MaterialEditor partnerId={partnerId} materialId={source.materialId} archivedSource={source.materialDeleted?{...source,linkKey:source.linkKey??''}:undefined}/>}
            </div></VisualTableCell></VisualTableRow>}
          </Fragment>;
        })}</VisualTableBody></VisualTable></div><footer className="publications-pagination"><span>{number(filtered.length)} размещений · страница {page} из {pageCount}</span><div><VisualButton type="button" className="results-icon-button" aria-label="Предыдущая страница публикаций" disabled={page===1} onClick={()=>update('page',String(page-1))}><ChevronLeft size={17}/></VisualButton><VisualButton type="button" className="results-icon-button" aria-label="Следующая страница публикаций" disabled={page===pageCount} onClick={()=>update('page',String(page+1))}><ChevronRight size={17}/></VisualButton></div></footer>
      </>}
    </section>}
    {details&&data&&<ResultsDrawer key={`${details.id}:${query}`} partnerId={partnerId} row={publicationRow(details,currentRows.get(details.id))} groupBy="source" query={query.toString()} period={data.period} timezone={timezone} onClose={()=>setDetails(null)}/>}
    </section>}
  </Page></div>;
}
