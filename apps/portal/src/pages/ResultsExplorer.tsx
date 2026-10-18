import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import { api, currentTenantSlug } from '../api.js';
import { ErrorBanner, money } from '../ui.js';
import type { AnalyticsReport, MetricRow } from './PartnerAnalytics.js';
import { MetricPlot, chartColors, chartMetricKeys, chartMetricLabels, chartModeLabels, chartSeriesColor, type ChartInspection, type ChartMetric, type ChartSeriesBy } from './ResultsChart.js';
import { ResultsDrawer } from './ResultsDetails.js';
import { ResultsDatePicker, calendarDay, rangeCaption, type DateChoice } from './ResultsDatePicker.js';
import { inspectionScope, metricValue } from './results-scope.js';
import './results-explorer.css';

const groupLabels:Record<string,string>={platform:'Площадки',scenario:'Сценарии',format:'Форматы'};
const rangeOf=(report:AnalyticsReport):DateChoice=>report.period?{from:calendarDay(report.period.since,report.timezone),to:calendarDay(new Date(Date.parse(report.period.until)-1).toISOString(),report.timezone)}:{from:calendarDay(new Date().toISOString()),to:calendarDay(new Date().toISOString())};
const valueLabel=(value:number,metric:ChartMetric,currency='RUB')=>metric.endsWith('Minor')?money(value/100,currency):value.toLocaleString('ru-RU');
const linesOf=(report:AnalyticsReport|undefined,metric:ChartMetric,by:ChartSeriesBy)=>by==='total'?[{id:metric,name:chartMetricLabels[metric],color:chartColors[metric],points:report?.series?.points??[]}]:[...(report?.series?.groups??[])].sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(group=>({...group,color:chartSeriesColor(group.id)}));

