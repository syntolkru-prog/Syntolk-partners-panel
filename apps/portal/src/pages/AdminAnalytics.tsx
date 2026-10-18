import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { api, currentTenantSlug } from '../api.js';
import { ErrorBanner, money } from '../ui.js';
import { TenantLink } from '../tenant-link.js';
import { AnalyticsBalances, AnalyticsTrackingNotice, PartnerAnalyticsPanel, type AnalyticsReport, type MetricRow } from './PartnerAnalytics.js';
import { ResultsChart, chartMetricKeys, defaultChartMetrics, type ChartInspection, type ChartMetric, type ChartSeriesBy } from './ResultsChart.js';
import { ResultsExplorer } from './ResultsExplorer.js';
import { ResultsDrawer } from './ResultsDetails.js';
import { ResultsDatePicker, calendarDay } from './ResultsDatePicker.js';
import { ResultsMultiSelect } from './ResultsMultiSelect.js';
import { inspectionScope } from './results-scope.js';
import './results.css';
import './admin-analytics.css';

interface Pagination { page:number;pageSize:number;total:number;totalPages:number }
interface PartnerOption { id:string;name:string;email:string;status:string }
interface PartnerRow extends MetricRow, PartnerOption { balances:AnalyticsReport['balances'] }
interface AdminReport extends AnalyticsReport {
  summary:{partners:number;activePartners:number};
  partnerTable:{rows:PartnerRow[];pagination:Pagination};
  diagnostics?:{flaggedClicks:number;legacyFinancialEventsWithoutExternalId:number;refundAdjustments:{count:number;amountMinor:number};outstandingDebtMinor:number;basis?:{legacyEvents:string}};
}
const selected=(params:URLSearchParams,key:string)=>[...new Set([...params.getAll(key),...params.getAll(key.replace(/Ids$/,'Id'))].filter(Boolean))];
const integer=(value:string|null,fallback:number,max:number)=>value&&/^\d+$/.test(value)?Math.max(1,Math.min(max,Number(value))):fallback;
const sortLabels:Record<string,string>={name:'Имя',email:'Email',status:'Статус',createdAt:'Дата создания',clicks:'Переходы',identities:'Связанные пользователи',registrations:'Регистрации',payingCustomers:'Платящие клиенты',paymentCount:'Оплаты',observedPayments:'Оплачено клиентами',netAccrued:'Комиссии'};
const statusLabel:Record<string,string>={active:'Активен',pending:'Приглашён',revoked:'Доступ отозван'};
const number=(value:number)=>value.toLocaleString('ru-RU');
const reportScope=(query:string)=>{const scope=new URLSearchParams(query);for(const key of ['search','sort','direction','page','pageSize'])scope.delete(key);return scope.toString();};

export function AdminAnalytics() {
  const [params]=useSearchParams();
  const partnerId=params.get('selectedPartner');
  if(partnerId){
    const back=new URLSearchParams(params.get('returnTo')??'');
    back.delete('selectedPartner');back.delete('returnTo');back.delete('selectedPartnerName');
    return <div className="results-layout admin-analytics">
      <div className="admin-analytics__detail-heading"><TenantLink to={`/admin/analytics?${back}`} className="results-button"><ArrowLeft size={15}/>К аналитике партнёров</TenantLink><span>{params.get('selectedPartnerName')??'Выбранный партнёр'}</span><TenantLink to={`/admin/partners/${encodeURIComponent(partnerId)}`}>Карточка партнёра</TenantLink></div>
      <PartnerAnalyticsPanel key={partnerId} partnerId={partnerId} adminContext/>
    </div>;
  }
  return <AdminAnalyticsOverview/>;
}

