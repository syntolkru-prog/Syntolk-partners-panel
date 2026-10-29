import { calendarDay,type DateChoice } from './ResultsDatePicker.js';
import type { AnalyticsReport } from './PartnerAnalytics.js';

export type WorkdayPeriod = 'today' | '7d' | '30d' | 'all' | 'custom';
export interface RegistrationSource {name:string;programId:string;linkId:string|null;sourceId:string|null;scenarioId:string|null;platformId:string|null;materialId:string|null}
export interface HomeRegistration {id:string;userId:string;registeredAt:string;source:string;sourceDetails?:RegistrationSource[];paidMinor:number|null;paymentCount?:number;currency:string}
export interface HomeDetails {
  traffic: { referrers: Array<{name:string;count:number}> };
  registrations?: HomeRegistration[];
  registrationsTotal?:number;
}
export interface RegistrationPage {registrations:HomeRegistration[];total:number;nextCursor:string|null;timezone:string}
export const shiftHomeDay = (day:string, offset:number) => new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0,10);
export function homeQueries(period:WorkdayPeriod, endDay:string|null, timezone:string, now = new Date(),custom?:DateChoice) {
  const today = calendarDay(now.toISOString(), timezone), to = period==='custom'&&custom?custom.to:endDay || today;
  const days = period==='custom'&&custom?Math.round((Date.parse(custom.to)-Date.parse(custom.from))/86400000)+1:period === 'today' ? 1 : period === '7d' ? 7 : 30;
  const from = period==='custom'&&custom?custom.from:period === 'all' ? '2000-01-01' : shiftHomeDay(to, 1-days);
  const current = new URLSearchParams({period: endDay ? 'custom' : period, currency:'RUB'});
  if (endDay||period==='custom') { current.set('from',from); current.set('to',to); }
  const previous = period === 'all' ? null : new URLSearchParams({period:'custom',from:shiftHomeDay(from,-days),to:shiftHomeDay(from,-1),currency:'RUB'});
  return { current, previous, to, from,days };
}
export function homeDelta(value:number|undefined, previous:number|undefined) {
  if (value === undefined || previous === undefined || !Number.isFinite(value) || !Number.isFinite(previous)) return null;
  if (previous === 0) return value === 0 ? 0 : null;
  return (value-previous) / Math.abs(previous) * 100;
}
export function homeTraffic(rows:HomeDetails['traffic']['referrers']) {
  const sorted = homeTrafficRows(rows);
  return sorted.length > 4 ? [...sorted.slice(0,3),{name:'Остальные',count:sorted.slice(3).reduce((sum,row)=>sum+row.count,0)}] : sorted;
}
export const homeTrafficRows=(rows:HomeDetails['traffic']['referrers'])=>rows.filter(row=>Number.isFinite(row.count)&&row.count>0).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
export const homeConversion = (report?:AnalyticsReport) => report?.conversions.registrationToPayment ?? null;
