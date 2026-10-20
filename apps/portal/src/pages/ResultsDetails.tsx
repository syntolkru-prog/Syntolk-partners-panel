import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, ChevronRight, X } from 'lucide-react';
import { api, currentTenantSlug } from '../api.js';
import { ErrorBanner, money as formatMoney } from '../ui.js';
import { trackingShareUrl } from '../lib/share-links.js';
import type { AnalyticsReport, MetricRow } from './PartnerAnalytics.js';
import { defaultChartMetrics, useMetricLabels, AnalyticsAudience, chartSeriesColor, type ChartMetric, type ChartSeriesBy } from './ResultsChart.js';
import { metricValue } from './results-scope.js';

export const dateLabel = (value?: string | null, timezone='Europe/Moscow') => value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone:timezone }) : 'Дата не сохранена';
const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;

export function PaymentDetails({ row,currency='RUB' }: { row: Pick<MetricRow, 'counts' | 'amountsMinor' | 'conversions'>;currency?:string }) {
  const money=(amount:number)=>formatMoney(amount,currency);
  return <div className="results-detail-metrics">{[
    ['Первые оплаты', row.counts.firstPaymentCount], ['Повторные оплаты', row.counts.repeatPaymentCount], ['Оплачено клиентами', money(row.amountsMinor.observedPayments / 100)], ['Возвраты', money(row.amountsMinor.refunds / 100)],
    ['Переход → регистрация · когорта', percent(row.conversions?.clickToRegistration ?? null)], ['Регистрация → оплата · когорта', percent(row.conversions?.registrationToPayment ?? null)], ['Переход → оплата · когорта', percent(row.conversions?.clickToPayment ?? null)],
  ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

function PlacementInfo({ row, timezone }: { row: MetricRow; timezone:string }) {
  const source = row.placement!;
  const publication = source.publicationUrl && /^https?:\/\//i.test(source.publicationUrl) ? source.publicationUrl : null;
  return <dl className="results-placement-info"><div><dt>Материал</dt><dd>{source.materialTitle || 'Название не указано'}</dd></div><div><dt>Формат</dt><dd>{source.formatName}</dd></div><div><dt>Площадка / канал</dt><dd>{source.platformName}{source.channelName ? ` · ${source.channelName}` : ''}</dd></div><div><dt>Ссылка создана</dt><dd>{dateLabel(row.createdAt,timezone)}</dd></div><div><dt>Дата публикации</dt><dd>{source.publishedAt ? dateLabel(source.publishedAt,timezone) : 'Не указана'}</dd></div><div><dt>Публикация</dt><dd>{publication ? <a href={publication} target="_blank" rel="noreferrer">{publication}<ArrowUpRight size={13} aria-hidden="true"/></a> : 'Адрес не указан'}</dd></div>{source.linkKey && <div className="results-placement-info__url"><dt>Партнёрская ссылка</dt><dd><code>{trackingShareUrl(source.linkKey, source.trackingParams)}</code></dd></div>}</dl>;
}

interface DetailsReport {
  traffic: { referrers: Array<{ name: string; count: number }>; devices: Array<{ name: string; count: number }> };
  history: { items: Array<{ id: string; kind: string; ts: string; amountMinor: number | null; currency?:string|null;partnerNames?:string[];linkKeys?:string[] }>; nextCursor: string | null };
}
const scopeField: Record<string, string> = { partner:'partnerId', link: 'linkId', material: 'materialId', source: 'sourceId', platform: 'platformId', scenario: 'scenarioId', format: 'formatId' };
const groupNames:Record<string,string>={partner:'Партнёры',platform:'Площадки',scenario:'Сценарии',format:'Форматы',material:'Материалы',source:'Размещения'};
const comparisonNames:Record<string,string>={partner:'Сравнение партнёров',platform:'Сравнение площадок',scenario:'Сравнение сценариев',format:'Сравнение форматов'};
const emptyGroup=(group:{id:string;name:string;archived?:boolean}):MetricRow=>({...group,archived:!!group.archived,counts:{clicks:0,registrations:0,payingCustomers:0,paymentCount:0,firstPaymentCount:0,repeatPaymentCount:0},amountsMinor:{observedPayments:0,refunds:0,netPayments:0,netAccrued:0}});
const metricLabel = (row:Pick<MetricRow,'counts'|'amountsMinor'>, metric:ChartMetric,currency='RUB') => metric.endsWith('Minor')?formatMoney(metricValue(row,metric)/100,currency):metricValue(row,metric).toLocaleString('ru-RU');

export function ResultsDrawer({ partnerId, row: currentRow, groupBy:initialGroup, query, period, timezone='Europe/Moscow', onClose, onScope, inspection,embedded=false,endpoint }: {
  partnerId: string; row: MetricRow; groupBy: string; query: string; period?: { since: string; until: string }; timezone?:string; onClose: () => void; onScope?: (id: string) => void;
  inspection?:{metric:ChartMetric;context:string;compareBy?:Exclude<ChartSeriesBy,'total'>;groups?:Array<{id:string;name:string;archived?:boolean}>};
  embedded?:boolean;
  endpoint?:string;
}) {
  const chartMetricLabels=useMetricLabels(),admin=useContext(AnalyticsAudience);
  const analyticsEndpoint=endpoint??`/partners/${partnerId}/analytics`;
  const currency=new URLSearchParams(query).get('currency')??'RUB';
  const money=(amount:number)=>formatMoney(amount,currency);
  const labelMetric=(row:Pick<MetricRow,'counts'|'amountsMinor'>,metric:ChartMetric)=>metricLabel(row,metric,currency);
  const [path,setPath]=useState([{row:currentRow,groupBy:initialGroup}]);
  const {row,groupBy}=path.at(-1)!;
  const [selectedMetric,setSelectedMetric]=useState<ChartMetric|null>(inspection?.metric??null);
  const [tab, setTab] = useState('overview');
  const [baseQuery]=useState(query);
  const comparisonMode=groupBy==='total'?inspection?.compareBy:undefined;
  const scoped = useMemo(() => {
    const params = new URLSearchParams(baseQuery);
    for (const field of ['includeSeries', 'seriesBy','view','includeComparison','compareFrom','compareTo']) params.delete(field);
    if(inspection)params.delete('includeEmpty');
    // Apply every level so a placement remains inside the material and source filters it came from.
    for(const entry of path){const field=scopeField[entry.groupBy];if(field){params.delete(field);params.delete(`${field}s`);params.set(field,entry.row.id);}}
    params.set('groupBy',comparisonMode??(admin&&groupBy==='total'&&!params.has('partnerId')?'partner':((groupBy==='total'||inspection&&['platform','scenario','format'].includes(groupBy))&&!params.has('materialId')?'material':'source')));
    if(admin)params.set('activity','results');
    if(comparisonMode)params.set('includeEmpty','true');
    if (period) { params.set('since', period.since); params.set('until', period.until); }
    return params.toString();
  },[baseQuery,path,period,inspection,comparisonMode,admin]);
  const titleId = useId(), root = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null),body=useRef<HTMLDivElement>(null),back=useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if(embedded){close.current?.focus({preventScroll:true});return;}
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    const app = document.getElementById('root'), wasInert = app?.hasAttribute('inert');
    app?.setAttribute('inert', ''); document.body.style.overflow = 'hidden'; close.current?.focus({preventScroll:true});
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const targets = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select,summary,[tabindex="0"]') ?? [])]
        .filter(element => !element.closest('[hidden]') && (!element.closest('details:not([open])') || element.tagName === 'SUMMARY'));
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); document.body.style.overflow = overflow; if (!wasInert) app?.removeAttribute('inert'); if (previous?.isConnected) previous.focus({preventScroll:true}); };
  }, [onClose,embedded]);
  const placements = useQuery({ queryKey: ['partner-analytics', currentTenantSlug(), endpoint??partnerId, scoped], queryFn: () => api<AnalyticsReport>(`${analyticsEndpoint}?${scoped}`), enabled: tab === 'overview' && groupBy !== 'source' });
  const detail = useInfiniteQuery({ queryKey: ['partner-analytics-details', currentTenantSlug(), endpoint??partnerId, scoped], initialPageParam: '',
    queryFn: ({ pageParam }) => api<DetailsReport>(`${analyticsEndpoint}/details?${scoped}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: last => last.history.nextCursor ?? undefined, enabled: tab !== 'overview' });
  const history = detail.data?.pages.flatMap(page => page.history.items) ?? [];
  const traffic = detail.data?.pages[0]?.traffic;
  const actions: Record<string, string> = { click: 'Переход', signup: 'Регистрация', first_payment: 'Первая оплата', repeat_payment: 'Повторная оплата', refund: 'Возврат' };
  const summary=groupBy==='total'?placements.data:row;
  const breakdownGroup=new URLSearchParams(scoped).get('groupBy')!;
  const comparisonRows=comparisonMode&&inspection?.groups?inspection.groups.map(group=>{const existing=placements.data?.rows.find(item=>item.id===group.id);return existing?{...existing,name:group.name}:emptyGroup(group);}):placements.data?.rows??[];
  const breakdownRows=comparisonRows.filter(item=>comparisonMode||!selectedMetric||metricValue(item,selectedMetric)!==0)
    .sort((a,b)=>Math.abs(metricValue(b,selectedMetric??'clicks'))-Math.abs(metricValue(a,selectedMetric??'clicks'))||a.name.localeCompare(b.name,'ru',{numeric:true}));
  const maxValue=Math.max(1,...breakdownRows.map(item=>Math.abs(metricValue(item,selectedMetric??'clicks'))));
  const openRow=(item:MetricRow)=>{setPath(previous=>[...previous,{row:item,groupBy:breakdownGroup}]);setTab('overview');};
  const parentGroup=path.at(-2)?.groupBy;
  const backLabel=parentGroup==='total'&&inspection?.compareBy?({platform:'сравнению площадок',scenario:'сравнению сценариев',format:'сравнению форматов',partner:'сравнению партнёров'}[inspection.compareBy]):({partner:'партнёру',material:'материалу',platform:'площадке',scenario:'сценарию',format:'формату',total:'обзору'} as Record<string,string>)[parentGroup??'']??'обзору';
  const firstDate=period?dateLabel(period.since,timezone):'',lastDate=period?dateLabel(new Date(Date.parse(period.until)-1).toISOString(),timezone):'';
  useEffect(()=>{body.current?.scrollTo?.({top:0});(path.length>1?back:close).current?.focus({preventScroll:true});},[path]);
  const content=<aside ref={root} className={`results-page results-drawer${embedded?' is-embedded':''}`} role={embedded?'region':'dialog'} aria-modal={embedded?undefined:true} aria-labelledby={titleId}>
      <header className="results-drawer__header"><div>{path.length>1&&<button ref={back} type="button" className="results-drill-back" onClick={()=>{setPath(previous=>previous.slice(0,-1));setTab('overview');}}><ArrowLeft size={14}/>Назад к {backLabel}</button>}<span>{comparisonMode?comparisonNames[comparisonMode]:inspection?'Подробная статистика':'Результаты за выбранный период'}</span><h2 id={titleId}>{groupBy==='total'&&selectedMetric?chartMetricLabels[selectedMetric]:row.name}</h2>{inspection?.context&&<small>{inspection.context}</small>}{period&&<small>{firstDate}{lastDate!==firstDate?` — ${lastDate}`:''}</small>}{row.createdAt && <small>Создана {dateLabel(row.createdAt,timezone)}{row.archived ? ' · Архив' : ''}</small>}</div><button ref={close} type="button" className="results-icon-button" aria-label="Закрыть подробности" onClick={onClose}><X size={18}/></button></header>
      <nav className="results-drawer__tabs" role="tablist" aria-label="Подробности статистики" onKeyDown={event => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const tabs = ['overview', 'history', 'audience'];
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
        setTab(tabs[index]!); event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[index]?.focus();
      }}>{[['overview', 'Обзор'], ['history', 'Действия'], ['audience', 'Аудитория']].map(([key, label]) => <button key={key} type="button" id={`${titleId}-${key}`} role="tab" aria-selected={tab === key} aria-controls={`${titleId}-panel`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key!)}>{label}</button>)}</nav>
      <div ref={body} className="results-drawer__body" id={`${titleId}-panel`} role="tabpanel" aria-labelledby={`${titleId}-${tab}`}>
        {tab === 'overview' ? <>
          {summary?<>{selectedMetric&&<div className="results-drill-total"><span>{chartMetricLabels[selectedMetric]}</span><strong>{labelMetric(summary,selectedMetric)}</strong><small>{selectedMetric==='payingCustomers'?'Клиенты без повторов за выбранный период':selectedMetric==='earningsMinor'?'Начисленные комиссии с учётом возвратов':'За выбранный период и выбранные источники'}</small></div>}
          {selectedMetric&&placements.data?.comparison&&<div className="results-drill-previous"><span>Предыдущий период<small>{dateLabel(placements.data.comparison.period.since,timezone)} — {dateLabel(new Date(Date.parse(placements.data.comparison.period.until)-1).toISOString(),timezone)}</small></span><strong>{labelMetric(placements.data.comparison,selectedMetric)}</strong></div>}
          <div className="results-drawer__stats">{defaultChartMetrics.map(key=><button type="button" key={key} aria-label={`Показать: ${chartMetricLabels[key]}`} aria-pressed={selectedMetric===key} onClick={()=>setSelectedMetric(key)}><span>{chartMetricLabels[key]}</span><strong>{labelMetric(summary,key)}</strong></button>)}</div>
          {summary.amountsMinor.observedPayments>0&&summary.amountsMinor.netAccrued===0&&<p className="results-note">Оплаты клиентов учтены. Начисленные комиссии с учётом возвратов — {money(0)}.</p>}</>:null}
          {onScope && groupBy === 'link' && row.id !== '__none__' && <button type="button" className="results-text-button" onClick={() => onScope(row.id)}>Динамика этой ссылки<ArrowUpRight size={14}/></button>}
          {row.placement ? <PlacementInfo row={row} timezone={timezone}/> : groupBy === 'link' && row.linkKey ? <p className="results-link-line"><span>Партнёрская ссылка</span><code>{trackingShareUrl(row.linkKey)}</code></p> : null}
          {groupBy === 'link' && row.id === '__none__' && <p className="results-note">У этих переходов не сохранена связь со ссылкой. Они включены в общий итог.</p>}
          {row.material&&<p className="results-note">{row.material.formatName}{row.material.scenarioName?` · ${row.material.scenarioName}`:''}</p>}
          {groupBy !== 'source' && <section className="results-drawer__placements"><div className="results-drill-list-heading"><h3>{groupNames[breakdownGroup]??'Размещения'}</h3>{selectedMetric&&<span>{chartMetricLabels[selectedMetric]}</span>}</div><ErrorBanner error={placements.error}/>
            {placements.isLoading ? <p className="results-note" role="status">Загружаем статистику…</p> : breakdownRows.length ? breakdownRows.map(source => <div key={source.id} className="results-placement-card">
              <button type="button" className="results-drill-row" aria-label={source.name} onClick={()=>openRow(source)}>{comparisonMode&&<i className="results-comparison-dot" style={{background:chartSeriesColor(source.id)}}/>}<span className="results-drill-row__name"><strong>{source.id === '__none__'&&!comparisonMode ? breakdownGroup==='material'?'Общие ссылки без материала':'Без указания размещения' : source.name}</strong>{!comparisonMode&&<small>{source.placement?`${source.placement.platformName}${source.placement.channelName?` · ${source.placement.channelName}`:''}`:source.material?.formatName??source.platformNames?.join(' · ')}</small>}</span><b>{labelMetric(source,selectedMetric??'clicks')}</b><ChevronRight size={15}/></button>
              {comparisonMode?<div className="results-comparison-track" aria-hidden="true"><i style={{width:`${Math.abs(metricValue(source,selectedMetric??'clicks'))/maxValue*100}%`,background:chartSeriesColor(source.id)}}/></div>:<p className="results-placement-card__metrics">Переходы: {source.counts.clicks} · Регистрации: {source.counts.registrations} · Клиенты: {source.counts.payingCustomers}{!selectedMetric&&<strong>{money(source.amountsMinor.netAccrued / 100)}</strong>}</p>}
            </div>) : !placements.error && <p className="results-note">{selectedMetric==='earningsMinor'?`По выбранным источникам заработок за этот период — ${money(0)}.`:selectedMetric?`За выбранный период по показателю «${chartMetricLabels[selectedMetric]}» действий нет.`:'За выбранный период нет действий по отдельным размещениям.'}</p>}
            {(selectedMetric==='payingCustomers'||selectedMetric==='registrations')&&breakdownRows.length>1&&<p className="results-note">Один клиент может относиться к нескольким {({platform:'площадкам',scenario:'сценариям',format:'форматам',material:'материалам'} as Record<string,string>)[breakdownGroup]??'размещениям'}. В общем итоге он учитывается один раз.</p>}
          </section>}
          {summary&&<details className="results-row-payments"><summary>Оплаты и конверсии</summary><PaymentDetails row={summary} currency={currency}/></details>}
        </> : <>
          <ErrorBanner error={detail.error}/>
          {detail.isLoading ? <p className="results-note" role="status">Загружаем данные…</p> : tab === 'history' ? <>
            <p className="results-note">Все действия {groupBy==='total'?'выбранных источников':groupBy==='material'?'этого материала':'этого источника'} за указанный период.</p>
            {!history.length && !detail.error ? <p className="results-note">За выбранный период действий нет.</p> : <ol className="results-history">{history.map(item => <li key={item.id}><span><strong>{actions[item.kind] ?? 'Событие'}</strong><time dateTime={item.ts}>{new Date(item.ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', year:'numeric', timeZone:timezone })}</time>{admin&&<small>{item.partnerNames?.filter(Boolean).join(' · ')}{item.linkKeys?.filter(Boolean).length?' · Ссылка: '+item.linkKeys.filter(Boolean).join(', '):''}</small>}</span>{item.amountMinor !== null && <b className={item.kind === 'refund' ? 'results-refund' : ''}>{new Intl.NumberFormat('ru-RU',{style:'currency',currency:item.currency??'RUB'}).format(item.amountMinor / 100)}</b>}</li>)}</ol>}
            {detail.hasNextPage && <button type="button" className="results-button" disabled={detail.isFetchingNextPage} onClick={() => void detail.fetchNextPage()}>{detail.isFetchingNextPage ? 'Загружаем…' : 'Ещё действия'}</button>}
          </> : traffic && <><TrafficList title="Источники переходов" rows={traffic.referrers}/><TrafficList title="Устройства" rows={traffic.devices}/><p className="results-note">По данным переходов за выбранный период. Если сайт или приложение не передали источник, он не определяется по названию ссылки.</p></>}
        </>}
      </div>
    </aside>;
  return embedded?content:createPortal(<div className="results-drawer-backdrop" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>{content}</div>,document.body);
}

function TrafficList({ title, rows }: { title: string; rows: Array<{ name: string; count: number }> }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return <section className="results-traffic"><h3>{title}</h3>{rows.length ? <ul>{rows.map(row => <li key={row.name}><i aria-hidden="true" style={{ width: `${row.count / max * 100}%` }}/><span>{row.name}</span><strong>{row.count}</strong></li>)}</ul> : <p className="results-note">За выбранный период переходов нет.</p>}</section>;
}
