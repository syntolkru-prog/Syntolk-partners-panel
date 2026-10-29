import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { api, currentTenantSlug } from '../api.js';
import { ErrorBanner, money } from '../ui.js';
import { TenantLink } from '../tenant-link.js';
import { AnalyticsTrackingNotice, PartnerAnalyticsPanel, type AnalyticsReport, type MetricRow } from './PartnerAnalytics.js';
import { AnalyticsAudience, ResultsChart, ResultsChartSkeleton, defaultChartMetrics, type ChartInspection, type ChartMetric, type ChartSeriesBy } from './ResultsChart.js';
import { ResultsExplorer } from './ResultsExplorer.js';
import { ResultsDrawer } from './ResultsDetails.js';
import { ResultsDatePicker, calendarDay, reportRange, rangeCaption, validDateRange, applyResultsPeriods, clearResultsComparison, type DateChoice, type ResultsPeriod } from './ResultsDatePicker.js';
import { ResultsMultiSelect } from './ResultsMultiSelect.js';
import { adminOverviewParams, analyticsChartTotals, analyticsChartChanges, inspectionScope, resetResultsFilters } from './results-scope.js';
import './results.css';
import './admin-analytics.css';

interface Pagination {page:number;pageSize:number;total:number;totalPages:number}
interface PartnerRow extends MetricRow {email:string;status:string}
interface PartnerPage {items:PartnerRow[];pagination:Pagination;summary:{partners:number;activePartners:number}}
interface AdminReport extends AnalyticsReport {selectedPartners?:Array<{id:string;name:string}>;availableCurrencies?:string[]}
const selected=(params:URLSearchParams,key:string)=>[...new Set([...params.getAll(key),...params.getAll(key.replace(/Ids$/,'Id'))].filter(Boolean))];
const integer=(value:string|null,fallback:number,max:number)=>value&&/^\d+$/.test(value)?Math.max(1,Math.min(max,Number(value))):fallback;
const sortLabels={clicks:'Переходы',registrations:'Регистрации',payingCustomers:'Платящие клиенты',paymentCount:'Оплаты',observedPayments:'Оплачено клиентами',netAccrued:'Начислено партнёрам',name:'Имя'};
const number=(value:number)=>value.toLocaleString('ru-RU');

export function AdminAnalytics() {return <AnalyticsAudience.Provider value={true}><AdminAnalyticsContent/></AnalyticsAudience.Provider>;}
function AdminAnalyticsContent() {
  const [params]=useSearchParams();
  const partnerId=params.get('selectedPartner');
  if(!partnerId)return <AdminAnalyticsOverview/>;
  const back=adminOverviewParams(new URLSearchParams(params.get('returnTo')??''));
  for(const key of ['selectedPartner','selectedPartnerName','returnTo'])back.delete(key);
  return <div className="results-layout admin-analytics">
    <div className="admin-analytics__detail-heading"><TenantLink to={'/admin/analytics?'+back} className="results-button"><ArrowLeft size={15}/>К аналитике партнёров</TenantLink><span>{params.get('selectedPartnerName')??'Результаты партнёра'}</span><TenantLink to={'/admin/partners/'+encodeURIComponent(partnerId)}>Карточка партнёра</TenantLink></div>
    <PartnerAnalyticsPanel key={partnerId} partnerId={partnerId} adminContext/>
  </div>;
}

