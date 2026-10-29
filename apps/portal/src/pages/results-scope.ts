import type { AnalyticsReport } from './PartnerAnalytics.js';
import type { ChartInspection, ChartMetric } from './ResultsChart.js';
import type { QueryClient } from '@tanstack/react-query';

export function materialReturnPath(raw:string|null,base:string,partnerId:string) {
  if(!raw?.startsWith('/')||raw.startsWith('//'))return null;
  const path=raw.split(/[?#]/)[0];
  return [`${base}/plan`,`${base}/links`,`${base}/admin/coach`,`${base}/admin/calculator`,`${base}/admin/analytics`,`${base}/admin/partners/${encodeURIComponent(partnerId)}`].includes(path!)?raw:null;
}

/** Reset report controls, not the login, tenant or partner-detail navigation. */
export function resetResultsFilters(params:URLSearchParams,keepProgram=false) {
  const next=new URLSearchParams(params);
  for(const key of ['period','from','to','since','until','compare','includeComparison','compareFrom','compareTo','currency','timezone','bucket','partnerId','partnerIds','scenarioId','scenarioIds','platformId','platformIds','formatId','formatIds','materialId','sourceId','linkId','metrics','chartBy','groupBy','activity','includeEmpty','showEmpty','sort','search','tableSort','tableDirection','page','pageSize'])next.delete(key);
  if(!keepProgram)next.delete('programId');
  return next;
}

// Scenario identifiers belong to one partner. Keep that scope when exactly one
// partner is selected; cross-partner comparisons use the other shared filters.
export function adminOverviewParams(params:URLSearchParams) {
  const next=new URLSearchParams(params);
  const partners=new Set([...next.getAll('partnerId'),...next.getAll('partnerIds')].filter(Boolean));
  if(partners.size!==1)for(const key of ['scenarioId','scenarioIds'])next.delete(key);
  if(next.get('chartBy')==='scenario')next.delete('chartBy');
  if(next.get('groupBy')==='scenario')next.delete('groupBy');
  return next;
}

export function invalidateAnalytics(client:QueryClient) {
  return client.invalidateQueries({predicate:({queryKey})=>['dashboard','funnel','admin-overview','partner-detail-dashboard','partner-analytics','partner-analytics-details','admin-analytics','admin-analytics-partners','admin-analytics-partner-picker','admin-analytics-quality','calculator-current-values'].includes(String(queryKey[0]))});
}

export const metricValue = (row:Pick<AnalyticsReport,'counts'|'amountsMinor'>,metric:ChartMetric) => metric==='payments'?row.counts.paymentCount:metric==='customerPaymentsMinor'?row.amountsMinor.observedPayments:metric==='earningsMinor'?row.amountsMinor.netAccrued:row.counts[metric]??0;

export function analyticsChartTotals(report:Pick<AnalyticsReport,'counts'|'amountsMinor'>):Record<ChartMetric,number> {
  return {clicks:report.counts.clicks,identities:report.counts.identities??0,registrations:report.counts.registrations,payingCustomers:report.counts.payingCustomers,payments:report.counts.paymentCount,customerPaymentsMinor:report.amountsMinor.observedPayments,earningsMinor:report.amountsMinor.netAccrued};
}
export function comparisonLabel(value:number,previous:number) {
  if(value===previous)return 'Без изменений';
  if(previous===0)return 'В сравнении — 0';
  const change=(value-previous)/Math.abs(previous)*100;
  return `${change>0?'↑':'↓'} ${Math.abs(change).toLocaleString('ru-RU',{maximumFractionDigits:1})}%`;
}
export function analyticsChartChanges(current:Pick<AnalyticsReport,'counts'|'amountsMinor'>,previous:Pick<AnalyticsReport,'counts'|'amountsMinor'>) {
  const values=analyticsChartTotals(current),baseline=analyticsChartTotals(previous);
  return Object.fromEntries((Object.keys(values) as ChartMetric[]).map(metric=>[metric,comparisonLabel(values[metric],baseline[metric])])) as Record<ChartMetric,string>;
}

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
