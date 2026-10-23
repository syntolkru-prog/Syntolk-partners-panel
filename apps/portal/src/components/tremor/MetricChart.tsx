import { useRef, useState, type ComponentProps } from 'react';
import { AreaChart, ChartTooltip } from './raw/components/AreaChart/AreaChart.js';
import { BarChart } from './raw/components/BarChart/BarChart.js';
import { LineChart } from './raw/components/LineChart/LineChart.js';
import { chartMetricLabels, type ChartMetric, type SeriesPoint } from '../../pages/ResultsChart.js';
import { money } from '../../ui.js';
import {metricPalette,sourcePalette} from './chartPalette.js';

export interface MetricChartProps {
  series?: { bucket: string; points: SeriesPoint[] };
  lines: Array<{ id: string; name: string; color: string; points: SeriesPoint[] }>;
  metric: ChartMetric;
  onInspect?: (point: SeriesPoint, group?: { id: string; name: string }) => void;
  large?: boolean;
  range?: { min: number; max: number };
  currencyCode?: string;
}
const dayLabel = (date: string, full = false) => new Date(date + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: full ? 'numeric' : undefined, timeZone: 'UTC' });

/** Presentation adapter only: unchanged buckets, domain, currency units and drill-down callbacks. */
export function MetricChart({ series, lines, metric, onInspect, large = false, range, currencyCode = 'RUB' }: MetricChartProps) {
  const points = series?.points ?? [], monetary = metric.endsWith('Minor');
  const [keyboard, setKeyboard] = useState<{ timeline: string; index: number } | null>(null);
  const timeline = points.map(point => point.date).join(',') + metric;
  const active = keyboard?.timeline === timeline ? points[keyboard.index] : undefined;
  const lastTooltip = useRef<{ date: string; category: string } | null>(null);
  const data = points.map(point => ({ date: dayLabel(point.date, series?.bucket === 'month'), _rawDate: point.date, ...Object.fromEntries(lines.map(line => [line.id, line.points.find(item => item.date === point.date)?.[metric] ?? 0])) }));
  const format = (value: number) => monetary ? money(value / 100, currencyCode) : value.toLocaleString('ru-RU');
  const values = lines.flatMap(line => line.points.map(point => point[metric] ?? 0));
  const min = Math.min(0, range?.min ?? 0, ...values), max = range?.max;
  const unit = series?.bucket === 'week' ? 'По неделям' : series?.bucket === 'month' ? 'По месяцам' : 'По дням';
  const Tooltip = useRef<NonNullable<ComponentProps<typeof AreaChart>['customTooltip']>>((props) => {
    const current = tooltipState.current;
    const first = props.payload?.[0];
    lastTooltip.current = props.active && first ? { date: String(first.payload._rawDate), category: first.category } : null;
    return <ChartTooltip {...props} label={first ? dayLabel(String(first.payload._rawDate), true) : props.label} payload={props.payload.map(item => ({ ...item, category: current.lines.find(line => line.id === item.category)?.name ?? item.category }))} valueFormatter={current.format} />;
  }).current;
  const tooltipState = useRef({ lines, format });
  tooltipState.current = { lines, format };
  const inspect = (value: {eventType:string;categoryClicked:string;[key:string]:string|number}|null|undefined) => {
    if (!onInspect || value?.eventType === 'category') return;
    const date = value?._rawDate ?? lastTooltip.current?.date, category = value?.categoryClicked ?? lastTooltip.current?.category;
    const point = points.find(point => point.date === date), group = lines.find(line => line.id === category);
    if (point) onInspect(point, lines.length > 1 ? group : undefined);
  };
  const props = { data, index: 'date', categories: lines.map(line => line.id), colors: lines.map(line => line.id===metric?metricPalette[metric][0]:sourcePalette(line.id)[0]), valueFormatter: format,
    showLegend: false, showTooltip: true, showGridLines: true, yAxisWidth: large ? 68 : 56, startEndOnly: !large, minValue: min, maxValue: max,
    allowDecimals: monetary, className: 'h-full w-full', onValueChange: onInspect ? inspect : undefined, customTooltip: Tooltip };
  return <div className={`${large ? 'results-large-plot' : 'results-mini-plot'} results-chart__plot tremor-metric-chart`} role="group" data-clickable={!!onInspect} tabIndex={0}
    style={{ height: large ? 350 : 180 }} aria-label={`${chartMetricLabels[metric]}, ${unit.toLowerCase()}. Стрелки — по датам.${onInspect ? ' Enter — подробности.' : ''}`}
    onFocus={event => { if (event.target === event.currentTarget && points.length) setKeyboard({ timeline, index: points.length - 1 }); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setKeyboard(null); }}
    onKeyDown={event => { if (event.target !== event.currentTarget || !points.length) return; const index = keyboard?.timeline === timeline ? keyboard.index : points.length - 1;
      if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); setKeyboard({ timeline, index: event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))) }); }
      if (onInspect && ['Enter',' '].includes(event.key)) { event.preventDefault(); onInspect(points[index]!); }
    }}>
    {lines.length === 1 && !monetary ? <BarChart {...props} minPointSize={2} /> : lines.length > 1 ? <LineChart {...props} /> : <AreaChart {...props} />}
    {!values.some(value => value !== 0) && <span className="results-mini-plot__empty">{monetary ? metric === 'earningsMinor' ? 'Начислений нет' : 'Оплат нет' : points.length ? 'Нет действий' : 'Нет данных'}</span>}
    {active && <div className="results-chart__tooltip" role="status" aria-label={`Значение графика: ${chartMetricLabels[metric]}`}><span>{dayLabel(active.date, true)}{series?.bucket === 'week' ? ' · неделя' : series?.bucket === 'month' ? ' · месяц' : ''}</span><div><span>{chartMetricLabels[metric]}</span><strong>{format(active[metric] ?? 0)}</strong></div></div>}
  </div>;
}
