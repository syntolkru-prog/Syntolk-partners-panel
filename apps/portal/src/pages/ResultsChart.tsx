import { createContext, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { money } from '../ui.js';

export interface SeriesPoint {
  date:string; since?:string; until?:string; clicks:number; identities?:number; registrations:number; payingCustomers?:number; payments:number;
  firstPayments?:number; repeatPayments?:number; customerPaymentsMinor?:number; earningsMinor:number;
}
export type ChartMetric = 'clicks'|'identities'|'registrations'|'payingCustomers'|'payments'|'customerPaymentsMinor'|'earningsMinor';
export type ChartSeriesBy = 'total'|'platform'|'format'|'scenario'|'partner';
export interface ChartInspection {metric:ChartMetric;by?:ChartSeriesBy;point?:SeriesPoint;group?:{by:Exclude<ChartSeriesBy,'total'>;id:string;name:string}}
export const chartMetricLabels:Record<ChartMetric,string> = {
  clicks:'Переходы', identities:'Связанные пользователи', registrations:'Регистрации', payingCustomers:'Платящие клиенты', payments:'Оплаты',
  customerPaymentsMinor:'Оплачено клиентами', earningsMinor:'Ваш заработок',
};
export const chartMetricKeys = Object.keys(chartMetricLabels) as ChartMetric[];
export const defaultChartMetrics:ChartMetric[] = chartMetricKeys.filter(key=>key!=='identities');
export const chartColors:Record<ChartMetric,string> = {clicks:'#28c6d8',identities:'#73cdb8',registrations:'#8e9dff',payingCustomers:'#c295f5',payments:'#eabb70',customerPaymentsMinor:'#65d7b0',earningsMinor:'#83bcff'};
export const chartModeLabels:Record<ChartSeriesBy,string> = {total:'Общая динамика',platform:'По площадкам',scenario:'По сценариям',format:'По форматам',partner:'По партнёрам'};
export const AnalyticsAudience = createContext(false);
export function useMetricLabels() { return useContext(AnalyticsAudience)?{...chartMetricLabels,earningsMinor:'Начислено партнёрам'}:chartMetricLabels; }
export function useChartModes(comparePartners=false) { return comparePartners?{total:chartModeLabels.total,partner:chartModeLabels.partner,platform:chartModeLabels.platform,format:chartModeLabels.format}:{total:chartModeLabels.total,platform:chartModeLabels.platform,scenario:chartModeLabels.scenario,format:chartModeLabels.format}; }
export const chartSeriesColor = (id:string) => `hsl(${[...id].reduce((hash,char)=>(hash*31+char.charCodeAt(0))%360,0)} 68% 68%)`;
const currencyMetric = (key:ChartMetric) => key.endsWith('Minor');
const dateLabel = (date:string,full=false) => new Date(`${date}T12:00:00Z`).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:full?'numeric':undefined,timeZone:'UTC'});
const formatValue = (value:number,monetary:boolean,currency='RUB') => monetary?money(value/100,currency):value.toLocaleString('ru-RU');
type Series = {bucket:string;points:SeriesPoint[];by?:Exclude<ChartSeriesBy,'total'>;groups?:Array<{id:string;name:string;points:SeriesPoint[]}>};
interface ChartProps {
  comparePartners?:boolean;
  currency?:string;
  series?:Series;
  metric:ChartMetric;
  onChange:(metric:ChartMetric)=>void;
  metrics?:ChartMetric[];
  onMetricsChange?:(metrics:ChartMetric[])=>void;
  seriesBy?:ChartSeriesBy;
  onSeriesByChange?:(by:ChartSeriesBy)=>void;
  totals?:Partial<Record<ChartMetric,number>>;
  changes?:Partial<Record<ChartMetric,ReactNode>>;
  paymentCounts?:{first:number;repeat:number};
  comparison?:ReactNode;
  comparisonTotals?:Partial<Record<ChartMetric,number>>;
  periodCaption?:string;
  toolbarControls?:ReactNode;
  onInspect?:(selection:ChartInspection)=>void;
  onExpand?:(metric:ChartMetric)=>void;
}

/** Reuse the real chart layout so the first request does not collapse the page. */
export function ResultsChartSkeleton({metrics=defaultChartMetrics,label='Загружаем статистику…'}:{metrics?:ChartMetric[];label?:string}) {
  return <div className="results-report" data-pending="true" aria-busy="true">
    <span className="results-report__pending" role="status">{label}</span>
    <div className="results-report__content" aria-hidden="true" {...{inert:''}}>
      <ResultsChart metric={metrics[0]??'clicks'} metrics={metrics} onChange={()=>{}} onSeriesByChange={()=>{}}/>
    </div>
  </div>;
}

