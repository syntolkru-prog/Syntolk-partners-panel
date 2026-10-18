import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronRight, Download, GitCompareArrows, Link2, Search, SlidersHorizontal, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { TenantLink } from '../tenant-link.js';
import { api, currentTenantSlug } from '../api.js';
import { ErrorBanner, money } from '../ui.js';
import { usePartnerSelection } from '../lib/partner-selection.js';
import { ResultsChart, chartMetricKeys, defaultChartMetrics, type ChartMetric, type SeriesPoint, type ChartSeriesBy, type ChartInspection } from './ResultsChart.js';
import { ResultsDrawer, PaymentDetails, dateLabel } from './ResultsDetails.js';
import { downloadResultsCsv } from './results-export.js';
import { ResultsMultiSelect } from './ResultsMultiSelect.js';
import { ResultsExplorer } from './ResultsExplorer.js';
import { inspectionScope } from './results-scope.js';
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
  dataQuality?:{signupTracking?:string;paymentTracking?:string;views?:string;ctr?:string};
  warnings?:string[];
  counts:Counts;amountsMinor:Amounts;conversions:{clickToRegistration:number|null;registrationToPayment:number|null;clickToPayment:number|null};
  rows:MetricRow[];groupBy:string;options:{scenarios:Option[];platforms:Option[];formats:Option[]};
  balances:{total:number;available:number;pending:number;paid:number;accrued?:number;debt?:number;netPaidEarnings?:number};
  series?:{bucket:string;points:SeriesPoint[];by?:Exclude<ChartSeriesBy,'total'>;groups?:Array<{id:string;name:string;points:SeriesPoint[]}>};
  period?:{since:string;until:string};
  timezone?:string;
  comparison?:{period:{since:string;until:string};counts:Counts;amountsMinor:Amounts};
}

function selectedValues(params:URLSearchParams,field:string) {
  return [...new Set([...params.getAll(`${field}s`),...params.getAll(field)].filter(value=>value&&!['all','new'].includes(value)))];
}
function selectionCaption(options:Option[],ids:string[],label:string) {
  return ids.length>1?`${label}: ${ids.length}`:ids.length?options.find(option=>option.id===ids[0])?.name??(ids[0]==='__none__'?'Без сценария':'Выбранный вариант'):'';
}

export function PartnerResults({partnerId}:{partnerId:string}) {
  return <div className="results-layout"><PartnerAnalyticsPanel partnerId={partnerId}/></div>;
}

