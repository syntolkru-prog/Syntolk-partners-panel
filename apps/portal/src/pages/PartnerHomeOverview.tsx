import { useId, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, FileText, Globe2, Link2 } from 'lucide-react';
import { money } from '../ui.js';
import { useTenantBase } from '../tenant-base.js';
import type { AnalyticsReport } from './PartnerAnalytics.js';
import type { SeriesPoint } from './ResultsChart.js';
import { usePartnerVisual } from '../components/tremor/PartnerVisual.js';
import { AreaChart } from '../components/tremor/raw/components/AreaChart/AreaChart.js';

const shortDate = (date: string, timezone = 'Europe/Moscow') => new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: timezone });
export function homePeriodCaption(period?: AnalyticsReport['period'], timezone?: string) {
  if (!period || !Number.isFinite(Date.parse(period.since)) || !Number.isFinite(Date.parse(period.until))) return '';
  return `${shortDate(period.since, timezone)} — ${shortDate(new Date(Date.parse(period.until) - 1).toISOString(), timezone)}`;
}
const pointDate = (point: SeriesPoint) => `${point.date.slice(0, 10)}T12:00:00Z`;

/** Actual accrued commission buckets, not the lifetime balance or a forecast. */
export function PartnerHomeChart({ series, currency, loading, error }: {
  series?: AnalyticsReport['series']; currency: string; loading: boolean; error?: unknown;
}) {
  const tremor = usePartnerVisual();
  if (tremor) return <TremorHomeChart series={series} currency={currency} loading={loading} error={error} />;
  return <LegacyHomeChart series={series} currency={currency} loading={loading} error={error} />;
}
function TremorHomeChart({series,currency,loading,error}:{series?:AnalyticsReport['series'];currency:string;loading:boolean;error?:unknown}) {
  const points=series?.points??[];
  const [focusedDate,setFocusedDate]=useState<string|null>(null);
  const focused=points.find(point=>point.date===focusedDate);
  return <div className="ph-chart" aria-label="Динамика заработка" aria-busy={loading}>
    {loading?<div className="ph-chart__placeholder" role="status">Загрузка динамики…</div>:error?<div className="ph-chart__placeholder" role="status">Не удалось загрузить динамику</div>:!points.length?<div className="ph-chart__placeholder" role="status">{series?'За этот период событий нет':'Динамика недоступна'}</div>:
      <><AreaChart className="h-64 w-full" data={points.map(point=>({date:shortDate(pointDate(point),'UTC'),Заработок:point.earningsMinor}))} index="date" categories={['Заработок']} colors={['blue']} valueFormatter={value=>money(value/100,currency)} showLegend={false} yAxisWidth={78} startEndOnly minValue={Math.min(0,...points.map(point=>point.earningsMinor))}/>
      <div className="ph-chart__keyboard" aria-label="Даты графика">{points.map((point,index)=><button key={point.date} type="button" aria-label={`${shortDate(pointDate(point),'UTC')}: ${money(point.earningsMinor/100,currency)}`} style={{left:`${points.length===1?50:12+index/(points.length-1)*85}%`}} onFocus={()=>setFocusedDate(point.date)} onBlur={()=>setFocusedDate(null)} onClick={()=>setFocusedDate(point.date)}/>)}</div>
      {focused&&<div className="ph-chart__tooltip" role="status" style={{left:'20%'}}><span>{shortDate(pointDate(focused),'UTC')}</span><strong>{money(focused.earningsMinor/100,currency)}</strong></div>}</>
    }
  </div>;
}
function LegacyHomeChart({ series, currency, loading, error }: {
  series?: AnalyticsReport['series']; currency: string; loading: boolean; error?: unknown;
}) {
  const id = useId().replace(/:/g, '');
  const [active, setActive] = useState<{ date: string; index: number } | null>(null);
  const points = series?.points ?? [];
  const values = points.map(point => point.earningsMinor);
  const ready = points.length > 0 && values.every(Number.isFinite);
  const width = 720, height = 260, left = 82, right = 16, top = 16, bottom = 36;
  const low = Math.min(0, ...values), high = Math.max(0, ...values), span = high - low || 1;
  const magnitude = 10 ** Math.floor(Math.log10(span / 4));
  const step = [1, 2, 2.5, 5, 10].find(value => value * magnitude >= span / 4)! * magnitude;
  const min = Math.floor(low / step) * step, max = Math.max(min + step, Math.ceil(high / step) * step);
  const x = (index: number) => points.length === 1 ? (width + left - right) / 2 : left + index / (points.length - 1) * (width - left - right);
  const y = (value: number) => top + (max - value) / (max - min) * (height - top - bottom);
  const line = ready ? points.map((_, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(values[index]!).toFixed(2)}`).join(' ') : '';
  const selected = active && points[active.index]?.date === active.date ? active.index : null;
  const activePoint = selected === null ? undefined : points[selected];
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => min + step * index);
  const tickIndexes = [...new Set([0, Math.round((points.length - 1) / 2), points.length - 1])].filter(index => index >= 0);
  const compactMoney = (value: number) => new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value / 100) + (currency === 'RUB' ? ' ₽' : ` ${currency}`);
  let message = '';
  if (error) message = 'Не удалось загрузить динамику';
  else if (!loading && !ready) message = series?.points.length === 0 ? 'За этот период событий нет' : 'Динамика недоступна';

  const inspectPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * width;
    const index = points.length === 1 ? 0 : Math.max(0, Math.min(points.length - 1, Math.round((px - left) / (width - left - right) * (points.length - 1))));
    setActive({ index, date: points[index]!.date });
  };
  return <div className="ph-chart" aria-label="Динамика заработка" aria-busy={loading}>
    {loading ? <div className="ph-chart__placeholder" role="status">Загрузка динамики…</div> : message ? <div className="ph-chart__placeholder" role="status">{message}</div> : <>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Начисления по датам" preserveAspectRatio="none" onPointerLeave={event => { if (event.pointerType !== 'touch') setActive(null); }}
        onPointerMove={inspectPoint} onPointerDown={inspectPoint}>
        <defs><linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--ph-chart-color)" stopOpacity=".23" /><stop offset="100%" stopColor="var(--ph-chart-color)" stopOpacity=".02" /></linearGradient></defs>
        {ticks.map((value, index) => <g key={index}><line className="ph-chart__grid" x1={left} x2={width - right} y1={y(value)} y2={y(value)} /><text x={left - 12} y={y(value) + 4} textAnchor="end">{compactMoney(value)}</text></g>)}
        <path d={`${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${id}-area)`} />
        <path className="ph-chart__line" d={line} fill="none" stroke="var(--ph-chart-color)" strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {points.length === 1 && <circle cx={x(0)} cy={y(values[0]!)} r="4" fill="var(--ph-chart-color)" />}
        {tickIndexes.map(index => <text key={index} x={x(index)} y={height - 8} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{shortDate(pointDate(points[index]!), 'UTC')}</text>)}
        {activePoint && selected !== null && <g><line className="ph-chart__cursor" x1={x(selected)} x2={x(selected)} y1={top} y2={height - bottom} /><circle cx={x(selected)} cy={y(activePoint.earningsMinor)} r="4" fill="var(--ph-chart-color)" stroke="var(--ph-surface)" strokeWidth="2" /></g>}
      </svg>
      <div className="ph-chart__keyboard" aria-label="Даты графика">{points.map((point, index) => <button key={point.date} type="button" aria-label={`${shortDate(pointDate(point), 'UTC')}: ${money(point.earningsMinor / 100, currency)}`}
        style={{ left: `${x(index) / width * 100}%` }} onFocus={() => setActive({ date: point.date, index })} onBlur={() => setActive(null)} onClick={() => setActive({ date: point.date, index })} />)}</div>
      {activePoint && selected !== null && <div className="ph-chart__tooltip" role="status" style={{ left: `${Math.max(20, Math.min(78, x(selected) / width * 100))}%` }}><span>{shortDate(pointDate(activePoint), 'UTC')}</span><strong>{money(activePoint.earningsMinor / 100, currency)}</strong></div>}
    </>}
  </div>;
}

export function PartnerHomeBreakdown({ title, dimension, report, loading, error, period, currency }: {
  title: string; dimension: 'platform' | 'format' | 'link'; report?: AnalyticsReport; loading: boolean; error?: unknown; period: string; currency: string;
}) {
  const base = useTenantBase();
  const [metric, setMetric] = useState<'clicks' | 'earnings'>('clicks');
  const Icon = dimension === 'platform' ? Globe2 : dimension === 'format' ? FileText : Link2;
  const score = (row: AnalyticsReport['rows'][number]) => metric === 'clicks' ? row.counts.clicks : row.amountsMinor.netAccrued;
  const rows = [...(report?.rows ?? [])].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, 'ru')).slice(0, 5);
  const largest = Math.max(1, ...rows.map(row => Math.abs(score(row))));
  const href = `${base}/${dimension === 'link' ? 'links?section=analytics&view=links' : `results?groupBy=${dimension}`}&period=${period}`;
  const rowHref = (id: string) => `${base}/results?period=${period}&groupBy=${dimension}&${dimension === 'platform' ? 'platformIds' : dimension === 'format' ? 'formatIds' : 'linkId'}=${encodeURIComponent(id)}`;
  return <section className="ph-card ph-breakdown" aria-label={title} aria-busy={loading}>
    <div className="ph-panel-heading"><h2>{title}</h2><Link className="ph-view-all" to={href} aria-label={`Все: ${title.toLocaleLowerCase('ru-RU')}`}>Все <ArrowUpRight size={12} aria-hidden="true" /></Link></div>
    <div className="ph-breakdown__tabs" role="group" aria-label={`Показатель: ${title.toLocaleLowerCase('ru-RU')}`}>
      <button type="button" aria-pressed={metric === 'clicks'} onClick={() => setMetric('clicks')}>Переходы</button><button type="button" aria-pressed={metric === 'earnings'} onClick={() => setMetric('earnings')}>Заработок</button>
    </div>
    <div className="ph-breakdown__rows">
      {loading ? Array.from({ length: 5 }, (_, index) => <div key={index} className="ph-breakdown__skeleton" aria-hidden="true"><span className="ph-skeleton" /></div>)
        : error ? <p className="ph-breakdown__empty">Не удалось загрузить данные</p>
        : !report ? <p className="ph-breakdown__empty">Данные недоступны</p>
        : !rows.length ? <p className="ph-breakdown__empty">Нет событий за период</p>
        : rows.map(row => <Link className="ph-breakdown__row" key={row.id} to={rowHref(row.id)} title={row.name} aria-label={`${row.name}, ${metric === 'clicks' ? `переходы: ${row.counts.clicks}` : `заработок: ${money(row.amountsMinor.netAccrued / 100, currency)}`}`}>
          <span className="ph-breakdown__bar" style={{ width: `${Math.abs(score(row)) / largest * 100}%` } as CSSProperties} />
          <Icon size={14} aria-hidden="true" /><span className="ph-breakdown__name">{row.name}</span><strong>{metric === 'clicks' ? row.counts.clicks.toLocaleString('ru-RU') : money(row.amountsMinor.netAccrued / 100, currency)}</strong>
        </Link>)}
    </div>
  </section>;
}
