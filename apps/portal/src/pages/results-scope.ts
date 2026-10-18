import type { AnalyticsReport } from './PartnerAnalytics.js';
import type { ChartInspection, ChartMetric } from './ResultsChart.js';

export const metricValue = (row:Pick<AnalyticsReport,'counts'|'amountsMinor'>,metric:ChartMetric) => metric==='payments'?row.counts.paymentCount:metric==='customerPaymentsMinor'?row.amountsMinor.observedPayments:metric==='earningsMinor'?row.amountsMinor.netAccrued:row.counts[metric]??0;

export function inspectionScope(query:string,selection:ChartInspection,report:Pick<AnalyticsReport,'period'|'series'>) {
  const scoped=new URLSearchParams(query);
  let period=report.period;
  if(selection.point){
    const point=selection.point;
    period=point.since&&point.until?{since:point.since,until:point.until}:undefined;
    scoped.delete('includeComparison');
    if(!period){
      const end=new Date(`${point.date}T12:00:00Z`);
      if(report.series?.bucket==='month')end.setUTCMonth(end.getUTCMonth()+1);else end.setUTCDate(end.getUTCDate()+(report.series?.bucket==='week'?7:1));
      end.setUTCDate(end.getUTCDate()-1);
      scoped.delete('since');scoped.delete('until');scoped.set('period','custom');scoped.set('from',point.date);scoped.set('to',end.toISOString().slice(0,10));
    }
  }
  if(period){scoped.set('since',period.since);scoped.set('until',period.until);}
  if(selection.group){const field=`${selection.group.by}Id`;scoped.delete(field);scoped.delete(`${field}s`);scoped.set(field,selection.group.id);}
  return {query:scoped.toString(),period};
}