export function PartnerAnalyticsPanel({partnerId,adminContext=false}:{partnerId:string;adminContext?:boolean}) {
  const [params,setParams]=useSearchParams();
  const [expanded,setExpanded]=useState<string|null>(null),[search,setSearch]=useState(''),[filtersOpen,setFiltersOpen]=useState(params.get('period')==='custom');
  const [inspection,setInspection]=useState<{selection:ChartInspection;row:MetricRow;query:string;period?:AnalyticsReport['period'];context:string;timezone?:string;compareBy?:Exclude<ChartSeriesBy,'total'>;groups?:Option[]}|null>(null);
  const [explorer,setExplorer]=useState<{metric:ChartMetric;query:string;report:AnalyticsReport;context:string}|null>(null);
  const filterTrigger=useRef<HTMLButtonElement>(null),filters=useRef<HTMLDivElement>(null),payments=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{
      const target=event.target as Node;
      if((target as Element).closest?.('[data-results-menu]'))return;
      if(filtersOpen&&!filters.current?.contains(target)&&!filterTrigger.current?.contains(target))setFiltersOpen(false);
      if(payments.current?.open&&!payments.current.contains(target))payments.current.open=false;
    };
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||event.defaultPrevented)return;
      if(filtersOpen){setFiltersOpen(false);filterTrigger.current?.focus({preventScroll:true});}
      if(payments.current?.open){payments.current.open=false;payments.current.querySelector('summary')?.focus({preventScroll:true});}
    };
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[filtersOpen]);
  const metrics=[...new Set(params.getAll('metrics').filter((value):value is ChartMetric=>chartMetricKeys.includes(value as ChartMetric)))];
  const selectedMetrics:ChartMetric[]=metrics.length?metrics:defaultChartMetrics;
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
  const scenarioIds=selectedValues(params,'scenarioId'),platformIds=selectedValues(params,'platformId'),formatIds=selectedValues(params,'formatId');
  const period=['today','7d','30d','all','custom'].includes(params.get('period')??'')?params.get('period')!:'30d';
  const groupBy=['link','material','source','platform','scenario','format'].includes(params.get('groupBy')??'')?params.get('groupBy')!:'platform';
  const activity=params.get('activity')??'results',sort=params.get('sort')??'clicks';
  const includeEmpty=params.get('includeEmpty')==='true'||['empty','all'].includes(activity);
  const compare=params.get('compare')==='true'&&period!=='all';
  const query=new URLSearchParams({currency,period,groupBy,includeSeries:'true'});
  if(compare)query.set('includeComparison','true');
  if(includeEmpty)query.set('includeEmpty','true');
  if(programId)query.set('programId',programId);
  for(const [field,values] of [['scenarioIds',scenarioIds],['platformIds',platformIds],['formatIds',formatIds]] as const)for(const value of values)query.append(field,value);
  if(chartBy!=='total')query.set('seriesBy',chartBy);
  for(const field of ['materialId','linkId','sourceId','from','to'])if(params.get(field))query.set(field,params.get(field)!);
  const from=params.get('from')??'',to=params.get('to')??'';
  const customReady=period!=='custom'||!!(from&&to&&from<=to);
  const report=useQuery({queryKey:['partner-analytics',currentTenantSlug(),partnerId,query.toString()],queryFn:()=>api<AnalyticsReport>(`/partners/${partnerId}/analytics?${query}`),enabled:customReady&&!programs.isLoading,refetchInterval:adminContext?false:30000,
    placeholderData:(previous,previousQuery)=>previousQuery?.queryKey[1]===currentTenantSlug()&&previousQuery.queryKey[2]===partnerId&&new URLSearchParams(String(previousQuery.queryKey[3]??'')).get('programId')===query.get('programId')&&new URLSearchParams(String(previousQuery.queryKey[3]??'')).get('currency')===currency?previous:undefined});
  const data=report.data;
  const owner=`${currentTenantSlug()??'default'}:${partnerId}`;
  const [previousOptions,setPreviousOptions]=useState<{owner:string;programId:string;options:AnalyticsReport['options']}|null>(null);
  useEffect(()=>{if(data)setPreviousOptions({owner,programId,options:data.options});},[data,owner,programId]);
  const options=data?.options??(previousOptions?.owner===owner&&previousOptions.programId===programId?previousOptions.options:{scenarios:[],platforms:[],formats:[]});
  const update=(field:string,value:string)=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set(field,value);else next.delete(field);return next;});
  const chooseValues=(field:'scenarioId'|'platformId'|'formatId',values:string[])=>{
    if(!adminContext&&field==='scenarioId'&&values.length===1)selection.rememberScenario(values[0]!);
    setParams(previous=>{
      const next=new URLSearchParams(previous);next.delete(field);next.delete(`${field}s`);
      for(const value of values)next.append(`${field}s`,value);
      if(values.length>1&&!next.has('chartBy'))next.set('chartBy',field.slice(0,-2));
      return next;
    });
  };
  const reset=()=>{setSearch('');setExpanded(null);setParams(previous=>{const next=new URLSearchParams(previous);for(const field of ['scenarioId','scenarioIds','platformId','platformIds','formatId','formatIds','materialId','linkId','sourceId','groupBy','chartBy','activity','includeEmpty','sort'])next.delete(field);return next;});};
  const showEmpty=(checked:boolean)=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('activity');if(checked)next.set('includeEmpty','true');else next.delete('includeEmpty');return next;});
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
  useEffect(()=>{setExpanded(null);setInspection(null);setExplorer(null);},[partnerId,currency,groupBy,chartBy,programId,scenarioIds.join(','),platformIds.join(','),formatIds.join(','),period,from,to,params.get('materialId'),params.get('linkId'),params.get('sourceId')]);
  const visibleRows=[...(data?.rows??[])].filter(row=>(includeEmpty||hasActivity(row))&&(!search||`${row.name} ${row.linkKey??''} ${row.placement?.channelName??''}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')))&&(activity!=='clicks'||row.counts.clicks>0)&&(activity!=='empty'||!hasActivity(row)))
    .sort((a,b)=>(sort==='earnings'?b.amountsMinor.netAccrued-a.amountsMinor.netAccrued:sort==='payments'?b.amountsMinor.observedPayments-a.amountsMinor.observedPayments:sort==='date'?(b.createdAt??'').localeCompare(a.createdAt??''):b.counts.clicks-a.counts.clicks)||b.counts.clicks-a.counts.clicks||a.name.localeCompare(b.name,'ru',{numeric:true}));
  return <section className="results-page">
    <header className="results-header"><div className="results-header__title"><h1>Результаты</h1><div className="results-context">{activeFilters>0&&<><span>{params.has('linkId')?`Ссылка: ${data?.rows.find(row=>row.id===params.get('linkId'))?.name??'выбранная'}`:params.has('materialId')?'Выбран один материал':[selectionCaption(options.scenarios,scenarioIds,'Сценарии'),selectionCaption(options.platforms,platformIds,'Площадки'),selectionCaption(options.formats,formatIds,'Форматы')].filter(Boolean).join(' · ')||'Выбраны фильтры'}</span><button type="button" onClick={reset}><X size={13} aria-hidden="true"/>Показать все</button></>}</div></div><div className="results-header__actions">
      <label className="results-period"><CalendarDays size={15} aria-hidden="true"/><select aria-label="Период аналитики" value={period} onChange={e=>{update('period',e.target.value);if(e.target.value==='custom')setFiltersOpen(true);}}><option value="today">Сегодня</option><option value="7d">Последние 7 дней</option><option value="30d">Последние 30 дней</option><option value="all">Весь период</option><option value="custom">Свои даты</option></select></label>
      <select aria-label="Валюта аналитики" value={currency} onChange={event=>update('currency',event.target.value)}>{[...new Set(['RUB','USD','EUR',currency])].map(code=><option key={code} value={code}>{code}</option>)}</select>
      <button type="button" className={compare?'results-button is-active':'results-button'} aria-pressed={compare} disabled={period==='all'} title={period==='all'?'Для сравнения выберите ограниченный период':'Сравнить с предыдущим периодом той же длины'} onClick={()=>update('compare',compare?'':'true')}><GitCompareArrows size={15} aria-hidden="true"/>Сравнить периоды</button>
      <button type="button" className={filtersOpen?'results-button is-active':'results-button'} ref={filterTrigger} aria-expanded={filtersOpen} aria-controls="results-filters" onClick={()=>setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={15} aria-hidden="true"/>Фильтры<span className={activeFilters?'results-count':'results-count is-empty'} aria-hidden={!activeFilters}>{activeFilters||'0'}</span></button>
    </div>
    <div ref={filters} id="results-filters" className="results-filters results-surface" hidden={!filtersOpen}>
      {period==='custom'&&<div className="results-dates"><label>С<input aria-label="Начало периода" type="date" value={from} max={to||undefined} onChange={e=>update('from',e.target.value)}/></label><label>По<input aria-label="Конец периода" type="date" value={to} min={from||undefined} onChange={e=>update('to',e.target.value)}/></label></div>}
      {(adminContext||(programs.data?.programs?.length??0)>1)&&<label className="coach-field"><span>Программа</span><select aria-label="Программа аналитики" value={programId} onChange={e=>{if(!adminContext)selection.selectProgram(e.target.value);setSearch('');setParams(previous=>{const next=new URLSearchParams(previous);next.set('programId',e.target.value);for(const key of ['scenarioId','scenarioIds','platformId','platformIds','formatId','formatIds','materialId','linkId','sourceId'])next.delete(key);return next;});}}>{adminContext&&<option value="">Все программы</option>}{programs.data?.programs.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <label className="coach-field"><span>Активность</span><select aria-label="Активность ссылок" value={includeEmpty&&activity==='results'?'all':activity} onChange={e=>{setParams(previous=>{const next=new URLSearchParams(previous);next.delete('includeEmpty');next.set('activity',e.target.value);return next;});}}><option value="results">С результатами</option><option value="clicks">Только с переходами</option><option value="empty">Без результатов</option><option value="all">Все</option></select></label>
      <button type="button" className="results-reset" onClick={reset}>Сбросить фильтры</button>
    </div>
    </header>
    <div className="results-filterbar results-surface" aria-label="Отбор результатов">
      <ResultsMultiSelect key={`scenario-${programId}`} label="Сценарии" ariaLabel="Сценарий аналитики" allLabel="Все сценарии" options={[...options.scenarios,{id:'__none__',name:'Без сценария'}]} value={scenarioIds} onChange={values=>chooseValues('scenarioId',values)}/>
      <ResultsMultiSelect key={`platform-${programId}`} label="Площадки" ariaLabel="Площадка аналитики" allLabel="Все площадки" options={[...options.platforms,{id:'__none__',name:'Площадка не указана'}]} value={platformIds} onChange={values=>chooseValues('platformId',values)}/>
      <ResultsMultiSelect key={`format-${programId}`} label="Форматы" ariaLabel="Формат аналитики" allLabel="Все форматы" options={options.formats} value={formatIds} onChange={values=>chooseValues('formatId',values)}/>
    </div>
    <ErrorBanner error={report.error??programs.error??downloadError}/>
    {!customReady&&!data?<div className="results-empty results-surface" role="status">{from&&to?'Конец периода не может быть раньше начала.':'Выберите начало и конец периода.'}</div>:report.isLoading||programs.isLoading?<div className="results-loading results-surface" role="status">Загружаем статистику…</div>:data?<div className="results-report" data-pending={report.isPlaceholderData||!customReady} aria-busy={report.isFetching}>
      {(report.isPlaceholderData||!customReady)&&<span className="results-report__pending" role="status">{!customReady?(from&&to?'Конец периода не может быть раньше начала.':'Выберите начало и конец периода.'):'Обновляем статистику…'}</span>}
      <div className="results-report__content" aria-hidden={report.isPlaceholderData||!customReady||undefined} {...{inert:report.isPlaceholderData||!customReady?'':undefined}}>
      <AnalyticsTrackingNotice report={data}/>
      {adminContext&&<AnalyticsBalances report={data} partnerId={partnerId}/>}
      {data.counts.identities!==undefined&&<button type="button" className="results-text-button" onClick={()=>setMetric('identities')}>Связанные пользователи: {data.counts.identities.toLocaleString('ru-RU')}</button>}
      <ResultsChart currency={data.currency??currency} series={data.series} metric={metric} onChange={setMetric} metrics={selectedMetrics} onMetricsChange={setMetrics} seriesBy={chartBy} onSeriesByChange={setChartBy} onInspect={inspect} onExpand={expandChart}
        totals={{clicks:data.counts.clicks,identities:data.counts.identities??0,registrations:data.counts.registrations,payingCustomers:data.counts.payingCustomers,payments:data.counts.paymentCount,customerPaymentsMinor:data.amountsMinor.observedPayments,earningsMinor:data.amountsMinor.netAccrued}}
        paymentCounts={{first:data.counts.firstPaymentCount,repeat:data.counts.repeatPaymentCount}}
        changes={compare&&data.comparison?Object.fromEntries([
          ['clicks',data.counts.clicks,data.comparison.counts.clicks],['registrations',data.counts.registrations,data.comparison.counts.registrations],
          ['payingCustomers',data.counts.payingCustomers,data.comparison.counts.payingCustomers],['payments',data.counts.paymentCount,data.comparison.counts.paymentCount],
          ['customerPaymentsMinor',data.amountsMinor.observedPayments,data.comparison.amountsMinor.observedPayments],['earningsMinor',data.amountsMinor.netAccrued,data.comparison.amountsMinor.netAccrued],
        ].map(([key,value,previous])=>[key,comparisonLabel(Number(value),Number(previous),String(key).endsWith('Minor'),data.currency??currency)])):undefined}
        comparison={compare&&data.comparison?<p className="results-comparison-note">Предыдущий период: {dateLabel(data.comparison.period.since,data.timezone)} — {dateLabel(new Date(Date.parse(data.comparison.period.until)-1).toISOString(),data.timezone)}</p>:undefined}/>
      <details ref={payments} className="results-payments"><summary>Оплаты и конверсии<ChevronDown size={14} aria-hidden="true"/></summary><PaymentDetails row={data} currency={data.currency??currency}/></details>
      <section className="results-performance results-surface" aria-labelledby="results-table-title" aria-busy={report.isFetching}>
        <div className="results-performance__heading"><div><h2 id="results-table-title">Эффективность {groupBy==='link'?'ссылок':groupBy==='material'?'материалов':groupBy==='source'?'размещений':groupBy==='platform'?'площадок':groupBy==='format'?'форматов':'сценариев'}</h2><span>{activity==='empty'?'Без действий за выбранный период':activity==='clicks'?'С переходами за выбранный период':includeEmpty?'Включая источники без действий':'С действиями за выбранный период'}</span></div><label className="results-empty-toggle"><input type="checkbox" checked={includeEmpty} onChange={e=>showEmpty(e.target.checked)}/>Показать без результатов</label></div>
        <div className="results-table-tools"><label className="coach-field results-grouping"><select aria-label="Разбивка аналитики" value={groupBy} onChange={e=>update('groupBy',e.target.value)}><option value="platform">По площадкам</option><option value="link">По ссылкам</option><option value="material">По материалам</option><option value="source">По размещениям</option><option value="scenario">По сценариям</option><option value="format">По форматам</option></select></label><label className="results-search"><Search size={15} aria-hidden="true"/><input aria-label={groupBy==='material'?'Найти материал':'Поиск результатов'} placeholder={groupBy==='material'?'Найти материал':'Найти в таблице'} value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="results-table-actions"><select aria-label="Сортировка результатов" value={sort} onChange={e=>update('sort',e.target.value)}><option value="clicks">Больше переходов</option><option value="earnings">Больше заработок</option><option value="payments">Больше оплат клиентов</option><option value="date">Сначала новые</option></select><button type="button" className="results-button" aria-label="Скачать отчёт CSV" title="Скачать строки с текущими фильтрами и сортировкой" disabled={!visibleRows.length} onClick={()=>{try{downloadResultsCsv(visibleRows,data.period,data.currency??currency);setDownloadError(null);}catch{setDownloadError(new Error('Не удалось скачать отчёт. Повторите попытку.'));}}}><Download size={14} aria-hidden="true"/>CSV</button></div></div>
        <div className="results-table-viewport">{visibleRows.length?<ResultsTable currency={data.currency??currency} groupBy={groupBy} rows={visibleRows} timezone={data.timezone} expanded={expanded} onExpand={setExpanded}/>:<div className="results-empty"><Link2 size={24} aria-hidden="true"/><strong>{search?'Ничего не найдено.':activity==='empty'?'Источников без результатов нет.':includeEmpty?'По выбранным фильтрам данных нет.':'За выбранный период нет действий.'}</strong>{!search&&!includeEmpty&&<span>Покажите строки без результатов или выберите другой период.</span>}</div>}</div>
      </section>
      {data.rows.find(row=>row.id===expanded)&&<ResultsDrawer key={expanded} partnerId={partnerId} row={data.rows.find(row=>row.id===expanded)!} groupBy={groupBy} query={query.toString()} period={data.period} timezone={data.timezone} onClose={closeDetails} onScope={groupBy==='link'?scopeLink:undefined}/>}
      {inspection&&<ResultsDrawer partnerId={partnerId} row={inspection.row} groupBy="total" query={inspection.query} period={inspection.period} timezone={inspection.timezone} onClose={closeInspection} inspection={{metric:inspection.selection.metric,context:inspection.context,compareBy:inspection.compareBy,groups:inspection.groups}}/>}
      {explorer&&<ResultsExplorer partnerId={partnerId} metric={explorer.metric} query={explorer.query} report={explorer.report} context={explorer.context} onClose={closeExplorer}/>}
      <details className="results-definition"><summary>Как считаются показатели</summary><p>Переходы, регистрации и оплаты — по датам событий. Оплачено клиентами — сумма первых и повторных оплат; возвраты указаны отдельно в подробностях. Ваш заработок — фактически начисленные комиссии с учётом возвратов, по дате начисления. Клиенты считаются без повторов за весь период; на графике — внутри каждого дня, недели или месяца. Выбранные площадки, форматы и сценарии учитываются во всём отчёте. Фильтр активности, поиск и сортировка меняют только таблицу. Конверсии относятся к переходам периода и связанным с ними регистрациям и оплатам по настоящее время. Дата публикации указана партнёром. Платежи локального симулятора и подозрительные переходы исключены.</p></details>
      </div>
    </div>:null}
  </section>;
}

const hasActivity=(row:MetricRow)=>row.counts.clicks>0||row.counts.registrations>0||row.counts.paymentCount>0||Object.values(row.amountsMinor).some(value=>value!==0);
export function AnalyticsTrackingNotice({report}:{report:Pick<AnalyticsReport,'dataQuality'|'warnings'>}) {
  if(![report.dataQuality?.signupTracking,report.dataQuality?.paymentTracking].some(status=>status==='not_verified_end_to_end')&&!report.warnings?.some(code=>/^(signup|payment)_tracking_unverified$/.test(code)))return null;
  return <p className="results-note" role="note">Передача регистраций и оплат ещё не подтверждена сквозной проверкой. В отчёте показаны полученные события; часть действий клиентов может отсутствовать.</p>;
}

export function AnalyticsBalances({report,partnerId}:{report:AnalyticsReport;partnerId?:string}) {
  const currency=report.currency??'RUB';
  return <section className="results-balances results-surface" aria-label="Ручные выплаты за всё время"><div className="results-balances__heading"><div><h2>Ручные выплаты</h2><p>За всё время · {currency} · {partnerId?'выбранный партнёр':'выбранные партнёры'}. Балансы не зависят от периода и источников.</p></div><TenantLink className="results-button" to={`/payouts${partnerId?`?partnerId=${encodeURIComponent(partnerId)}`:''}`}>Перейти к ручным выплатам</TenantLink></div><dl>{[
    ['Ожидает подтверждения',report.balances.accrued??0],['К выплате',report.balances.available],['Ожидает выплаты',report.balances.pending],['Корректировка / долг',report.balances.debt??0],['Фактически выплачено',report.balances.paid],
  ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(Number(value),currency)}</dd></div>)}</dl></section>;
}

function comparisonLabel(value:number,previous:number,monetary=false,currency='RUB') {
  if(value===previous)return 'Без изменений';
  if(previous===0)return 'Ранее — 0';
  const change=(value-previous)/Math.abs(previous)*100;
  return `${change>0?'↑':'↓'} ${Math.abs(change).toLocaleString('ru-RU',{maximumFractionDigits:1})}% · было ${monetary?money(previous/100,currency):previous.toLocaleString('ru-RU')}`;
}

function ResultsTable({groupBy,rows,timezone,expanded,onExpand,currency='RUB'}:{groupBy:string;rows:MetricRow[];timezone?:string;expanded:string|null;onExpand:(id:string)=>void;currency?:string}) {
  const maxClicks=Math.max(1,...rows.map(row=>row.counts.clicks));
  return <table className="results-table"><thead><tr><th>{({link:'Ссылка',material:'Материал',source:'Размещение',platform:'Площадка',scenario:'Сценарий',format:'Формат'} as Record<string,string>)[groupBy]}</th><th>Переходы</th><th>Связанные пользователи</th><th>Регистрации</th><th>Платящие клиенты</th><th>Оплачено клиентами</th><th>Ваш заработок</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} className={expanded===row.id?'is-expanded':''}><td><div className="results-row-identity"><span className="results-row-icon" aria-hidden="true">{groupBy==='platform'?<span>{row.name.slice(0,1)}</span>:<Link2 size={17}/>}</span><div>
    <button type="button" className="results-row-name" aria-expanded={expanded===row.id} aria-haspopup="dialog" onClick={()=>onExpand(row.id)}><span>{row.name}</span>{row.archived&&<small>Архив</small>}<ChevronRight size={14} aria-hidden="true"/></button>
    <span className="results-row-meta"><span title={row.platformNames?.join(' · ')}>{row.placement?`${row.placement.platformName}${row.placement.channelName?` · ${row.placement.channelName}`:''}`:row.material?.formatName??(groupBy!=='platform'&&row.platformNames?.length?`${row.platformNames.slice(0,2).join(' · ')}${row.platformNames.length>2?` · ещё ${row.platformNames.length-2}`:''}`:row.linkKey?`/r/${row.linkKey}`:'' )}</span>{row.createdAt&&<><i/><span>{groupBy==='material'?'Создан':'Создана'} {dateLabel(row.createdAt,timezone)}</span></>}</span>
    </div></div></td><td data-label="Переходы"><span className="results-click-value"><i aria-hidden="true" style={{width:`${row.counts.clicks/maxClicks*100}%`}}/><span>{row.counts.clicks.toLocaleString('ru-RU')}</span></span></td><td data-label="Связанные пользователи">{(row.counts.identities??0).toLocaleString('ru-RU')}</td><td data-label="Регистрации">{row.counts.registrations.toLocaleString('ru-RU')}</td><td data-label="Платящие клиенты">{row.counts.payingCustomers.toLocaleString('ru-RU')}</td><td data-label="Оплачено клиентами">{money(row.amountsMinor.observedPayments/100,currency)}</td><td data-label="Ваш заработок" className={row.amountsMinor.netAccrued?'results-earned':''}>{money(row.amountsMinor.netAccrued/100,currency)}</td></tr>)}</tbody></table>;
}