function AdminAnalyticsOverview() {
  const [params,setParams]=useSearchParams();
  const [explorer,setExplorer]=useState<{metric:ChartMetric;query:string;report:AnalyticsReport}|null>(null);
  const [inspection,setInspection]=useState<{selection:ChartInspection;query:string;period?:AnalyticsReport['period'];report:AnalyticsReport}|null>(null);
  const closeExplorer=useCallback(()=>setExplorer(null),[]),closeInspection=useCallback(()=>setInspection(null),[]);
  const [search,setSearch]=useState(params.get('search')??'');
  const currency=/^[A-Z]{3}$/.test(params.get('currency')??'')?params.get('currency')!:'RUB';
  const period=['today','7d','30d','all','custom'].includes(params.get('period')??'')?params.get('period')!:'30d';
  const partners=selected(params,'partnerIds').slice(0,50);
  const page=integer(params.get('page'),1,100000),pageSize=integer(params.get('pageSize'),20,100);
  const sort=params.get('tableSort')??'netAccrued',direction=params.get('tableDirection')==='asc'?'asc':'desc';
  const programId=params.get('programId')??'',from=params.get('from')??'',to=params.get('to')??'';
  const chartBy:ChartSeriesBy=['platform','format','scenario'].includes(params.get('chartBy')??'')?params.get('chartBy') as ChartSeriesBy:'total';
  const metrics=params.getAll('metrics').filter((value):value is ChartMetric=>chartMetricKeys.includes(value as ChartMetric));
  const selectedMetrics=metrics.length?[...new Set(metrics)]:defaultChartMetrics;
  const customReady=period!=='custom'||!!(from&&to&&from<=to);
  const query=new URLSearchParams({period,currency,groupBy:'partner',includeSeries:'true',page:String(page),pageSize:String(pageSize),sort:sort in sortLabels?sort:'netAccrued',direction});
  if(programId)query.set('programId',programId);
  for(const field of ['partnerIds','scenarioIds','platformIds','formatIds'])for(const value of selected(params,field))query.append(field,value);
  for(const field of ['materialId','linkId','sourceId','from','to'])if(params.get(field))query.set(field,params.get(field)!);
  if(params.get('search'))query.set('search',params.get('search')!);
  if(chartBy!=='total')query.set('seriesBy',chartBy);
  const report=useQuery({queryKey:['admin-analytics',currentTenantSlug(),query.toString()],queryFn:()=>api<AdminReport>(`/admin/analytics?${query}`),enabled:customReady,
    placeholderData:(previous,previousQuery)=>previousQuery?.queryKey[1]===currentTenantSlug()&&reportScope(String(previousQuery.queryKey[2]??''))===reportScope(query.toString())?previous:undefined});
  const programs=useQuery({queryKey:['admin-analytics-programs',currentTenantSlug()],queryFn:()=>api<{programs:Array<{id:string;name:string}>}>('/programs')});
  const data=report.data,options=data?.options??{scenarios:[],platforms:[],formats:[]};
  const update=(key:string,value:string,tableOnly=false)=>setParams(previous=>{
    const next=new URLSearchParams(previous);if(value)next.set(key,value);else next.delete(key);
    if(key!=='page')next.delete('page');
    if(!tableOnly){setExplorer(null);setInspection(null);}
    return next;
  });
  const updateMany=(key:string,values:string[])=>{setExplorer(null);setInspection(null);setParams(previous=>{const next=new URLSearchParams(previous);next.delete(key);next.delete(key.replace(/Ids$/,'Id'));next.delete('page');for(const value of values)next.append(key,value);return next;});};
  useEffect(()=>{setSearch(params.get('search')??'');},[params.get('search')]);
  useEffect(()=>{
    if(search===(params.get('search')??''))return;
    const timer=window.setTimeout(()=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('page');if(search.trim())next.set('search',search.trim().slice(0,200));else next.delete('search');return next;},{replace:true}),300);
    return()=>window.clearTimeout(timer);
  },[search,params.get('search'),setParams]);
  const setMetrics=(values:ChartMetric[])=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('metrics');for(const value of values)next.append('metrics',value);return next;});
  const inspect=(selection:ChartInspection)=>{if(data){const scope=inspectionScope(query.toString(),selection,data);setExplorer(null);setInspection({selection,...scope,report:data});}};
  const detailLink=(row:PartnerRow)=>{const next=new URLSearchParams(params);next.set('selectedPartner',row.id);next.set('selectedPartnerName',row.name);next.set('returnTo',params.toString());return `/admin/analytics?${next}`;};
  const today=calendarDay(new Date().toISOString(),data?.timezone);
  const pagination=data?.partnerTable.pagination;
  const reportCurrency=data?.currency??currency;
  const financial=data?[
    ['Связанные пользователи',number(data.counts.identities??0)],
    ['Возвраты клиентов',money(data.amountsMinor.refunds/100,reportCurrency)],
    ['Чистые оплаты клиентов',money(data.amountsMinor.netPayments/100,reportCurrency)],
  ]:[];
  return <div className="results-layout admin-analytics"><section className="results-page">
    <header className="results-header"><div className="results-header__title"><h1>Аналитика партнёров</h1><p className="admin-analytics__subtitle">Действия и комиссии за выбранный период</p></div><div className="results-header__actions">
      <select aria-label="Период аналитики" value={period} onChange={event=>update('period',event.target.value)}><option value="today">Сегодня</option><option value="7d">Последние 7 дней</option><option value="30d">Последние 30 дней</option><option value="all">Весь период</option><option value="custom">Свои даты</option></select>
      <select aria-label="Валюта аналитики" value={currency} onChange={event=>update('currency',event.target.value)}>{[...new Set(['RUB','USD','EUR',currency])].map(code=><option key={code}>{code}</option>)}</select>
      <button type="button" className="results-button" disabled={report.isFetching||!customReady} onClick={()=>void report.refetch()}><RefreshCw size={14}/>Обновить</button>
    </div></header>
    <div className="admin-analytics__filters results-surface">
      {period==='custom'&&<ResultsDatePicker label="Даты аналитики партнёров" value={{from:from||today,to:to||today}} timezone={data?.timezone} onChange={range=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('period','custom');next.set('from',range.from);next.set('to',range.to);next.delete('page');return next;})}/>}
      <label className="coach-field"><span>Программа</span><select aria-label="Программа аналитики" value={programId} onChange={event=>setParams(previous=>{const next=new URLSearchParams(previous);if(event.target.value)next.set('programId',event.target.value);else next.delete('programId');for(const key of ['page','scenarioId','scenarioIds','platformId','platformIds','formatId','formatIds','materialId','linkId','sourceId'])next.delete(key);return next;})}><option value="">Все программы</option>{programs.data?.programs.map(program=><option key={program.id} value={program.id}>{program.name}</option>)}</select></label>
      <PartnerPicker value={partners} onChange={values=>updateMany('partnerIds',values)}/>
      <ResultsMultiSelect label="Сценарии" ariaLabel="Сценарий аналитики" allLabel="Все сценарии" options={[...options.scenarios,{id:'__none__',name:'Без сценария'}]} value={selected(params,'scenarioIds')} onChange={values=>updateMany('scenarioIds',values)}/>
      <ResultsMultiSelect label="Площадки" ariaLabel="Площадка аналитики" allLabel="Все площадки" options={[...options.platforms,{id:'__none__',name:'Площадка не указана'}]} value={selected(params,'platformIds')} onChange={values=>updateMany('platformIds',values)}/>
      <ResultsMultiSelect label="Форматы" ariaLabel="Формат аналитики" allLabel="Все форматы" options={options.formats} value={selected(params,'formatIds')} onChange={values=>updateMany('formatIds',values)}/>
      {(['materialId','linkId','sourceId'] as const).map((key,index)=>params.has(key)&&<button type="button" className="results-button" key={key} onClick={()=>update(key,'')}>{['Материал','Ссылка','Размещение'][index]}: выбран · Сбросить</button>)}
    </div>
    <ErrorBanner error={report.error??programs.error}/>
    {!customReady?<div className="results-empty results-surface" role="status">Выберите начало и конец периода в календаре.</div>:report.isLoading?<div className="results-loading results-surface" role="status">Загружаем аналитику партнёров…</div>:!data?null:<>
      <div className="admin-analytics__scope"><span>Активных партнёров за период: <strong>{number(data.summary.activePartners)}</strong> из {number(data.summary.partners)}</span><span>{data.timezone??'Europe/Moscow'} · {reportCurrency}</span></div>
      <ResultsChart currency={reportCurrency} series={data.series} metric={selectedMetrics[0]!} metrics={selectedMetrics} onChange={metric=>setMetrics([metric])} onMetricsChange={setMetrics} seriesBy={chartBy} onSeriesByChange={by=>update('chartBy',by==='total'?'':by)} onInspect={inspect} onExpand={metric=>setExplorer({metric,query:query.toString(),report:data})}
        totals={{clicks:data.counts.clicks,identities:data.counts.identities??0,registrations:data.counts.registrations,payingCustomers:data.counts.payingCustomers,payments:data.counts.paymentCount,customerPaymentsMinor:data.amountsMinor.observedPayments,earningsMinor:data.amountsMinor.netAccrued}} paymentCounts={{first:data.counts.firstPaymentCount,repeat:data.counts.repeatPaymentCount}}/>
      <dl className="admin-analytics__financial results-surface">{financial.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}{label==='Связанные пользователи'&&<button type="button" className="results-text-button" aria-label="Динамика связанных пользователей" onClick={()=>setMetrics(['identities'])}>Динамика</button>}</dd></div>)}</dl>
      <AnalyticsBalances report={data} partnerId={partners.length===1?partners[0]:undefined}/>
      <section className="results-performance results-surface" aria-labelledby="admin-partners-table-title" aria-busy={report.isFetching}>
        <div className="results-performance__heading"><div><h2 id="admin-partners-table-title">Партнёры</h2><span>Поиск и сортировка меняют только таблицу</span></div></div>
        <div className="results-table-tools"><label className="results-search"><Search size={15}/><input aria-label="Найти партнёра в таблице" placeholder="Имя или email" maxLength={200} value={search} onChange={event=>setSearch(event.target.value)}/></label><div className="results-table-actions"><select aria-label="Сортировка партнёров" value={sort in sortLabels?sort:'netAccrued'} onChange={event=>update('tableSort',event.target.value,true)}>{Object.entries(sortLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select aria-label="Порядок сортировки" value={direction} onChange={event=>update('tableDirection',event.target.value,true)}><option value="desc">По убыванию</option><option value="asc">По возрастанию</option></select></div></div>
        {report.isPlaceholderData&&<p className="results-note" role="status">Обновляем таблицу партнёров…</p>}
        <div className="admin-analytics__table-scroll" data-pending={report.isPlaceholderData} tabIndex={0} role="region" aria-label="Таблица партнёров: прокрутка по горизонтали" {...{inert:report.isPlaceholderData?'':undefined}}>
          <table className="results-table admin-analytics__table"><thead><tr>{['Партнёр','Переходы','Связанные пользователи','Регистрации','Платящие клиенты','Оплаты','Оплачено клиентами','Возвраты','Чистые оплаты','Комиссии','К выплате · всё время','Долг · всё время','Фактически выплачено · всё время'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.partnerTable.rows.map(row=><tr key={row.id}><td><TenantLink className="results-row-name" to={detailLink(row)}>{row.name}<ChevronRight size={14}/></TenantLink><span className="admin-analytics__partner-meta">{row.email}<br/>{statusLabel[row.status]??'Статус не указан'}</span></td>{[row.counts.clicks,row.counts.identities??0,row.counts.registrations,row.counts.payingCustomers,row.counts.paymentCount].map((value,index)=><td key={index}>{number(value)}</td>)}{[row.amountsMinor.observedPayments/100,row.amountsMinor.refunds/100,row.amountsMinor.netPayments/100,row.amountsMinor.netAccrued/100,row.balances.available,row.balances.debt??0,row.balances.paid].map((value,index)=><td key={`money-${index}`}>{money(value,reportCurrency)}</td>)}</tr>)}</tbody></table>
          {!data.partnerTable.rows.length&&<div className="results-empty" role="status">{params.get('search')?'Партнёры не найдены. Измените поиск.':'По выбранным фильтрам партнёров нет.'}</div>}
        </div>
        {pagination&&<div className="admin-analytics__pagination"><span>Найдено: {number(pagination.total)} · Страница {pagination.page} из {Math.max(1,pagination.totalPages)}</span><label>Строк<select aria-label="Партнёров на странице" value={pageSize} onChange={event=>update('pageSize',event.target.value,true)}>{[20,50,100].map(size=><option key={size}>{size}</option>)}</select></label><button type="button" className="results-button" aria-label="Предыдущая страница партнёров" disabled={page<=1||report.isFetching} onClick={()=>update('page',String(page-1),true)}><ChevronLeft size={16}/></button><button type="button" className="results-button" aria-label="Следующая страница партнёров" disabled={page>=pagination.totalPages||report.isFetching} onClick={()=>update('page',String(page+1),true)}><ChevronRight size={16}/></button></div>}
      </section>
      <details className="admin-analytics__quality results-surface">
        <summary>Качество данных · {data.dataQuality?.signupTracking==='not_verified_end_to_end'||data.dataQuality?.paymentTracking==='not_verified_end_to_end'?'регистрации и оплаты требуют проверки':'статус переданных событий'}</summary>
        <AnalyticsTrackingNotice report={data}/><p>Просмотры публикаций и CTR недоступны.</p>
        {data.diagnostics&&<dl className="admin-analytics__financial">
          <div><dt>Исключено подозрительных переходов</dt><dd>{number(data.diagnostics.flaggedClicks)}</dd></div>
          <div><dt>Финансовые события без внешнего номера</dt><dd>{number(data.diagnostics.legacyFinancialEventsWithoutExternalId)}</dd></div>
          <div><dt>Корректировки возвратов за период</dt><dd>{number(data.diagnostics.refundAdjustments.count)} · {money(data.diagnostics.refundAdjustments.amountMinor/100,reportCurrency)}</dd></div>
          <div><dt>Непогашенный долг за всё время</dt><dd>{money(data.diagnostics.outstandingDebtMinor/100,reportCurrency)}</dd></div>
        </dl>}
        <p>События — за выбранный период и источники. {data.diagnostics?.basis?.legacyEvents==='tenant_including_unattributed'?'Старые события без внешнего номера включают события без привязки к партнёру. ':''}Долг — за всё время в выбранной валюте.</p>
      </details>
      <p className="results-note">Клиенты считаются без повторов по всей выбранной области. Итоги не складываются из строк партнёров или отдельных дней. Комиссии на графике — по дате начисления с текущими корректировками.</p>
    </>}
    {explorer&&<ResultsExplorer endpoint="/admin/analytics" partnerId="admin" metric={explorer.metric} query={explorer.query} report={explorer.report} context="Выбранные партнёры и источники" onClose={closeExplorer}/>}
    {inspection&&<ResultsDrawer endpoint="/admin/analytics" partnerId="admin" row={{id:'__total__',name:'Подробная статистика',archived:false,counts:inspection.report.counts,amountsMinor:inspection.report.amountsMinor,conversions:inspection.report.conversions}} groupBy="total" query={inspection.query} period={inspection.period} timezone={inspection.report.timezone} onClose={closeInspection} inspection={{metric:inspection.selection.metric,context:inspection.selection.group?.name??'Выбранные партнёры и источники',compareBy:inspection.selection.by!=='total'&&!inspection.selection.group?inspection.selection.by:undefined,groups:inspection.report.series?.groups}}/>}
  </section></div>;
}

function PartnerPicker({value,onChange}:{value:string[];onChange:(value:string[])=>void}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[term,setTerm]=useState(''),[page,setPage]=useState(1);
  const root=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{const timer=window.setTimeout(()=>{setTerm(search.trim());setPage(1);},250);return()=>window.clearTimeout(timer);},[search]);
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)&&root.current)root.current.open=false;};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
  const query=new URLSearchParams({search:term,page:String(page),pageSize:'20'});
  const options=useQuery({queryKey:['admin-analytics-partner-picker',currentTenantSlug(),term,page],queryFn:()=>api<{items:PartnerOption[];pagination:Pagination}>(`/admin/analytics/partners?${query}`),enabled:open});
  return <details className="admin-analytics__picker" ref={root} onToggle={event=>setOpen(event.currentTarget.open)} onKeyDown={event=>{if(event.key==='Escape'&&root.current){root.current.open=false;root.current.querySelector('summary')?.focus();}}}>
    <summary>Партнёры<span>{value.length?`Выбрано: ${value.length}`:'Все партнёры'}</span></summary>
    {open&&<div className="admin-analytics__picker-menu"><label className="coach-field"><span>Поиск партнёров на сервере</span><input aria-label="Поиск партнёров на сервере" maxLength={200} value={search} onChange={event=>setSearch(event.target.value)} placeholder="Имя или email"/></label><button type="button" className="results-text-button" onClick={()=>onChange([])}>Все партнёры</button><ErrorBanner error={options.error}/>
      {options.isLoading?<p role="status">Ищем партнёров…</p>:<div className="admin-analytics__picker-options">{options.data?.items.map(partner=><label key={partner.id}><input type="checkbox" checked={value.includes(partner.id)} disabled={value.length>=50&&!value.includes(partner.id)} onChange={()=>onChange(value.includes(partner.id)?value.filter(id=>id!==partner.id):[...value,partner.id])}/><span>{partner.name}<small>{partner.email} · {statusLabel[partner.status]??'Статус не указан'}</small></span></label>)}{!options.error&&!options.data?.items.length&&<p>Партнёры не найдены.</p>}</div>}
      <div className="admin-analytics__picker-footer"><span>Выбрано {value.length} из 50</span><button type="button" className="results-button" aria-label="Предыдущие варианты партнёров" disabled={page<=1||options.isFetching} onClick={()=>setPage(page-1)}><ChevronLeft size={14}/></button><button type="button" className="results-button" aria-label="Следующие варианты партнёров" disabled={!options.data||page>=options.data.pagination.totalPages||options.isFetching} onClick={()=>setPage(page+1)}><ChevronRight size={14}/></button><button type="button" className="results-button" onClick={()=>{if(root.current)root.current.open=false;}}>Готово</button></div>
    </div>}
  </details>;
}