export function ResultsChart({comparePartners=false,currency='RUB',series,metric,onChange,metrics,onMetricsChange,seriesBy='total',onSeriesByChange,totals,changes,paymentCounts,comparison,comparisonTotals,periodCaption,toolbarControls,onInspect,onExpand}:ChartProps) {
  const chartMetricLabels=useMetricLabels(),modes=useChartModes(comparePartners),admin=useContext(AnalyticsAudience);
  const selected = metrics?.length?metrics:[metric];
  const groups = seriesBy==='total'?[]:[...(series?.groups??[])].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  const inspect=(selection:ChartInspection)=>onInspect?.({...selection,by:seriesBy});
  const choose = (key:ChartMetric) => {
    const next=selected.includes(key)?selected.filter(item=>item!==key):[...selected,key];
    if(!next.length)return;
    if(onMetricsChange)onMetricsChange(next);else onChange(key);
  };
  const hints:Record<ChartMetric,string> = {
    clicks:admin?'Переходы по ссылкам выбранных партнёров':'Переходы по вашим партнёрским ссылкам',
    identities:'Разные пользователи, связанные с переходами',
    registrations:'Клиенты, зарегистрировавшиеся по ссылкам',
    payingCustomers:'Уникальные клиенты за выбранный период',
    payments:paymentCounts?`${paymentCounts.first} первых · ${paymentCounts.repeat} повторных`:'Первые и повторные оплаты',
    customerPaymentsMinor:'Сумма оплат привлечённых клиентов',
    earningsMinor:totals?.earningsMinor===0&&(totals?.customerPaymentsMinor??0)>0?'Чистая сумма комиссий за период — 0':'Начисленные комиссии с учётом возвратов',
  };
  return <section className="results-chart" aria-label="Динамика результатов">
    <div className="results-overview-toolbar">
      <div><h2>Динамика результатов</h2><p>{periodCaption??(series?.points.length?`${dateLabel(series.points[0]!.date,true)} — ${dateLabel(series.points.at(-1)!.date,true)}`:'За выбранный период')}</p></div>
      <div className="results-overview-actions">
        {toolbarControls}
        {onSeriesByChange&&<select aria-label="Режим графика" value={seriesBy} onChange={event=>onSeriesByChange(event.target.value as ChartSeriesBy)}>{Object.entries(modes).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>}
      </div>
    </div>
    {onMetricsChange&&<div className="results-metric-options" aria-label="Показатели графиков">
      <button type="button" className="results-metric-all" aria-pressed={defaultChartMetrics.every(key=>selected.includes(key))} onClick={()=>onMetricsChange(defaultChartMetrics)}>Все показатели</button>
      {defaultChartMetrics.map(key=><button type="button" key={key} aria-pressed={selected.includes(key)} onClick={()=>choose(key)} style={{'--metric-color':chartColors[key]} as CSSProperties}><span className="results-metric-check">{selected.includes(key)&&<Check size={11}/>}</span>{chartMetricLabels[key]}</button>)}
    </div>}
    <div className="results-series-legend" aria-label={seriesBy==='total'?'Интервал графиков':'Сравниваемые источники'}>{seriesBy==='total'?<span>{series?.bucket==='week'?'По неделям':series?.bucket==='month'?'По месяцам':'По дням'} · Все выбранные источники</span>:groups.length?groups.map(group=><button type="button" key={group.id} title={`Открыть статистику: ${group.name}`} onClick={()=>inspect({metric:selected[0]!,group:{by:seriesBy as Exclude<ChartSeriesBy,'total'>,id:group.id,name:group.name}})}><i style={{background:chartSeriesColor(group.id)}}/>{group.name}<ChevronRight size={12}/></button>):<span>За выбранный период действий по источникам нет</span>}</div>
    {comparison&&<div className="results-overview-comparison">{comparison}</div>}
    <div className="results-chart-grid" aria-label="Итоги за выбранный период">{selected.map(key=>{
      const lines=seriesBy==='total'?[{id:key,name:chartMetricLabels[key],color:chartColors[key],points:series?.points??[]}]:groups.map(group=>({...group,color:chartSeriesColor(group.id)}));
      const total=totals?.[key]??(series?.points??[]).reduce((sum,point)=>sum+(point[key]??0),0);
      const heading=<><div className="results-metric-card__heading"><span><i/>{chartMetricLabels[key]}</span>{changes?.[key]&&<small className="results-change">{changes[key]}</small>}{onInspect&&<ChevronRight size={14} aria-hidden="true"/>}</div>
        {comparisonTotals&&<small className="results-metric-card__period-label">Основной период</small>}
        <strong className="results-metric-card__value" title={formatValue(total,currencyMetric(key),currency)}>{formatValue(total,currencyMetric(key),currency)}</strong>
        {comparisonTotals&&<span className="results-metric-card__comparison">Период сравнения: <b>{formatValue(comparisonTotals[key]??0,currencyMetric(key),currency)}</b></span>}</>;
      const expand=()=>onExpand?onExpand(key):inspect({metric:key});
      return <article className="results-metric-card results-surface" key={key} style={{'--metric-color':chartColors[key]} as CSSProperties} aria-label={chartMetricLabels[key]} data-expandable={!!onExpand} onClick={onExpand?expand:undefined}>
        {onInspect||onExpand?<button type="button" className="results-metric-card__inspect" aria-label={`Подробнее: ${chartMetricLabels[key]}`} aria-haspopup="dialog" onClick={event=>{event.stopPropagation();expand();}}>{heading}</button>:heading}
        <p className="results-metric-card__hint">{hints[key]}</p>
        <MetricPlot currencyCode={currency} series={series} lines={lines} metric={key} onInspect={onInspect?(point,group)=>inspect({metric:key,point,...(group&&seriesBy!=='total'?{group:{by:seriesBy,id:group.id,name:group.name}}:{})}):undefined}/>
      </article>;
    })}</div>
  </section>;
}

export function MetricPlot({series,lines,metric,onInspect,large=false,range,currencyCode='RUB'}:{series?:Series;lines:Array<{id:string;name:string;color:string;points:SeriesPoint[]}>;metric:ChartMetric;onInspect?:(point:SeriesPoint,group?:{id:string;name:string})=>void;large?:boolean;range?:{min:number;max:number};currencyCode?:string}) {
  const chartMetricLabels=useMetricLabels();
  const id=useId().replace(/:/g,''),root=useRef<HTMLDivElement>(null),[width,setWidth]=useState(360),[active,setActive]=useState<number|null>(null);
  const [hoveredSeries,setHoveredSeries]=useState<string|null>(null);
  useEffect(()=>{
    const element=root.current;if(!element||typeof ResizeObserver==='undefined')return;
    const resize=new ResizeObserver(()=>setWidth(Math.max(180,element.getBoundingClientRect().width)));
    resize.observe(element);return()=>resize.disconnect();
  },[]);
  const timeline=series?.points.map(point=>point.date).join(',')??'';
  useEffect(()=>{setActive(null);setHoveredSeries(null);},[timeline,metric]);
  const points=series?.points??[],currency=currencyMetric(metric),height=large?350:142,left=large?60:42,right=large?18:10,top=large?20:10,bottom=height-30;
  const values=lines.flatMap(line=>line.points.map(point=>point[metric]??0));
  const min=Math.min(0,range?.min??0,...values),max=Math.max(currency?100:1,range?.max??0,...values);
  const raw=(max-min)/3,power=10**Math.floor(Math.log10(raw)),step=Math.max(1,([1,2,5,10].find(n=>n*power>=raw)??10)*power);
  const low=Math.floor(min/step)*step,high=Math.ceil(max/step)*step;
  const y=(value:number)=>bottom-(value-low)/(high-low)*(bottom-top);
  const x=(index:number)=>points.length>1?left+index/(points.length-1)*(width-left-right):(left+width-right)/2;
  const bars=lines.length===1&&!currency,barWidth=Math.max(2,Math.min(large?24:12,(width-left-right)/Math.max(1,points.length)*.65));
  const hitWidth=Math.max(barWidth,Math.min(14,(width-left-right)/Math.max(1,points.length)));
  const activePoint=active===null?undefined:points[active];
  const hoveredLine=lines.find(line=>line.id===hoveredSeries);
  const activeValue=hoveredLine?.points.find(point=>point.date===activePoint?.date)?.[metric]??activePoint?.[metric]??0;
  const unit=series?.bucket==='week'?'По неделям':series?.bucket==='month'?'По месяцам':'По дням';
  const indexAt=(clientX:number)=>Math.max(0,Math.min(points.length-1,Math.round((clientX-(root.current?.getBoundingClientRect().left??0)-left)/(width-left-right)*(points.length-1))));
  const hitAt=(target:EventTarget,clientX:number)=>{
    const hit=(target as Element).closest?.('[data-chart-hit]');if(!hit)return null;
    const index=hit.getAttribute('data-chart-hit'),groupId=hit.closest('[data-series]')?.getAttribute('data-series');
    return {index:index?Number(index):indexAt(clientX),group:lines.find(line=>line.id===groupId)};
  };
  return <div ref={root} className={`${large?'results-large-plot':'results-mini-plot'} results-chart__plot`} data-clickable={!!onInspect} role="group" aria-label={`${chartMetricLabels[metric]}, ${unit.toLowerCase()}. Стрелки — по датам.${onInspect?' Enter — подробности.':''}`} tabIndex={0}
    onPointerMove={event=>{if(!points.length)return;const hit=hitAt(event.target,event.clientX);setActive(hit?.index??null);setHoveredSeries(hit?.group?.id??null);}}
    onPointerLeave={()=>{setActive(null);setHoveredSeries(null);}} onFocus={event=>{if(event.target===event.currentTarget){setActive(points.length-1);setHoveredSeries(null);}}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setActive(null);}}
    onClick={event=>{if(!onInspect||!points.length)return;const hit=hitAt(event.target,event.clientX);if(hit&&points[hit.index]){event.stopPropagation();setActive(hit.index);onInspect(points[hit.index]!,hit.group);}}}
    onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(onInspect&&points.length&&['Enter',' '].includes(event.key)){event.preventDefault();onInspect(points[active??points.length-1]!);}
      if(points.length&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();setHoveredSeries(null);setActive(event.key==='Home'?0:event.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,(active??points.length-1)+(event.key==='ArrowRight'?1:-1))));}}}>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={lines[0]?.color} stopOpacity=".18"/><stop offset="100%" stopColor={lines[0]?.color} stopOpacity="0"/></linearGradient></defs>
      {Array.from({length:Math.round((high-low)/step)+1},(_,index)=>low+index*step).map(value=><g key={value}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} className={value===0?'results-chart__grid is-baseline':'results-chart__grid'}/><text x={left-8} y={y(value)+3} textAnchor="end">{(currency?value/100:value).toLocaleString('ru-RU',{notation:'compact',maximumFractionDigits:currency?1:0})}{currency?` ${new Intl.NumberFormat('ru-RU',{style:'currency',currency:currencyCode}).formatToParts(0).find(part=>part.type==='currency')?.value??currencyCode}`:''}</text></g>)}
      {lines.map(line=>{const byDate=new Map(line.points.map(point=>[point.date,point[metric]??0]));const lineValues=points.map(point=>byDate.get(point.date)??0),path=lineValues.map((value,index)=>`${index?'L':'M'}${x(index)},${y(value)}`).join(' ');
        return <g key={line.id} data-series={line.id}>{bars?lineValues.map((value,index)=><g key={index}><rect x={x(index)-barWidth/2} y={Math.min(y(0),y(value))} width={barWidth} height={Math.max(value?2:0,Math.abs(y(0)-y(value)))} rx="2" fill={line.color} opacity=".9"/>{value!==0&&<rect data-chart-hit={index} x={x(index)-hitWidth/2} y={Math.min(y(0),y(value))} width={hitWidth} height={Math.max(6,Math.abs(y(0)-y(value)))} fill="transparent"/>}</g>):<>{lines.length===1&&points.length>1&&<path d={`${path} L${x(points.length-1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${id})`}/>}<path className="results-chart__line" d={path} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/><path data-chart-hit="" d={path} fill="none" stroke="transparent" strokeWidth="14" pointerEvents="stroke" vectorEffect="non-scaling-stroke"/>{lineValues.map((value,index)=><circle key={index} data-chart-hit={index} cx={x(index)} cy={y(value)} r="7" fill="transparent"/>)}{points.length===1&&<circle cx={x(0)} cy={y(lineValues[0]??0)} r="3" fill={line.color} pointerEvents="none"/>}</>}</g>;
      })}
      {[...new Set(Array.from({length:large?5:3},(_,index)=>Math.round(index/((large?5:3)-1)*(points.length-1))))].filter(index=>points[index]).map(index=><text key={index} x={x(index)} y={height-7} textAnchor={index===0?'start':index===points.length-1?'end':'middle'}>{dateLabel(points[index]!.date)}</text>)}
    </svg>
    {!values.some(value=>value!==0)&&<span className="results-mini-plot__empty">{currency?(metric==='earningsMinor'?'Начислений нет':'Оплат нет'):points.length?'Нет действий':'Нет данных'}</span>}
    {activePoint&&<div className="results-chart__tooltip" role="status" aria-label={`Значение графика: ${chartMetricLabels[metric]}`}><span>{dateLabel(activePoint.date,true)}{series?.bucket==='week'?' · неделя':series?.bucket==='month'?' · месяц':''}</span><div><i style={{background:hoveredLine?.color??lines[0]?.color}}/><span>{hoveredLine?.name??chartMetricLabels[metric]}</span><strong>{formatValue(activeValue,currency,currencyCode)}</strong></div></div>}
  </div>;
}