function AdminAnalyticsOverview() {
  const [urlParams,setParams]=useSearchParams();
  const params=adminOverviewParams(urlParams);
  const normalizedQuery=params.toString(),urlQuery=urlParams.toString();
  const [explorer,setExplorer]=useState<{metric:ChartMetric;query:string;report:AnalyticsReport}|null>(null);
  const [inspection,setInspection]=useState<{selection:ChartInspection;query:string;period?:AnalyticsReport['period'];report:AnalyticsReport}|null>(null);
  const closeExplorer=useCallback(()=>setExplorer(null),[]),closeInspection=useCallback(()=>setInspection(null),[]);
  const [search,setSearch]=useState(params.get('search')??'');
  const localTimezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [resolvedTimezone,setResolvedTimezone]=useState('Europe/Moscow');
  let timezone=params.get('timezone')??resolvedTimezone;
  try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{timezone='Europe/Moscow';}
  const currency=/^[A-Z]{3}$/.test(params.get('currency')??'')?params.get('currency')!:'RUB';
  const period:ResultsPeriod=['today','7d','30d','all','custom'].includes(params.get('period')??'')?params.get('period') as ResultsPeriod:'30d';
  const partners=selected(params,'partnerIds').slice(0,50),page=integer(params.get('page'),1,100000),pageSize=integer(params.get('pageSize'),20,50);
  const sort=params.get('tableSort')??'netAccrued',direction=params.get('tableDirection')==='asc'?'asc':'desc';
  const chartBy:ChartSeriesBy=['partner','platform','format'].includes(params.get('chartBy')??'')?params.get('chartBy') as ChartSeriesBy:'total';
  const metrics=params.getAll('metrics').filter((value):value is ChartMetric=>defaultChartMetrics.includes(value as ChartMetric));
  const chosenMetrics=metrics.length?[...new Set(metrics)]:defaultChartMetrics;
  const from=params.get('from')??'',to=params.get('to')??'',customReady=period!=='custom'||validDateRange({from,to});
  const compareFrom=params.get('compareFrom')??'',compareTo=params.get('compareTo')??'';
  const compare=params.get('compare')==='true'&&validDateRange({from:compareFrom,to:compareTo});
  const scope=new URLSearchParams({period,currency});if(params.has('timezone'))scope.set('timezone',timezone);
  for(const key of ['programId','materialId','sourceId','linkId','from','to'])if(params.get(key))scope.set(key,params.get(key)!);
  for(const key of ['partnerIds','scenarioIds','platformIds','formatIds'])for(const value of selected(params,key))scope.append(key,value);
  const query=new URLSearchParams(scope);query.set('view','summary');query.set('includeSeries','true');
  if(chartBy!=='total')query.set('seriesBy',chartBy);
  if(compare){query.set('includeComparison','true');query.set('compareFrom',compareFrom);query.set('compareTo',compareTo);}
  const sourceScope=new URLSearchParams(scope);for(const key of ['period','from','to'])sourceScope.delete(key);
  const tableQuery=new URLSearchParams(scope);
  for(const [key,value] of Object.entries({page:String(page),pageSize:String(pageSize),sort:sort in sortLabels?sort:'netAccrued',direction,activity:params.get('showEmpty')==='true'?'all':'results',search:params.get('search')??''}))tableQuery.set(key,value);
  const report=useQuery({queryKey:['admin-analytics',currentTenantSlug(),query.toString()],queryFn:()=>api<AdminReport>('/admin/analytics?'+query),enabled:customReady,refetchOnWindowFocus:true,refetchInterval:30000,
    placeholderData:(previous,previousQuery)=>previousQuery?.queryKey[1]===currentTenantSlug()&&new URLSearchParams(String(previousQuery.queryKey[2])).get('currency')===currency?previous:undefined});
  const table=useQuery({queryKey:['admin-analytics-partners',currentTenantSlug(),tableQuery.toString()],queryFn:()=>api<PartnerPage>('/admin/analytics/partners?'+tableQuery),enabled:customReady,refetchOnWindowFocus:true,refetchInterval:30000,
    placeholderData:(previous,previousQuery)=>previousQuery?.queryKey[1]===currentTenantSlug()?previous:undefined});
  const programs=useQuery({queryKey:['admin-analytics-programs',currentTenantSlug()],queryFn:()=>api<{programs:Array<{id:string;name:string}>}>('/programs')});
  const data=report.data,rows=table.data?.items??[],pagination=table.data?.pagination;
  useEffect(()=>{if(data?.timezone&&!report.isPlaceholderData)setResolvedTimezone(data.timezone);},[data?.timezone,report.isPlaceholderData]);
  const catalogScope=JSON.stringify([currentTenantSlug(),params.get('programId')??'',[...partners].sort()]);
  const [previousOptions,setPreviousOptions]=useState<{scope:string;options:AnalyticsReport['options']}|null>(null);
  useEffect(()=>{if(data&&!report.isPlaceholderData)setPreviousOptions({scope:catalogScope,options:data.options});},[data,catalogScope,report.isPlaceholderData]);
  const options=(!report.isPlaceholderData?data?.options:undefined)??(previousOptions?.scope===catalogScope?previousOptions.options:{platforms:[],formats:[],scenarios:[]});
  const today=calendarDay(new Date().toISOString(),timezone);
  const primaryRange:DateChoice=(period==='custom'&&validDateRange({from,to})?{from,to}:reportRange(data?.period,timezone))??{from:today,to:today};
  const comparisonRange:DateChoice={from:compareFrom,to:compareTo};
  const applyPeriods=(primary:DateChoice,comparison:DateChoice|null)=>setParams(previous=>{const next=applyResultsPeriods(previous,primary,comparison);next.delete('page');return next;});
  const clearComparison=()=>setParams(previous=>clearResultsComparison(previous));
  const resetReport=()=>{const next=resetResultsFilters(urlParams);setSearch('');setExplorer(null);setInspection(null);setParams(next);if(next.toString()===urlQuery){void report.refetch();void table.refetch();}};
  const update=(key:string,value:string)=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set(key,value);else next.delete(key);if(key!=='page')next.delete('page');if(key==='programId')for(const field of ['scenarioId','scenarioIds','platformId','platformIds','formatId','formatIds','materialId','sourceId','linkId'])next.delete(field);return next;});
  const many=(key:string,values:string[])=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete(key);next.delete(key.replace(/Ids$/,'Id'));next.delete('page');if(key==='partnerIds'){next.delete('scenarioId');next.delete('scenarioIds');}for(const value of values)next.append(key,value);return next;});
  useEffect(()=>{if(normalizedQuery!==urlQuery)setParams(previous=>adminOverviewParams(previous),{replace:true});},[normalizedQuery,urlQuery,setParams]);
  useEffect(()=>{setExplorer(null);setInspection(null);},[sourceScope.toString(),chartBy]);
  useEffect(()=>{setInspection(null);},[scope.toString(),compare,compareFrom,compareTo]);
  useEffect(()=>{setSearch(params.get('search')??'');},[params.get('search')]);
  useEffect(()=>{if(search===(params.get('search')??''))return;const timer=window.setTimeout(()=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('page');if(search.trim())next.set('search',search.trim().slice(0,200));else next.delete('search');return next;},{replace:true}),300);return()=>window.clearTimeout(timer);},[search,params.get('search'),setParams]);
  const setMetrics=(values:ChartMetric[])=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('metrics');for(const value of values)next.append('metrics',value);return next;});
  const names=data?.selectedPartners??rows.filter(row=>partners.includes(row.id));
  const caption=partners.length===1?names.find(p=>p.id===partners[0])?.name??'Выбранный партнёр':partners.length?'Выбрано партнёров: '+partners.length:'Все партнёры';
  const inspect=(selection:ChartInspection)=>{if(data){const narrowed=inspectionScope(query.toString(),selection,data);setExplorer(null);setInspection({selection,...narrowed,report:data});}};
  const detailLink=(row:PartnerRow)=>{const next=new URLSearchParams(params);next.set('timezone',timezone);next.set('selectedPartner',row.id);next.set('selectedPartnerName',row.name);next.set('returnTo',params.toString());return '/admin/analytics?'+next;};
  return <div className="results-layout admin-analytics"><section className="results-page">
    <header className="results-header"><div><h1>Аналитика партнёров</h1><p className="admin-analytics__subtitle">{caption}</p></div><div className="results-header__actions">
      <ResultsDatePicker label="Период аналитики" calendarLabel="Даты аналитики партнёров" period={period} value={primaryRange} timezone={timezone}
        onPeriodChange={value=>setParams(previous=>{if(value==='custom'&&previous.get('period')==='custom')return previous;const next=new URLSearchParams(previous);next.set('period',value);for(const key of ['since','until','from','to','page'])next.delete(key);if(value==='custom'){next.set('from',primaryRange.from);next.set('to',primaryRange.to);}return next;})}
        onChange={range=>applyPeriods(range,compare?comparisonRange:null)}/>
      <ResultsDatePicker label="Сравнить периоды" value={comparisonRange} primaryValue={primaryRange} timezone={timezone} comparison active={compare} disabled={!data||report.isFetching||!customReady}
        onApply={(primary,comparison)=>applyPeriods(primary??primaryRange,comparison)} onChange={range=>applyPeriods(primaryRange,range)} onClear={clearComparison}/>
      <button type="button" className="results-button" title="Сбросить фильтры, даты и сравнение" onClick={resetReport}><RefreshCw size={14}/>Обновить</button>
    </div></header>
    <div className="admin-analytics__filters results-surface">
      <PartnerPicker scope={scope.toString()} value={partners} caption={caption} onChange={value=>many('partnerIds',value)}/>
      {partners.length===1&&<ResultsMultiSelect label="Сценарии" ariaLabel="Сценарии аналитики" allLabel="Все сценарии" options={[...options.scenarios,{id:'__none__',name:'Без сценария'}]} value={selected(params,'scenarioIds')} onChange={value=>many('scenarioIds',value)}/>}
      <ResultsMultiSelect label="Площадки" ariaLabel="Площадка аналитики" allLabel="Все площадки" options={[...options.platforms,{id:'__none__',name:'Площадка не указана'}]} value={selected(params,'platformIds')} onChange={value=>many('platformIds',value)}/>
      <ResultsMultiSelect label="Тип контента" ariaLabel="Формат аналитики" allLabel="Все типы контента" options={[...options.formats,{id:'__none__',name:'Формат не указан'}]} value={selected(params,'formatIds')} onChange={value=>many('formatIds',value)}/>
      {(['materialId','sourceId','linkId'] as const).map((key,i)=>params.has(key)&&<button type="button" className="results-button" key={key} onClick={()=>update(key,'')}>{['Материал','Размещение','Ссылка'][i]}: выбран · Сбросить</button>)}
      <details className="admin-analytics__settings"><summary>Настройки отчёта</summary><div>
        <label>Программа<select aria-label="Программа аналитики" value={params.get('programId')??''} onChange={e=>update('programId',e.target.value)}><option value="">Все программы</option>{programs.data?.programs.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {(data?.availableCurrencies?.length??0)>1&&<label>Валюта оплат<select aria-label="Валюта аналитики" value={currency} onChange={e=>update('currency',e.target.value)}>{[...new Set(['RUB',currency,...data?.availableCurrencies??[]])].map(code=><option key={code}>{code}</option>)}</select></label>}
        <label>Границы суток<select aria-label="Часовой пояс отчёта" value={timezone} onChange={e=>update('timezone',e.target.value)}>{[...new Set([localTimezone,'UTC',timezone])].map(zone=><option key={zone} value={zone}>{zone===localTimezone?'Моё местное время':zone==='UTC'?'Время UTC':zone}</option>)}</select></label>
        <p>Время отчёта одинаково для всех выбранных партнёров. Валюта относится к оплатам, а не к стране партнёра.</p>
      </div></details>
    </div>
    <ErrorBanner error={report.error??table.error??programs.error}/>
    {!customReady?<div className="results-empty results-surface" role="status">Выберите начало и конец периода в календаре.</div>:<>
      {report.isLoading?<ResultsChartSkeleton metrics={chosenMetrics} label="Загружаем графики…"/>:data&&<div className="results-report" data-pending={report.isPlaceholderData} aria-busy={report.isFetching}>
      {report.isPlaceholderData&&<span className="results-report__pending" role="status">Обновляем графики…</span>}
      <div className="results-report__content" aria-hidden={report.isPlaceholderData||undefined} {...{inert:report.isPlaceholderData?'':undefined}}><ResultsChart comparePartners periodCaption={rangeCaption(primaryRange)} currency={currency} series={data.series} metric={chosenMetrics[0]!} metrics={chosenMetrics} onChange={metric=>setMetrics([metric])} onMetricsChange={setMetrics} seriesBy={chartBy} onSeriesByChange={by=>update('chartBy',by==='total'?'':by)} onInspect={inspect} onExpand={metric=>setExplorer({metric,query:query.toString(),report:data})}
        totals={analyticsChartTotals(data)} comparisonTotals={compare&&data.comparison?analyticsChartTotals(data.comparison):undefined}
        changes={compare&&data.comparison?analyticsChartChanges(data,data.comparison):undefined}
        comparison={compare&&data.comparison?<div className="results-comparison-note"><span>Основной: {rangeCaption(primaryRange)}</span><span>Сравнение: {rangeCaption(comparisonRange)}</span><small>Сравниваются итоги за каждый диапазон. Нажмите карточку, чтобы увидеть оба графика.</small></div>:undefined}
        paymentCounts={{first:data.counts.firstPaymentCount,repeat:data.counts.repeatPaymentCount}}/></div></div>}
      <section className="results-performance results-surface" aria-labelledby="admin-partners-table-title" aria-busy={table.isFetching}>
        <div className="results-performance__heading"><div><h2 id="admin-partners-table-title">Результаты партнёров</h2><span>{compare?'Основной период':'За выбранный период'} · нажмите имя для подробностей</span></div><label className="results-empty-toggle"><input type="checkbox" checked={params.get('showEmpty')==='true'} onChange={e=>update('showEmpty',e.target.checked?'true':'')}/>Показать без результатов</label></div>
        <div className="results-table-tools"><label className="results-search"><Search size={15}/><input aria-label="Найти партнёра в таблице" placeholder="Имя или email" value={search} maxLength={200} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Сортировка партнёров" value={sort} onChange={e=>update('tableSort',e.target.value)}>{Object.entries(sortLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select aria-label="Порядок сортировки" value={direction} onChange={e=>update('tableDirection',e.target.value)}><option value="desc">По убыванию</option><option value="asc">По возрастанию</option></select></div>
        <div className="admin-analytics__table-scroll" data-pending={table.isPlaceholderData} role="region" tabIndex={0} aria-label="Результаты партнёров">
          {table.isPlaceholderData&&<span className="admin-analytics__table-pending" role="status">Обновляем результаты…</span>}
          <table className="results-table admin-analytics__table"><thead><tr>{['Партнёр','Переходы','Регистрации','Платящие клиенты','Оплаты','Оплачено клиентами','Начислено партнёрам'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody aria-hidden={table.isPlaceholderData||undefined} {...{inert:table.isPlaceholderData?'':undefined}}>{rows.map(row=><tr key={row.id}><td><TenantLink className="results-row-name" to={detailLink(row)}>{row.name}<ChevronRight size={14}/></TenantLink><span className="admin-analytics__partner-meta">{row.email}</span></td>{[row.counts.clicks,row.counts.registrations,row.counts.payingCustomers,row.counts.paymentCount].map((value,i)=><td key={i}>{number(value)}</td>)}<td>{money(row.amountsMinor.observedPayments/100,currency)}</td><td>{money(row.amountsMinor.netAccrued/100,currency)}</td></tr>)}</tbody></table>
          {!table.error&&!rows.length&&<div className="results-empty" role="status">{table.isLoading?'Загружаем результаты…':search?'Партнёры не найдены.':partners.length?'У выбранных партнёров нет действий за этот период.':'За выбранный период действий нет. Можно показать партнёров без результатов.'}</div>}
        </div>
        {pagination&&<div className="admin-analytics__pagination"><span>Найдено: {pagination.total} · Страница {page} из {Math.max(1,pagination.totalPages)}</span><select aria-label="Партнёров на странице" value={pageSize} onChange={e=>update('pageSize',e.target.value)}>{[20,50].map(size=><option key={size}>{size}</option>)}</select><button type="button" className="results-button" aria-label="Предыдущая страница партнёров" disabled={page<=1||table.isFetching} onClick={()=>update('page',String(page-1))}><ChevronLeft size={16}/></button><button type="button" className="results-button" aria-label="Следующая страница партнёров" disabled={page>=pagination.totalPages||table.isFetching} onClick={()=>update('page',String(page+1))}><ChevronRight size={16}/></button></div>}
      </section>
      {data&&<>
        <details className="admin-analytics__quality results-surface"><summary>Возвраты и расчёт вознаграждений</summary><dl className="admin-analytics__financial">{[['Возвраты клиентов',data.amountsMinor.refunds],['Оплаты за вычетом возвратов',data.amountsMinor.netPayments],['После комиссий партнёров',data.amountsMinor.netPayments-data.amountsMinor.netAccrued]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(Number(value)/100,currency)}</dd></div>)}</dl><p>Это суммы за период, не чистая прибыль компании. История реальных переводов находится в разделе <TenantLink to="/payouts">«Выплаты»</TenantLink>.</p></details>
      </>}
    </>}
    <AdminQuality query={scope.toString()} enabled={customReady}/>
    {explorer&&<ResultsExplorer endpoint="/admin/analytics" partnerId="admin" metric={explorer.metric} query={explorer.query} report={explorer.report} context={caption} onClose={closeExplorer} onPeriodsChange={applyPeriods} onComparisonClear={clearComparison}/>}
    {inspection&&<ResultsDrawer endpoint="/admin/analytics" partnerId="admin" row={{id:'__total__',name:'Результаты партнёров',archived:false,counts:inspection.report.counts,amountsMinor:inspection.report.amountsMinor}} groupBy="total" query={inspection.query} period={inspection.period} timezone={timezone} onClose={closeInspection} inspection={{metric:inspection.selection.metric,context:inspection.selection.group?.name??caption,compareBy:inspection.selection.by!=='total'&&!inspection.selection.group?inspection.selection.by:undefined,groups:inspection.report.series?.groups}}/>}
  </section></div>;
}

function PartnerPicker({scope,value,caption,onChange}:{scope:string;value:string[];caption:string;onChange:(value:string[])=>void}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[term,setTerm]=useState(''),[page,setPage]=useState(1),[all,setAll]=useState(false);
  const root=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{const timer=window.setTimeout(()=>{setTerm(search.trim());setPage(1);},250);return()=>window.clearTimeout(timer);},[search]);
  useEffect(()=>{setPage(1);},[scope,all]);
  const query=new URLSearchParams(scope);query.delete('partnerId');query.delete('partnerIds');query.set('search',term);query.set('page',String(page));query.set('pageSize','20');query.set('sort','clicks');query.set('activity',all?'all':'results');
  const options=useQuery({queryKey:['admin-analytics-partner-picker',currentTenantSlug(),query.toString()],queryFn:()=>api<PartnerPage>('/admin/analytics/partners?'+query),enabled:open,refetchOnWindowFocus:true});
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)&&root.current)root.current.open=false;};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
  return <details className="admin-analytics__picker" ref={root} onToggle={e=>setOpen(e.currentTarget.open)} onKeyDown={e=>{if(e.key==='Escape'&&root.current){root.current.open=false;root.current.querySelector('summary')?.focus();}}}>
    <summary>Партнёры<span>{caption}</span></summary>{open&&<div className="admin-analytics__picker-menu">
      <input aria-label="Поиск партнёров" placeholder="Имя или email" value={search} maxLength={200} onChange={e=>setSearch(e.target.value)}/>
      <label className="results-empty-toggle"><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/>Показать без результатов</label>
      <button type="button" className="results-text-button" onClick={()=>onChange([])}>Все партнёры</button><ErrorBanner error={options.error}/>
      {options.isLoading?<p role="status">Загружаем результаты…</p>:<div className="admin-analytics__picker-options">{options.data?.items.map(partner=><label key={partner.id}><input type="checkbox" checked={value.includes(partner.id)} disabled={value.length>=50&&!value.includes(partner.id)} onChange={()=>onChange(value.includes(partner.id)?value.filter(id=>id!==partner.id):[...value,partner.id])}/><span>{partner.name}<small>{partner.counts.clicks||partner.counts.paymentCount||partner.counts.registrations?'Переходы: '+partner.counts.clicks+' · Регистрации: '+partner.counts.registrations+' · Оплаты: '+partner.counts.paymentCount :partner.amountsMinor.refunds!==0||partner.amountsMinor.netAccrued!==0?'Есть финансовые изменения':'Нет действий за период'}</small></span></label>)}{!options.error&&!options.data?.items.length&&<p>Партнёров с результатами не найдено.</p>}</div>}
      <div className="admin-analytics__picker-footer"><span>{value.length?'Выбрано: '+value.length:''}</span><button type="button" className="results-button" aria-label="Предыдущие варианты партнёров" disabled={page<=1||options.isFetching} onClick={()=>setPage(page-1)}><ChevronLeft size={14}/></button><button type="button" className="results-button" aria-label="Следующие варианты партнёров" disabled={!options.data||page>=options.data.pagination.totalPages||options.isFetching} onClick={()=>setPage(page+1)}><ChevronRight size={14}/></button><button type="button" className="results-button" onClick={()=>{if(root.current)root.current.open=false;}}>Готово</button></div>
    </div>}
  </details>;
}

function AdminQuality({query,enabled}:{query:string;enabled:boolean}) {
  const [open,setOpen]=useState(false);
  const params=new URLSearchParams(query);params.set('view','diagnostics');
  const result=useQuery({queryKey:['admin-analytics-quality',currentTenantSlug(),query],queryFn:()=>api<AnalyticsReport&{diagnostics:{flaggedClicks:number;legacyFinancialEventsWithoutExternalId:number;outstandingDebtMinor:number}}>('/admin/analytics?'+params),enabled:open&&enabled,refetchOnWindowFocus:true});
  return <details className="admin-analytics__quality results-surface" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Проверка учёта</summary>{open&&<><ErrorBanner error={result.error}/>{result.isLoading?<p>Загружаем проверку…</p>:result.data&&<><AnalyticsTrackingNotice report={result.data}/><p>Исключено подозрительных переходов: {result.data.diagnostics.flaggedClicks}. Старых финансовых событий без внешнего номера: {result.data.diagnostics.legacyFinancialEventsWithoutExternalId}.</p><p>Просмотры публикаций и CTR не собираются. Настройка передачи событий — в разделе <TenantLink to="/admin/integrations">«Интеграция с CRM»</TenantLink>.</p></>}</>}</details>;
}
