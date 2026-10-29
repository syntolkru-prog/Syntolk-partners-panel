import {ResultsMultiSelect} from './ResultsMultiSelect.js';
import {VisualButton,VisualSelect} from '../components/tremor/VisualControls.js';
import { VisualTable, VisualTableHead, VisualTableHeader, VisualTableBody, VisualTableRow, VisualTableCell } from '../components/tremor/VisualTable.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Link2, RefreshCw, Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { TenantLink } from '../tenant-link.js';
import { api, currentTenantSlug } from '../api.js';
import { ErrorBanner, money } from '../ui.js';
import { usePartnerSelection } from '../lib/partner-selection.js';
import { ResultsChart, ResultsChartSkeleton, chartMetricKeys, defaultChartMetrics, useMetricLabels, type ChartMetric, type SeriesPoint, type ChartSeriesBy, type ChartInspection } from './ResultsChart.js';
import { ResultsDrawer, PaymentDetails, dateLabel } from './ResultsDetails.js';
import { downloadResultsCsv } from './results-export.js';
import { ResultsExplorer } from './ResultsExplorer.js';
import { ResultsDatePicker, calendarDay, reportRange, rangeCaption, validDateRange, applyResultsPeriods, clearResultsComparison, type DateChoice, type ResultsPeriod } from './ResultsDatePicker.js';
import { analyticsChartTotals, analyticsChartChanges, inspectionScope, resetResultsFilters } from './results-scope.js';
import './results.css';

interface Counts { clicks:number;identities?:number;registrations:number;payingCustomers:number;paymentCount:number;firstPaymentCount:number;repeatPaymentCount:number }
interface Amounts { observedPayments:number;refunds:number;netPayments:number;netAccrued:number }
export interface MetricRow { id:string;name:string;archived:boolean;counts:Counts;amountsMinor:Amounts;createdAt?:string|null;linkKey?:string|null;platformNames?:string[];
  conversions?:{clickToRegistration:number|null;registrationToPayment:number|null;clickToPayment:number|null};
  material?:{id:string;programId:string;formatName:string;scheduledDay:string|null;scenarioName:string|null;published:number;placements:number};
  placement?:{materialTitle:string|null;formatName:string;platformName:string;channelName:string|null;publicationUrl:string|null;publishedAt:string|null;linkKey:string|null;trackingParams:Record<string,string>};
}
interface Option {id:string;name:string;archived?:boolean}
export interface AnalyticsReport {
  currency?:string;
  availableCurrencies?:string[];
  dataQuality?:{signupTracking?:string;paymentTracking?:string;views?:string;ctr?:string};
  warnings?:string[];
  counts:Counts;amountsMinor:Amounts;conversions:{clickToRegistration:number|null;registrationToPayment:number|null;clickToPayment:number|null};
  rows:MetricRow[];groupBy:string;options:{scenarios:Option[];platforms:Option[];formats:Option[];partners?:Option[]};
  balances?:{total:number;available:number;pending:number;paid:number;accrued?:number;debt?:number;netPaidEarnings?:number};
  periodBalances?:{total:number;available:number;pending:number;paid:number};
  series?:{bucket:string;points:SeriesPoint[];by?:Exclude<ChartSeriesBy,'total'>;groups?:Array<{id:string;name:string;points:SeriesPoint[]}>};
  period?:{since:string;until:string};
  timezone?:string;
  comparison?:{period:{since:string;until:string};counts:Counts;amountsMinor:Amounts};
}

function selectedValues(params:URLSearchParams,field:string) {
  return [...new Set([...params.getAll(`${field}s`),...params.getAll(field)].filter(value=>value&&!['all','new'].includes(value)))];
}
const sourceScope=(params:URLSearchParams)=>JSON.stringify(['scenarioId','platformId','formatId'].map(field=>selectedValues(params,field).sort()));
function selectionCaption(options:Option[],ids:string[],label:string) {
  return ids.length>1?`${label}: ${ids.length}`:ids.length?options.find(option=>option.id===ids[0])?.name??(ids[0]==='__none__'?'Без сценария':'Выбранный вариант'):'';
}
export function PartnerResults({partnerId}:{partnerId:string}) {
  return <div className="results-layout"><PartnerAnalyticsPanel partnerId={partnerId}/></div>;
}