export function ResultsExplorer({partnerId,metric:initialMetric,query,report:initialReport,context,onClose,endpoint}:{partnerId:string;metric:ChartMetric;query:string;report:AnalyticsReport;context:string;onClose:()=>void;endpoint?:string}) {
  const analyticsEndpoint=endpoint??`/partners/${partnerId}/analytics`;
  const currency=initialReport.currency??new URLSearchParams(query).get('currency')??'RUB';
  const formatValue=(value:number,metric:ChartMetric)=>valueLabel(value,metric,currency);
  const [base]=useState(()=>{const params=new URLSearchParams(query);if(initialReport.period){params.set('since',initialReport.period.since);params.set('until',initialReport.period.until);}return params.toString();});
  const initialBy=(new URLSearchParams(base).get('seriesBy')??'total') as ChartSeriesBy;
  const initialComparison=new URLSearchParams(base).get('includeComparison')==='true'?'previous':'off';
  const [metric,setMetric]=useState(initialMetric),[by,setBy]=useState<ChartSeriesBy>(initialBy),[choice,setChoice]=useState<DateChoice|null>(null);
  const [comparison,setComparison]=useState<'off'|'previous'|'custom'>(initialComparison),[comparisonChoice,setComparisonChoice]=useState<DateChoice|null>(null);
  const [detail,setDetail]=useState<{selection:ChartInspection;query:string;period?:AnalyticsReport['period'];report:AnalyticsReport;context:string}|null>(null);
  const [closing,setClosing]=useState(false);
  const closeExplorer=useCallback(()=>setClosing(true),[]);
  const root=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null),lastFocus=useRef<HTMLElement|null>(null),titleId=useId();
  const closeDetail=useCallback(()=>{setDetail(null);if(lastFocus.current?.isConnected)lastFocus.current.focus({preventScroll:true});},[]);
  useEffect(()=>{if(!closing)return;const delay=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:180,timer=window.setTimeout(onClose,delay);return()=>window.clearTimeout(timer);},[closing,onClose]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow,app=document.getElementById('root'),wasInert=app?.hasAttribute('inert');
    app?.setAttribute('inert','');document.body.style.overflow='hidden';close.current?.focus({preventScroll:true});
    return()=>{document.body.style.overflow=overflow;if(!wasInert)app?.removeAttribute('inert');if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  useEffect(()=>{
    const keyboard=(event:KeyboardEvent)=>{
      if(event.defaultPrevented)return;
      if(event.key==='Escape'){event.preventDefault();if(detail)closeDetail();else closeExplorer();return;}
      if(event.key!=='Tab')return;
      const targets=[...(root.current?.querySelectorAll<HTMLElement>('button,input,select,summary,a[href],[tabindex="0"]')??[])].filter(element=>element.tabIndex>=0&&!element.hasAttribute('disabled')&&!element.closest('[hidden],[inert]')&&(!element.closest('details:not([open])')||element.tagName==='SUMMARY'));
      const first=targets[0],last=targets.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keyboard);return()=>document.removeEventListener('keydown',keyboard);
  },[detail,closeExplorer,closeDetail]);
  const currentQuery=new URLSearchParams(base);
  currentQuery.set('includeSeries','true');currentQuery.delete('includeComparison');currentQuery.delete('seriesBy');
  if(by!=='total')currentQuery.set('seriesBy',by);
  if(choice){for(const field of ['since','until','from','to'])currentQuery.delete(field);currentQuery.set('period',choice.preset??'custom');if(!choice.preset){currentQuery.set('from',choice.from);currentQuery.set('to',choice.to);}}
  if(comparison==='previous'){currentQuery.set('includeComparison','true');if(currentQuery.get('period')==='all')currentQuery.set('period','custom');}
  const untouched=!choice&&by===initialBy&&comparison===initialComparison;
  const primary=useQuery({queryKey:['partner-analytics',currentTenantSlug(),endpoint??partnerId,currentQuery.toString()],queryFn:()=>api<AnalyticsReport>(`${analyticsEndpoint}?${currentQuery}`),initialData:untouched?initialReport:undefined,staleTime:Infinity,placeholderData:previous=>previous});
  const data=primary.data;
  const previousPeriod=data?.comparison?.period;
  const secondaryQuery=new URLSearchParams(currentQuery);secondaryQuery.delete('includeComparison');
  for(const field of ['since','until','from','to'])secondaryQuery.delete(field);
  secondaryQuery.set('period','custom');
  if(comparison==='previous'&&previousPeriod){secondaryQuery.set('since',previousPeriod.since);secondaryQuery.set('until',previousPeriod.until);}
  else if(comparisonChoice){secondaryQuery.set('from',comparisonChoice.from);secondaryQuery.set('to',comparisonChoice.to);}
  const secondary=useQuery({queryKey:['partner-analytics',currentTenantSlug(),endpoint??partnerId,secondaryQuery.toString()],queryFn:()=>api<AnalyticsReport>(`${analyticsEndpoint}?${secondaryQuery}`),enabled:comparison!=='off'&&!primary.isPlaceholderData&&!!(comparison==='previous'?previousPeriod:comparisonChoice),staleTime:Infinity,placeholderData:previous=>previous});
  const reportError=primary.error??(comparison!=='off'?secondary.error:null);
  const busy=!reportError&&(primary.isLoading||primary.isPlaceholderData||comparison!=='off'&&(!secondary.data||secondary.isPlaceholderData));
  const primaryRange=choice??rangeOf(data??initialReport),secondaryRange=comparisonChoice&&comparison==='custom'?comparisonChoice:previousPeriod?{from:calendarDay(previousPeriod.since,data?.timezone),to:calendarDay(new Date(Date.parse(previousPeriod.until)-1).toISOString(),data?.timezone)}:primaryRange;
  const panels=[{id:'current',name:'Основной период',report:data,query:currentQuery.toString()},...(comparison!=='off'?[{id:'previous',name:'Период сравнения',report:secondary.data,query:secondaryQuery.toString()}]:[])];
  const values=panels.flatMap(panel=>linesOf(panel.report,metric,by).flatMap(line=>line.points.map(point=>point[metric]??0)));
  const scale={min:Math.min(0,...values),max:Math.max(metric.endsWith('Minor')?100:1,...values)};
  const inspect=(selection:ChartInspection,report:AnalyticsReport,query:string)=>{
    lastFocus.current=document.activeElement as HTMLElement|null;
    const scoped=inspectionScope(query,selection,report);
    const scopeParams=new URLSearchParams(scoped.query);
    const labels=[['scenario','Сценарии','Без сценария'],['platform','Площадки','Площадка не указана'],['format','Форматы','Формат не указан']].map(([dimension,label,unknown])=>{const ids=[...new Set([...scopeParams.getAll(`${dimension}Ids`),...scopeParams.getAll(`${dimension}Id`)])];return ids.length>1?`${label}: ${ids.length}`:ids.length?(report.options[`${dimension}s` as keyof AnalyticsReport['options']].find(option=>option.id===ids[0])?.name??(ids[0]==='__none__'?unknown:selection.group?.name??'Выбран источник')):'';}).filter(Boolean);
    setDetail({selection,report,...scoped,context:labels.join(' · ')});
  };
  const changePeriod=(range:DateChoice)=>{setDetail(null);setChoice(range);};
  const modeChange=(value:ChartSeriesBy)=>{setDetail(null);setBy(value);};
  const value=data?metricValue(data,metric):0,previousValue=secondary.data?metricValue(secondary.data,metric):0;
  const change=previousValue?(value-previousValue)/Math.abs(previousValue)*100:null;
  const detailRow:MetricRow|undefined=detail?{id:'__total__',name:'Подробная статистика',archived:false,counts:detail.report.counts,amountsMinor:detail.report.amountsMinor,conversions:detail.report.conversions}:undefined;
  const detailCompare=detail?.selection.by&&detail.selection.by!=='total'&&!detail.selection.group?detail.selection.by:undefined;
  return createPortal(<div className={`results-explorer-backdrop${closing?' is-closing':''}`} onClick={event=>{if(event.target===event.currentTarget)closeExplorer();}}>
    <section ref={root} className="results-page results-explorer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="results-explorer__header"><div><span>Подробная аналитика</span><h2 id={titleId}>{chartMetricLabels[metric]}</h2>{context&&<p>{context}</p>}</div><button ref={close} type="button" className="results-icon-button" aria-label="Закрыть график" onClick={closeExplorer}><X size={19}/></button></header>
      <div className="results-explorer__controls">
        <ResultsDatePicker label="Период большого графика" value={primaryRange} timezone={data?.timezone??initialReport.timezone} onChange={changePeriod}/>
        <ResultsDatePicker label="Период сравнения" value={secondaryRange} timezone={data?.timezone??initialReport.timezone} comparison active={comparison!=='off'} caption={comparison==='previous'?'Сравнение: предыдущий период':undefined} onChange={range=>{setDetail(null);setComparisonChoice(range);setComparison('custom');}} onPrevious={()=>{setDetail(null);setComparison('previous');}} onClear={()=>{setDetail(null);setComparison('off');}}/>
        <select aria-label="Разбивка большого графика" value={by} onChange={event=>modeChange(event.target.value as ChartSeriesBy)}>{Object.entries(chartModeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
        <select aria-label="Показатель большого графика" value={metric} onChange={event=>{setDetail(null);setMetric(event.target.value as ChartMetric);}}>{chartMetricKeys.map(key=><option key={key} value={key}>{chartMetricLabels[key]}</option>)}</select>
      </div>
      <ErrorBanner error={reportError}/>
      {comparison!=='off'&&!busy&&!reportError&&secondary.data&&data&&<div className="results-explorer__change">{change===null?(value===0?'В обоих периодах — 0':'В периоде сравнения — 0'):`${change>0?'+':''}${change.toLocaleString('ru-RU',{maximumFractionDigits:1})}% к периоду сравнения`}<span>{formatValue(value,metric)} · ранее {formatValue(previousValue,metric)}</span></div>}
      <div className="results-explorer__body" aria-busy={busy}>
        {busy&&<div className="results-explorer__loading" role="status">Обновляем график…</div>}
        <div className="results-explorer__plots" data-comparing={comparison!=='off'} aria-hidden={busy||!!reportError||undefined} {...{inert:busy||reportError?'':undefined}}>
          {panels.map(panel=><section className="results-explorer__plot-panel" key={panel.id} aria-label={panel.name}>
            <div className="results-explorer__plot-heading"><div><span>{comparison!=='off'?panel.name:chartMetricLabels[metric]}</span><p>{panel.report?rangeCaption(rangeOf(panel.report)):''}</p></div><button type="button" aria-label={`Подробнее за период: ${chartMetricLabels[metric]}${panel.id==='previous'?' — сравнение':''}`} onClick={()=>{if(panel.report)inspect({metric,by},panel.report,panel.query);}}><strong>{panel.report?formatValue(metricValue(panel.report,metric),metric):'—'}</strong><ChevronRight size={16}/></button></div>
            <MetricPlot large currencyCode={currency} series={panel.report?.series} lines={linesOf(panel.report,metric,by)} metric={metric} range={scale} onInspect={(point,group)=>{if(panel.report)inspect({metric,by,point,...(group&&by!=='total'?{group:{by,id:group.id,name:group.name}}:{})},panel.report,panel.query);}}/>
            {by!=='total'&&<section className="results-explorer__legend"><h3>{groupLabels[by]}</h3><div>{linesOf(panel.report,metric,by).map(line=><button type="button" key={line.id} aria-label={line.name} onClick={()=>{if(panel.report)inspect({metric,by,group:{by,id:line.id,name:line.name}},panel.report,panel.query);}}><i style={{background:line.color}}/>{line.name}<ChevronRight size={12}/></button>)}</div></section>}
            {metric==='earningsMinor'&&panel.report?.amountsMinor.netAccrued===0&&panel.report.amountsMinor.observedPayments>0&&<p className="results-note">Оплаты клиентов учтены. Сумма ваших комиссий с учётом возвратов — {money(0,currency)}.</p>}
          </section>)}
        </div>
        {detail&&detailRow&&<div className="results-explorer__detail"><ResultsDrawer endpoint={endpoint} embedded key={`${detail.query}:${detail.selection.metric}`} partnerId={partnerId} row={detailRow} groupBy="total" query={detail.query} period={detail.period} timezone={detail.report.timezone} onClose={closeDetail} inspection={{metric:detail.selection.metric,context:detail.context,compareBy:detailCompare,groups:detailCompare?detail.report.series?.groups?.map(group=>({id:group.id,name:group.name})):undefined}}/></div>}
      </div>
      <footer className="results-explorer__footer">Наведите на график, чтобы увидеть значение. Нажмите на столбец или точку — откроются подробности.</footer>
    </section>
  </div>,document.body);
}
