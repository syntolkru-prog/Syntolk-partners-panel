import { calendarDay } from './ResultsDatePicker.js';
import type { AnalyticsReport } from './PartnerAnalytics.js';

export type WorkdayPeriod = 'today' | '7d' | '30d' | 'all';
export interface HomeDetails {
  traffic: { referrers: Array<{name:string;count:number}> };
  registrations?: Array<{id:string;userId:string;registeredAt:string;source:string;paidMinor:number|null;currency:string}>;
}
export const shiftHomeDay = (day:string, offset:number) => new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0,10);
export function homeQueries(period:WorkdayPeriod, endDay:string|null, timezone:string, now = new Date()) {
  const today = calendarDay(now.toISOString(), timezone), to = endDay || today;
  const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
  const from = period === 'all' ? '2000-01-01' : shiftHomeDay(to, 1-days);
  const current = new URLSearchParams({period: endDay ? 'custom' : period, currency:'RUB'});
  if (endDay) { current.set('from',from); current.set('to',to); }
  const previous = period === 'all' ? null : new URLSearchParams({period:'custom',from:shiftHomeDay(from,-days),to:shiftHomeDay(from,-1),currency:'RUB'});
  return { current, previous, to, from };
}
export function homeDelta(value:number|undefined, previous:number|undefined) {
  if (value === undefined || previous === undefined || !Number.isFinite(value) || !Number.isFinite(previous)) return null;
  if (previous === 0) return value === 0 ? 0 : null;
  return (value-previous) / Math.abs(previous) * 100;
}
export function homeTraffic(rows:HomeDetails['traffic']['referrers']) {
  const sorted = rows.filter(row=>Number.isFinite(row.count)&&row.count>0).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  return sorted.length > 4 ? [...sorted.slice(0,3),{name:'Остальные',count:sorted.slice(3).reduce((sum,row)=>sum+row.count,0)}] : sorted;
}
export const homeConversion = (report?:AnalyticsReport) => report?.conversions.registrationToPayment ?? null;
