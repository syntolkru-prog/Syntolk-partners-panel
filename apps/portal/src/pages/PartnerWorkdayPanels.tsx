import {useState} from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronRight, Users, Wallet, type LucideIcon } from 'lucide-react';
import { Card } from '../components/tremor/raw/components/Card/Card.js';
import { BarChart } from '../components/tremor/raw/components/BarChart/BarChart.js';
import { AreaChart, ChartTooltip, type TooltipProps } from '../components/tremor/raw/components/AreaChart/AreaChart.js';
import { DonutChart } from '../components/tremor/raw/components/DonutChart/DonutChart.js';
import { Tooltip } from '../components/tremor/raw/components/Tooltip/Tooltip.js';
import { VisualTable, VisualTableHead, VisualTableHeader, VisualTableBody, VisualTableRow, VisualTableCell } from '../components/tremor/VisualTable.js';
import { money } from '../ui.js';
import type { AnalyticsReport } from './PartnerAnalytics.js';
import { homeDelta, homeTraffic, homeTrafficRows,type HomeDetails,type HomeRegistration } from './partner-workday-data.js';

const number=(value:number)=>value.toLocaleString('ru-RU',{maximumFractionDigits:1});
export function HomeDelta({value,previous}:{value:number|undefined;previous:number|undefined}) {
  const delta=homeDelta(value,previous);
  return <span className={`wd-delta${delta!==null&&delta<0?' is-negative':''}`} aria-label="Изменение к предыдущему периоду">{delta===null?'—':delta===0?'0%':<>{delta<0?'↘':'↗'} {delta>0?'+':''}{number(delta)}%</>}</span>;
}
export function WorkdayKpi({title,value,current,previous,points,icon:Icon,color,compareLabel,href,hint,onOpen}:{title:string;value:string;current?:number;previous?:number;points:Array<{date:string;value:number}>;icon:LucideIcon;color:'blue'|'violet';compareLabel:string;href:string;hint?:string;onOpen?:()=>void}) {
  const content=<><div className="wd-kpi-title"><span className={`wd-icon wd-icon--${color}`}><Icon size={18}/></span><span>{title}</span></div><div className="wd-kpi-value"><strong>{value}</strong>{compareLabel&&<HomeDelta value={current} previous={previous}/>}</div><p className="wd-kpi-comparison" aria-hidden={!compareLabel}>{compareLabel||'\u00a0'}</p></>;
  return <Card asChild className="wd-card wd-kpi p-0"><article aria-label={title}>{onOpen?<button type="button" className="wd-kpi-link" aria-label={`Подробнее: ${title}`} onClick={onOpen}>{content}</button>:<Link className="wd-kpi-link" to={href} aria-label={`Подробнее: ${title}`}>{content}</Link>}
    {hint&&<Tooltip content={hint} asChild><button className="wd-info" type="button" aria-label={hint}>i</button></Tooltip>}
    {!!points.length&&<div className="wd-spark" aria-label={`Динамика: ${title}`}><BarChart data={points} index="date" categories={['value']} colors={[color]} showXAxis={false} showYAxis={false} showGridLines={false} showLegend={false} showTooltip={false} allowDecimals={false} className="wd-spark-chart"/></div>}
  </article></Card>;
}
export function WorkdayRevenue({report,previous,loading,error,currency,tabs,href}:{report?:AnalyticsReport;previous?:AnalyticsReport;loading:boolean;error:unknown;currency:string;tabs?:ReactNode;href:string}) {
  const points=report?.series?.points??[],formatter=(value:number)=>money(value/100,currency);
  const axisFormatter=(value:number)=>`${new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}).format(value/100)} ${currency==='RUB'?'₽':currency}`;
  const RevenueTooltip=(props:TooltipProps)=><ChartTooltip {...props} valueFormatter={formatter}/>;
  const chartData=points.map(point=>({date:new Date(`${point.date}T12:00:00Z`).toLocaleDateString('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'}),Выручка:point.customerPaymentsMinor??0}));
  return <Card asChild className="wd-card wd-revenue p-0"><section aria-label="Выручка за период" aria-busy={loading}><div className="wd-card-heading"><h2><span className="wd-icon"><Wallet size={18}/></span><Link to={href}>Выручка</Link></h2>{tabs}</div><div className="wd-revenue-value"><strong>{report?formatter(report.amountsMinor.observedPayments):'—'}</strong>{previous&&report&&<HomeDelta value={report.amountsMinor.observedPayments} previous={previous.amountsMinor.observedPayments}/>}</div><div className="wd-revenue-chart" aria-label="Динамика выручки">{loading||error||!points.length?<p role="status" className="wd-empty">{loading?'Загрузка динамики…':error?'Не удалось загрузить динамику':'За этот период событий нет'}</p>:<AreaChart data={chartData} index="date" categories={['Выручка']} colors={['blue']} valueFormatter={axisFormatter} customTooltip={RevenueTooltip} showLegend={false} yAxisWidth={64} minValue={0} className="wd-area" startEndOnly={points.length>12} fill="gradient"/>}</div></section></Card>;
}
const trafficColors=['blue','violet','fuchsia','gray'] as const;
export function WorkdayTraffic({details,sourcesReport,resultsHref='',loading,error}:{details?:HomeDetails;sourcesReport?:AnalyticsReport;resultsHref?:string;loading:boolean;error:unknown}) {
  const [view,setView]=useState<'publications'|'sites'>('publications');
  const publications=sourcesReport?.rows?.filter(row=>row.counts.clicks>0).map(row=>({id:row.id,name:row.placement?.materialTitle||row.placement?.channelName||row.name,count:row.counts.clicks,platform:row.placement?.platformName,url:row.placement?.publicationUrl,href:resultsHref?`${resultsHref}&groupBy=source&sourceId=${encodeURIComponent(row.id)}`:undefined})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  const sources=view==='publications'&&publications?publications:homeTrafficRows(details?.traffic?.referrers??[]).map(row=>({...row,id:row.name,platform:undefined,url:undefined,href:undefined}));
  const rows=homeTraffic(sources),total=sources.reduce((sum,row)=>sum+row.count,0);
  return <Card asChild className="wd-card wd-traffic p-0"><section aria-label="Источники трафика" aria-busy={loading}><div className="wd-card-heading"><h2><span className="wd-icon"><Users size={18}/></span>Источники трафика</h2></div>
    {sourcesReport&&<div className="wd-traffic-tabs" aria-label="Разбивка источников"><button aria-pressed={view==='publications'} onClick={()=>setView('publications')}>Публикации и ссылки</button><button aria-pressed={view==='sites'} onClick={()=>setView('sites')}>Сайты</button></div>}
    {loading||error||!total?<p className="wd-empty" role="status">{loading?'Загрузка источников…':error?'Не удалось загрузить источники':'За этот период переходов нет'}</p>:<><div className="wd-donut-wrap"><DonutChart data={rows} category="name" value="count" colors={[...trafficColors]} valueFormatter={number} className="wd-donut"/><div className="wd-donut-label" aria-label={`${total} переходов`}><strong>{number(total)}</strong><span>переходов</span></div></div><div className="wd-traffic-scroll" role="region" aria-label="Список источников переходов" tabIndex={0}><ul className="wd-traffic-legend">{sources.map((row,index)=><li key={row.id}><i style={{background:`var(--color-${trafficColors[sources.length>4&&index>=3?3:index]}-500)`}}/><span title={row.name}>{row.href?<Link to={row.href}>{row.name}</Link>:row.name}{row.platform&&<small>{row.platform}{row.url&&<> · <a href={row.url} target="_blank" rel="noopener noreferrer" aria-label={`Открыть публикацию: ${row.name}`}>↗</a></>}</small>}</span><span>{number(row.count/total*100)}%</span><strong>{number(row.count)}</strong></li>)}</ul></div></>}
  </section></Card>;
}

export function WorkdayRegistrations({details,loading,error,timezone,onOpen}:{details?:HomeDetails;loading:boolean;error:unknown;timezone:string;onOpen:()=>void}) {
  const rows=details?.registrations??[];
  return <Card asChild className="wd-card wd-registrations p-0"><section aria-label="Последние регистрации" aria-busy={loading}><div className="wd-card-heading"><h2><span className="wd-icon"><Users size={18}/></span>Последние регистрации</h2><span className="wd-registration-caption">Регистрации по вашим ссылкам за выбранный период</span><button type="button" className="wd-link-button" onClick={onOpen}>Все регистрации{details?.registrationsTotal!==undefined?` · ${details.registrationsTotal}`:''} <ChevronRight size={13}/></button></div><WorkdayRegistrationTable rows={rows} loading={loading} error={error} timezone={timezone}/></section></Card>;
}

export function WorkdayRegistrationTable({rows,loading,error,timezone}:{rows:HomeRegistration[];loading:boolean;error:unknown;timezone:string}){
  return <div className="wd-table-scroll"><VisualTable><VisualTableHead><VisualTableRow>{['ID пользователя','Дата регистрации','Источник перехода','Оплата за период','Сумма оплат'].map(label=><VisualTableHeader key={label}>{label}</VisualTableHeader>)}</VisualTableRow></VisualTableHead><VisualTableBody>{loading||error||!rows.length?<VisualTableRow><VisualTableCell colSpan={5}><span role="status">{loading?'Загрузка регистраций…':error?'Не удалось загрузить регистрации':'За этот период регистраций нет'}</span></VisualTableCell></VisualTableRow>:rows.map(row=><VisualTableRow key={row.id}><VisualTableCell><span className="wd-user"><span className="wd-avatar" aria-hidden="true">{row.userId.slice(0,2).toLocaleUpperCase('ru-RU')}</span><span title={row.userId}>{row.userId}</span></span></VisualTableCell><VisualTableCell>{new Date(row.registeredAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:timezone})}</VisualTableCell><VisualTableCell><span className="wd-source" title={row.source}>{row.source}</span></VisualTableCell><VisualTableCell><span className={`wd-customer-status${row.paidMinor!==null?' is-paid':''}`}><i/>{row.paidMinor!==null?'Есть оплата':'Без оплат'}</span></VisualTableCell><VisualTableCell title="Оплаты, отнесённые к вашим ссылкам за выбранный период. Не комиссия партнёра.">{row.paidMinor===null?'—':money(row.paidMinor/100,row.currency)}</VisualTableCell></VisualTableRow>)}</VisualTableBody></VisualTable></div>;
}