export function PartnerAnalyticsPanel({partnerId,adminContext=false}:{partnerId:string;adminContext?:boolean}) {
  const [params,setParams]=useSearchParams();
  const [expanded,setExpanded]=useState<string|null>(null),[search,setSearch]=useState('');
  const [inspection,setInspection]=useState<{selection:ChartInspection;row:MetricRow;query:string;period?:AnalyticsReport['period'];context:string;timezone?:string;compareBy?:Exclude<ChartSeriesBy,'total'>;groups?:Option[]}|null>(null);
  const [explorer,setExplorer]=useState<{metric:ChartMetric;query:string;report:AnalyticsReport;context:string}|null>(null);
  const payments=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{
      const target=event.target as Node;
      if((target as Element).closest?.('[data-results-menu]'))return;
      if(payments.current?.open&&!payments.current.contains(target))payments.current.open=false;
    };
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||event.defaultPrevented)return;
      if(payments.current?.open){payments.current.open=false;payments.current.querySelector('summary')?.focus({preventScroll:true});}
    };
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[]);
  // The partner view always shows the complete set of result cards. Metric
  // selection remains available in the admin analytics view, but it should
  // not turn the partner dashboard into a partially hidden report.
  const selectedMetrics:ChartMetric[]=defaultChartMetrics;
  const metric=selectedMetrics[0]!;
  const chartBy:ChartSeriesBy=['platform','format','scenario'].includes(params.get('chartBy')??'')?params.get('chartBy') as ChartSeriesBy:'total';
  const setMetrics=(values:ChartMetric[])=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('metrics');for(const value of values)next.append('metrics',value);return next;});
  const setMetric=(value:ChartMetric)=>setMetrics([value]);
  const setChartBy=(value:ChartSeriesBy)=>setParams(previous=>{const next=new URLSearchParams(previous);if(value==='total')next.delete('chartBy');else next.set('chartBy',value);return next;});
  const [downloadError,setDownloadError]=useState<Error|null>(null);
  const closeDetails=useCallback(()=>setExpanded(null),[]);
  const closeInspection=useCallback(()=>setInspection(null),[]);
  const closeExplorer=useCallback(()=>setExplorer(null),[]);
  const programs=useQuery({queryKey:[adminContext?'admin-analytics-programs':'me-campaigns',currentTenantSlug(),partnerId],queryFn:()=>api<{programs:Option[]}>(adminContext?'/programs':'/me/programs')});
  const selection=usePartnerSelection(partnerId,programs.data?.programs??[]);
  const programId=adminContext?params.get('programId')??'':selection.programId;
  const requestedCurrency=params.get('currency')??'RUB';
  const currency=/^[A-Z]{3}$/.test(requestedCurrency)?requestedCurrency:'RUB';
  const scenarioIds=adminContext?selectedValues(params,'scenarioId'):selection.scenarioIds;
  const platformIds=selectedValues(params,'platformId'),formatIds=selectedValues(params,'formatId');
  const period:ResultsPeriod=['today','7d','30d','all','custom'].includes(params.get('period')??'')?params.get('period') as ResultsPeriod:'30d';
  const bucket=['day','week','month'].includes(params.get('bucket')??'')?params.get('bucket') as 'day'|'week'|'month':undefined;
  const groupBy=['link','material','source','platform','scenario','format'].includes(params.get('groupBy')??'')?params.get('groupBy')!:'platform';
  const activity=['results','clicks','empty','all'].includes(params.get('activity')??'')?params.get('activity')!:'results',sort=params.get('sort')??'clicks';
  const includeEmpty=params.get('includeEmpty')==='true'||['empty','all'].includes(activity);
  const compareFrom=params.get('compareFrom')??'',compareTo=params.get('compareTo')??'';
  const compare=params.get('compare')==='true'&&validDateRange({from:compareFrom,to:compareTo});
  const query=new URLSearchParams({currency,period,groupBy,includeSeries:'true'});
  if(bucket)query.set('bucket',bucket);
  if(compare)query.set('includeComparison','true');
  if(compare&&compareFrom&&compareTo){query.set('compareFrom',compareFrom);query.set('compareTo',compareTo);}
  if(includeEmpty)query.set('includeEmpty','true');
  if(programId)query.set('programId',programId);
  for(const [field,values] of [['scenarioIds',scenarioIds],['platformIds',platformIds],['formatIds',formatIds]] as const)for(const value of values)query.append(field,value);
  if(chartBy!=='total')query.set('seriesBy',chartBy);
  for(const field of ['materialId','linkId','sourceId','from','to','timezone'])if(params.get(field))query.set(field,params.get(field)!);
  const from=params.get('from')??'',to=params.get('to')??'';
  const customReady=period!=='custom'||validDateRange({from,to});
  const report=useQuery({queryKey:['partner-analytics',currentTenantSlug(),partnerId,query.toString()],queryFn:()=>api<AnalyticsReport>(`/partners/${partnerId}/analytics?${query}`),enabled:customReady&&!programs.isLoading,refetchInterval:30000,refetchOnWindowFocus:true,
    placeholderData:(previous,previousQuery)=>previousQuery?.queryKey[1]===currentTenantSlug()&&previousQuery.queryKey[2]===partnerId&&new URLSearchParams(String(previousQuery.queryKey[3]??'')).get('programId')===query.get('programId')&&new URLSearchParams(String(previousQuery.queryKey[3]??'')).get('currency')===currency&&sourceScope(new URLSearchParams(String(previousQuery.queryKey[3]??'')))===sourceScope(query)?previous:undefined});
  const data=report.data;
  const primaryRange:DateChoice=(period==='custom'&&from&&to?{from,to}:reportRange(data?.period,data?.timezone))??{from:calendarDay(new Date().toISOString()),to:calendarDay(new Date().toISOString())};
  const comparisonRange:DateChoice=(compareFrom&&compareTo?{from:compareFrom,to:compareTo}:reportRange(data?.comparison?.period,data?.timezone))??{from:'',to:''};
  const applyPeriods=(main:DateChoice,comparison:DateChoice|null)=>setParams(previous=>applyResultsPeriods(previous,main,comparison));
  const clearComparison=()=>setParams(previous=>clearResultsComparison(previous));
  const owner=`${currentTenantSlug()??'default'}:${partnerId}`;
  const catalogScope=JSON.stringify([programId,[...scenarioIds].sort()]);
  const [previousOptions,setPreviousOptions]=useState<{owner:string;programId:string;scope:string;options:AnalyticsReport['options']}|null>(null);
  useEffect(()=>{if(data&&!report.isPlaceholderData)setPreviousOptions({owner,programId,scope:catalogScope,options:data.options});},[data,owner,programId,catalogScope,report.isPlaceholderData]);
  const options=data?.options??(previousOptions?.owner===owner&&previousOptions.scope===catalogScope?previousOptions.options:{scenarios:previousOptions?.owner===owner&&previousOptions.programId===programId?previousOptions.options.scenarios:[],platforms:[],formats:[]});
  const update=(field:string,value:string)=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set(field,value);else next.delete(field);return next;});
  const chooseValues=(field:'scenarioId'|'platformId'|'formatId',values:string[])=>{
    if(!adminContext&&field==='scenarioId'){selection.selectScenarios(values);return;}
    setParams(previous=>{
      const next=new URLSearchParams(previous);next.delete(field);next.delete(`${field}s`);
      if(field==='scenarioId'){
        for(const key of ['materialId','sourceId','linkId'])next.delete(key);
        if(!values.length)next.set('scenarioId','all');
      }
      for(const value of values)next.append(`${field}s`,value);
      return next;
    });
  };
  const reset=()=>{setSearch('');setExpanded(null);setParams(previous=>{const next=new URLSearchParams(previous);for(const field of ['scenarioId','scenarioIds','platformId','platformIds','formatId','formatIds','materialId','linkId','sourceId','groupBy','chartBy','activity','includeEmpty','sort'])next.delete(field);next.set('scenarioId','all');return next;});};
  const resetReport=()=>{const next=resetResultsFilters(params,!adminContext);next.set('scenarioId','all');setSearch('');setExpanded(null);setInspection(null);setExplorer(null);setDownloadError(null);if(payments.current)payments.current.open=false;setParams(next);if(next.toString()===params.toString())void report.refetch();};
  const scopeLink=(id:string)=>{setExpanded(null);update('linkId',id);};
  const inspect=(selected:ChartInspection)=>{
    if(!data)return;
    const scoped=inspectionScope(query.toString(),selected,data);
    const context=[selected.group?.by!=='scenario'?selectionCaption(options.scenarios,scenarioIds,'Сценарии'):'',selected.group?.by!=='platform'?selectionCaption(options.platforms,platformIds,'Площадки'):'',selected.group?.by!=='format'?selectionCaption(options.formats,formatIds,'Форматы'):'',selected.group?.name].filter(Boolean).join(' · ');
    const compareBy=selected.by&&selected.by!=='total'&&!selected.group?selected.by:undefined;
    setExpanded(null);setInspection({selection:selected,row:{id:'__total__',name:'Подробная статистика',archived:false,counts:data.counts,amountsMinor:data.amountsMinor,conversions:data.conversions},query:scoped.query,period:scoped.period,context,timezone:data.timezone,compareBy,groups:compareBy?data.series?.groups?.map(group=>({id:group.id,name:group.name})):undefined});
  };
  const expandChart=(metric:ChartMetric)=>{if(data){setExpanded(null);setInspection(null);setExplorer({metric,query:query.toString(),report:data,context:[selectionCaption(options.scenarios,scenarioIds,'Сценарии'),selectionCaption(options.platforms,platformIds,'Площадки'),selectionCaption(options.formats,formatIds,'Форматы'),params.has('materialId')?'Выбран один материал':'',params.has('linkId')?'Выбрана одна ссылка':''].filter(Boolean).join(' · ')});}};
  const activeFilters=[scenarioIds.length,platformIds.length,formatIds.length,params.get('materialId'),params.get('linkId'),params.get('sourceId')].filter(Boolean).length;
  useEffect(()=>{setExpanded(null);setInspection(null);},[period,bucket,from,to,compareFrom,compareTo,compare]);
  useEffect(()=>{setExpanded(null);setInspection(null);setExplorer(null);},[partnerId,currency,groupBy,chartBy,programId,scenarioIds.join(','),platformIds.join(','),formatIds.join(','),params.get('materialId'),params.get('linkId'),params.get('sourceId')]);
  const visibleRows=[...(data?.rows??[])].filter(row=>(includeEmpty||hasActivity(row))&&(!search||`${row.name} ${row.linkKey??''} ${row.placement?.channelName??''}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')))&&(activity!=='clicks'||row.counts.clicks>0)&&(activity!=='empty'||!hasActivity(row)))
    .sort((a,b)=>(sort==='earnings'?b.amountsMinor.netAccrued-a.amountsMinor.netAccrued:sort==='payments'?b.amountsMinor.observedPayments-a.amountsMinor.observedPayments:sort==='date'?(b.createdAt??'').localeCompare(a.createdAt??''):b.counts.clicks-a.counts.clicks)||b.counts.clicks-a.counts.clicks||a.name.localeCompare(b.name,'ru',{numeric:true}));
  return <section className="results-page">
    <header className="results-header"><div className="results-header__title"><h1>{adminContext?'Результаты партнёра':'Результаты'}</h1><div className="results-context">{activeFilters>0&&<><span>{params.has('linkId')?`Ссылка: ${data?.rows.find(row=>row.id===params.get('linkId'))?.name??'выбранная'}`:params.has('materialId')?'Выбран один материал':[selectionCaption(options.scenarios,scenarioIds,'Сценарии'),selectionCaption(options.platforms,platformIds,'Площадки'),selectionCaption(options.formats,formatIds,'Форматы')].filter(Boolean).join(' · ')||'Выбраны фильтры'}</span><VisualButton type="button" onClick={reset}><X size={13} aria-hidden="true"/>Показать все</VisualButton></>}</div></div><div className="results-header__actions">
      <ResultsDatePicker label="Период аналитики" calendarLabel="Даты аналитики" period={period} value={primaryRange} timezone={data?.timezone}
        onPeriodChange={value=>setParams(previous=>{if(value==='custom'&&previous.get('period')==='custom')return previous;const updated=new URLSearchParams(previous);updated.set('period',value);for(const key of ['since','until','from','to'])updated.delete(key);if(value==='custom'){updated.set('from',primaryRange.from);updated.set('to',primaryRange.to);}return updated;})}
        onChange={range=>applyPeriods(range,compare?comparisonRange:null)}/>
      {(data?.availableCurrencies?.length??0)>1&&<label className="results-currency">Валюта оплат<VisualSelect aria-label="Валюта аналитики" value={currency} onChange={event=>update('currency',event.target.value)}>{[...new Set([currency,...data?.availableCurrencies??[]])].map(code=><option key={code} value={code}>{code}</option>)}</VisualSelect></label>}
      <ResultsDatePicker label="Сравнить периоды" value={comparisonRange} primaryValue={primaryRange} timezone={data?.timezone} comparison active={compare} disabled={!data||report.isPlaceholderData||!customReady}
        onApply={(main,comparison)=>applyPeriods(main??primaryRange,comparison)} onChange={range=>applyPeriods(primaryRange,range)} onClear={clearComparison}/>
      <VisualButton type="button" className="results-button" title="Сбросить фильтры, даты и сравнение" onClick={resetReport}><RefreshCw size={14}/>Обновить</VisualButton>
    </div></header>
    <div className="results-filterbar results-surface" aria-label="Отбор результатов">
      {(adminContext||(programs.data?.programs?.length??0)>1)&&<label className="coach-field"><span>Программа</span><VisualSelect aria-label="Программа аналитики" value={programId} onChange={e=>{if(!adminContext){selection.selectProgram(e.target.value);setSearch('');return;}setSearch('');setParams(previous=>{const next=new URLSearchParams(previous);next.set('programId',e.target.value);for(const key of ['scenarioId','scenarioIds','platformId','platformIds','formatId','formatIds','materialId','linkId','sourceId'])next.delete(key);return next;});}}>{adminContext&&<option value="">Все программы</option>}{programs.data?.programs.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</VisualSelect></label>}
      <ResultsMultiSelect label="Сценарии" ariaLabel="Сценарий аналитики" allLabel="Все сценарии" options={[...options.scenarios,{id:'__none__',name:'Без сценария'}]} value={scenarioIds} onChange={values=>chooseValues('scenarioId',values)}/>
      <ResultsMultiSelect label="Площадки" ariaLabel="Площадка аналитики" allLabel="Все площадки" options={[...options.platforms,{id:'__none__',name:'Площадка не указана'}]} value={platformIds} onChange={values=>chooseValues('platformId',values)}/>
      <ResultsMultiSelect label="Форматы" ariaLabel="Формат аналитики" allLabel="Все форматы" options={[...options.formats,{id:'__none__',name:'Тип контента не указан'}]} value={formatIds} onChange={values=>chooseValues('formatId',values)}/>
    </div>
    <ErrorBanner error={report.error??programs.error??downloadError}/>
    {!customReady&&!data?<div className="results-empty results-surface" role="status">{from&&to?'Конец периода не может быть раньше начала.':'Выберите начало и конец периода.'}</div>:report.isLoading||programs.isLoading?<ResultsChartSkeleton/>:data?<div className="results-report" data-pending={report.isPlaceholderData||!customReady} aria-busy={report.isFetching}>
      {(report.isPlaceholderData||!customReady)&&<span className="results-report__pending" role="status">{!customReady?(from&&to?'Конец периода не может быть раньше начала.':'Выберите начало и конец периода.'):'Обновляем статистику…'}</span>}
      <div className="results-report__content" aria-hidden={report.isPlaceholderData||!customReady||undefined} {...{inert:report.isPlaceholderData||!customReady?'':undefined}}>
      <ResultsChart periodCaption={rangeCaption(primaryRange)} currency={data.currency??currency} series={data.series} metric={metric} onChange={setMetric} metrics={selectedMetrics} onMetricsChange={adminContext?setMetrics:undefined} seriesBy={chartBy} onSeriesByChange={setChartBy} onInspect={inspect} onExpand={expandChart}
        toolbarControls={<VisualSelect aria-label="Шаг графика" value={bucket??'auto'} onChange={event=>update('bucket',event.target.value==='auto'?'':event.target.value)}><option value="auto">Автоматически</option><option value="day">По дням</option><option value="week">По неделям</option><option value="month">По месяцам</option></VisualSelect>}
        comparisonTotals={compare&&data.comparison?analyticsChartTotals(data.comparison):undefined}
        totals={analyticsChartTotals(data)}
        paymentCounts={{first:data.counts.firstPaymentCount,repeat:data.counts.repeatPaymentCount}}
        changes={compare&&data.comparison?analyticsChartChanges(data,data.comparison):undefined}
        comparison={compare&&data.comparison?<div className="results-comparison-note"><span>Основной: {rangeCaption(primaryRange)}</span><span>Сравнение: {rangeCaption(comparisonRange)}</span><small>Сравниваются суммы за каждый диапазон. Нажмите карточку, чтобы увидеть оба графика.</small></div>:undefined}/>
      <details ref={payments} className="results-payments"><summary>Оплаты и конверсии<ChevronDown size={14} aria-hidden="true"/></summary><PaymentDetails row={data} currency={data.currency??currency}/></details>
      <section className="results-performance results-surface" aria-labelledby="results-table-title" aria-busy={report.isFetching}>
        <div className="results-performance__heading"><div><h2 id="results-table-title">Эффективность {groupBy==='link'?'ссылок':groupBy==='material'?'материалов':groupBy==='source'?'размещений':groupBy==='platform'?'площадок':groupBy==='format'?'форматов':'сценариев'}</h2><span>{activity==='empty'?'Без действий за выбранный период':activity==='clicks'?'С переходами за выбранный период':includeEmpty?'Включая источники без действий':'С действиями за выбранный период'}</span></div></div>
        <div className="results-table-tools"><label className="results-table-activity">Строки таблицы<VisualSelect aria-label="Активность таблицы" value={includeEmpty&&activity==='results'?'all':activity} onChange={e=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('includeEmpty');next.set('activity',e.target.value);return next;})}><option value="results">С действиями</option><option value="clicks">С переходами</option><option value="empty">Без действий</option><option value="all">Все</option></VisualSelect></label><label className="coach-field results-grouping"><VisualSelect aria-label="Разбивка аналитики" value={groupBy} onChange={e=>update('groupBy',e.target.value)}><option value="platform">По площадкам</option><option value="link">По ссылкам</option><option value="material">По материалам</option><option value="source">По размещениям</option><option value="scenario">По сценариям</option><option value="format">По форматам</option></VisualSelect></label><label className="results-search"><Search size={15} aria-hidden="true"/><input aria-label={groupBy==='material'?'Найти материал':'Поиск результатов'} placeholder={groupBy==='material'?'Найти материал':'Найти в таблице'} value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="results-table-actions"><VisualSelect aria-label="Сортировка результатов" value={sort} onChange={e=>update('sort',e.target.value)}><option value="clicks">Больше переходов</option><option value="earnings">Больше заработок</option><option value="payments">Больше оплат клиентов</option><option value="date">Сначала новые</option></VisualSelect><VisualButton type="button" className="results-button" aria-label="Скачать отчёт CSV" title="Скачать строки с текущими фильтрами и сортировкой" disabled={!visibleRows.length} onClick={()=>{try{downloadResultsCsv(visibleRows,data.period,data.currency??currency);setDownloadError(null);}catch{setDownloadError(new Error('Не удалось скачать отчёт. Повторите попытку.'));}}}><Download size={14} aria-hidden="true"/>CSV</VisualButton></div></div>
        <div className="results-table-viewport">{visibleRows.length?<ResultsTable currency={data.currency??currency} groupBy={groupBy} rows={visibleRows} timezone={data.timezone} expanded={expanded} onExpand={setExpanded}/>:<div className="results-empty"><Link2 size={24} aria-hidden="true"/><strong>{search?'Ничего не найдено.':activity==='empty'?'Источников без результатов нет.':includeEmpty?'По выбранным фильтрам данных нет.':'За выбранный период нет действий.'}</strong>{!search&&!includeEmpty&&<span>Покажите строки без результатов или выберите другой период.</span>}</div>}</div>
      </section>
      {data.rows.find(row=>row.id===expanded)&&<ResultsDrawer key={expanded} partnerId={partnerId} row={data.rows.find(row=>row.id===expanded)!} groupBy={groupBy} query={query.toString()} period={data.period} timezone={data.timezone} onClose={closeDetails} onScope={groupBy==='link'?scopeLink:undefined}/>}
      {inspection&&<ResultsDrawer partnerId={partnerId} row={inspection.row} groupBy="total" query={inspection.query} period={inspection.period} timezone={inspection.timezone} onClose={closeInspection} inspection={{metric:inspection.selection.metric,context:inspection.context,compareBy:inspection.compareBy,groups:inspection.groups}}/>}
      {explorer&&<ResultsExplorer partnerId={partnerId} metric={explorer.metric} query={explorer.query} report={explorer.report} context={explorer.context} onClose={closeExplorer} onPeriodsChange={applyPeriods} onComparisonClear={clearComparison}/>}
      {adminContext&&data.balances&&<details className="results-definition"><summary>Состояние выплат партнёра</summary><AnalyticsBalances report={data} partnerId={partnerId}/></details>}
      {adminContext&&<details className="results-definition"><summary>Как считаются показатели</summary><AnalyticsTrackingNotice report={data}/><p>Переходы, регистрации и оплаты — по датам событий. Оплачено клиентами — сумма первых и повторных оплат; возвраты указаны отдельно в подробностях. Ваш заработок — фактически начисленные комиссии с учётом возвратов, по дате начисления. Клиенты считаются без повторов за весь период; на графике — внутри каждого дня, недели или месяца. Выбранные площадки, форматы и сценарии учитываются во всём отчёте. Фильтр активности, поиск и сортировка меняют только таблицу. Конверсии относятся к переходам периода и связанным с ними регистрациям и оплатам по настоящее время. Дата публикации указана партнёром. Платежи локального симулятора и подозрительные переходы исключены.</p></details>}
      </div>
    </div>:null}
  </section>;
}

const hasActivity=(row:MetricRow)=>row.counts.clicks>0||row.counts.registrations>0||row.counts.paymentCount>0||Object.values(row.amountsMinor).some(value=>value!==0);
export function AnalyticsTrackingNotice({report}:{report:Pick<AnalyticsReport,'dataQuality'|'warnings'>}) {
  const missing=[report.dataQuality?.signupTracking==='no_events_observed'?'регистраций':null,report.dataQuality?.paymentTracking==='no_events_observed'?'оплат':null].filter(Boolean);
  if(missing.length)return <p className="results-note" role="note">Для выбранных источников пока нет полученных событий {missing.join(' и ')}. Отсутствие событий не означает ошибку подключения.</p>;
  if(![report.dataQuality?.signupTracking,report.dataQuality?.paymentTracking].some(status=>status==='not_verified_end_to_end')&&!report.warnings?.some(code=>/^(signup|payment)_tracking_unverified$/.test(code)))return null;
  return <p className="results-note" role="note">Передача регистраций и оплат ещё не подтверждена сквозной проверкой. В отчёте показаны полученные события; часть действий клиентов может отсутствовать.</p>;
}

export function AnalyticsBalances({report,partnerId}:{report:AnalyticsReport;partnerId?:string}) {
  if(!report.balances)return null;
  const currency=report.currency??'RUB';
  return <section className="results-balances results-surface" aria-label="Ручные выплаты за всё время"><div className="results-balances__heading"><div><h2>Ручные выплаты</h2><p>За всё время · {currency} · {partnerId?'выбранный партнёр':'выбранные партнёры'}. Балансы не зависят от периода и источников.</p></div><TenantLink className="results-button" to={`/payouts${partnerId?`?partnerId=${encodeURIComponent(partnerId)}`:''}`}>Перейти к ручным выплатам</TenantLink></div><dl>{[
    ['Ожидает подтверждения',report.balances.accrued??0],['К выплате',report.balances.available],['Ожидает выплаты',report.balances.pending],['Корректировка / долг',report.balances.debt??0],['Фактически выплачено',report.balances.paid],
  ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(Number(value),currency)}</dd></div>)}</dl></section>;
}


function ResultsTable({groupBy,rows,timezone,expanded,onExpand,currency='RUB'}:{groupBy:string;rows:MetricRow[];timezone?:string;expanded:string|null;onExpand:(id:string)=>void;currency?:string}) {
  const labels=useMetricLabels();
  const maxClicks=Math.max(1,...rows.map(row=>row.counts.clicks));
  return <VisualTable className="results-table"><VisualTableHead><VisualTableRow><VisualTableHeader>{({link:'Ссылка',material:'Материал',source:'Размещение',platform:'Площадка',scenario:'Сценарий',format:'Формат'} as Record<string,string>)[groupBy]}</VisualTableHeader><VisualTableHeader>Переходы</VisualTableHeader><VisualTableHeader>Регистрации</VisualTableHeader><VisualTableHeader>Платящие клиенты</VisualTableHeader><VisualTableHeader>Оплачено клиентами</VisualTableHeader><VisualTableHeader>{labels.earningsMinor}</VisualTableHeader></VisualTableRow></VisualTableHead><VisualTableBody>{rows.map(row=><VisualTableRow key={row.id} className={expanded===row.id?'is-expanded':''}><VisualTableCell><div className="results-row-identity"><span className="results-row-icon" aria-hidden="true">{groupBy==='platform'?<span>{row.name.slice(0,1)}</span>:<Link2 size={17}/>}</span><div>
    <VisualButton type="button" className="results-row-name" aria-expanded={expanded===row.id} aria-haspopup="dialog" onClick={()=>onExpand(row.id)}><span>{row.name}</span>{row.archived&&<small>Архив</small>}<ChevronRight size={14} aria-hidden="true"/></VisualButton>
    <span className="results-row-meta"><span title={row.platformNames?.join(' · ')}>{row.placement?`${row.placement.platformName}${row.placement.channelName?` · ${row.placement.channelName}`:''}`:row.material?.formatName??(groupBy!=='platform'&&row.platformNames?.length?`${row.platformNames.slice(0,2).join(' · ')}${row.platformNames.length>2?` · ещё ${row.platformNames.length-2}`:''}`:row.linkKey?`/r/${row.linkKey}`:'' )}</span>{row.createdAt&&<><i/><span>{groupBy==='material'?'Создан':'Создана'} {dateLabel(row.createdAt,timezone)}</span></>}</span>
    </div></div></VisualTableCell><VisualTableCell data-label="Переходы"><span className="results-click-value"><i aria-hidden="true" style={{width:`${row.counts.clicks/maxClicks*100}%`}}/><span>{row.counts.clicks.toLocaleString('ru-RU')}</span></span></VisualTableCell><VisualTableCell data-label="Регистрации">{row.counts.registrations.toLocaleString('ru-RU')}</VisualTableCell><VisualTableCell data-label="Платящие клиенты">{row.counts.payingCustomers.toLocaleString('ru-RU')}</VisualTableCell><VisualTableCell data-label="Оплачено клиентами">{money(row.amountsMinor.observedPayments/100,currency)}</VisualTableCell><VisualTableCell data-label={labels.earningsMinor} className={row.amountsMinor.netAccrued?'results-earned':''}>{money(row.amountsMinor.netAccrued/100,currency)}</VisualTableCell></VisualTableRow>)}</VisualTableBody></VisualTable>;
}
