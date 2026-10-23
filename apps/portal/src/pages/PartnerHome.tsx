import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, ChevronDown, CreditCard, MousePointerClick, Receipt, Users, Wallet } from 'lucide-react';
import { api, currentTenantSlug } from '../api.js';
import { useTenantBase } from '../tenant-base.js';
import { useBrand } from '../lib/useBrand.js';
import { Button, ErrorBanner, money } from '../ui.js';
import { Card } from '../components/tremor/raw/components/Card/Card.js';
import { Tabs, TabsList, TabsTrigger } from '../components/tremor/raw/components/Tabs/Tabs.js';
import { CoachDay } from './coach/CoachDay.js';
import type { AnalyticsReport } from './PartnerAnalytics.js';
import { homeConversion, homeQueries, type HomeDetails, type WorkdayPeriod } from './partner-workday-data.js';
import { WorkdayKpi, WorkdayRevenue, WorkdayTraffic, WorkdayRegistrations } from './PartnerWorkdayPanels.js';
import './partner-workday.css';

interface PartnerProfile { termsAcceptedAt:string|null }
const periodLabels = {today:'Сегодня','7d':'7 дней','30d':'30 дней',all:'Весь период'};
export function HomePeriodTabs({period,onChange,label}:{period:WorkdayPeriod;onChange:(value:WorkdayPeriod)=>void;label:string}) {
  return <Tabs value={period} onValueChange={value=>onChange(value as WorkdayPeriod)} className="wd-period-tabs"><TabsList variant="solid" aria-label={label}>{(['7d','30d','all'] as const).map(value=><TabsTrigger key={value} value={value}>{periodLabels[value]}</TabsTrigger>)}</TabsList></Tabs>;
}
export function PartnerHome({partnerId,name}:{partnerId:string;name:string}) {
  const base=useTenantBase(), {programTermsUrl}=useBrand();
  const [period,setPeriod]=useState<WorkdayPeriod>('30d'),[endDay,setEndDay]=useState<string|null>(null);
  const [timezone,setTimezone]=useState('Europe/Moscow');
  const range=homeQueries(period,endDay,timezone);
  const query=new URLSearchParams(range.current);query.set('groupBy','platform');query.set('includeSeries','true');
  const report=useQuery({queryKey:['partner-analytics',currentTenantSlug(),partnerId,query.toString()],queryFn:()=>api<AnalyticsReport>(`/partners/${partnerId}/analytics?${query}`),refetchInterval:30000,refetchOnWindowFocus:true});
  useEffect(()=>{if(report.data?.timezone)setTimezone(report.data.timezone);},[report.data?.timezone]);
  const previousQuery=new URLSearchParams(range.previous??undefined);previousQuery.set('groupBy','platform');
  const previous=useQuery({queryKey:['partner-analytics',currentTenantSlug(),partnerId,previousQuery.toString()],queryFn:()=>api<AnalyticsReport>(`/partners/${partnerId}/analytics?${previousQuery}`),enabled:!!range.previous,refetchInterval:30000});
  const detailsQuery=new URLSearchParams(range.current);detailsQuery.set('includeRegistrations','true');
  const details=useQuery({queryKey:['partner-analytics-details',currentTenantSlug(),partnerId,detailsQuery.toString()],queryFn:()=>api<HomeDetails>(`/partners/${partnerId}/analytics/details?${detailsQuery}`),refetchInterval:30000,refetchOnWindowFocus:true});
  const profile=useQuery({queryKey:['partner-profile',partnerId],queryFn:()=>api<PartnerProfile>(`/partners/${partnerId}`)});
  const acceptTerms=useMutation({mutationFn:()=>api(`/partners/${partnerId}/terms`,{method:'POST',body:{accepted:true,version:'syntolk-v1'}}),onSuccess:()=>profile.refetch()});
  const data=report.data, baseline=range.previous?previous.data:undefined, currency=data?.currency??'RUB', points=data?.series?.points??[];
  const resultsHref=`${base}/results?${range.current}`;
  const conversion=homeConversion(data), oldConversion=homeConversion(baseline);
  const count=(value:number|undefined)=>value===undefined?'—':value.toLocaleString('ru-RU');
  const percent=(value:number|null)=>value===null?'—':`${(value*100).toLocaleString('ru-RU',{maximumFractionDigits:1})}%`;
  const compareLabel=period==='all'?'':period==='today'?'vs. предыдущий день':`vs. предыдущие ${period==='7d'?'7':'30'} дней`;
  const dateCaption=new Date(`${range.to}T12:00:00Z`).toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  const balances=data?.balances;
  return <div className="partner-workday" data-design="syntolk-workday">
    <header className="wd-header"><div><p className="wd-greeting">Здравствуйте, {name.replace(/\s+Syntolk$/,'')}</p><h1>Ваш рабочий день <span aria-hidden="true">👋</span></h1><p className="wd-subtitle">Здесь основные показатели, задачи и статистика по партнёрской программе Syntolk.</p></div>
      <div className="wd-header-controls"><HomePeriodTabs period={period} onChange={setPeriod} label="Период статистики"/><label className="wd-date"><CalendarDays size={18}/><span>{dateCaption}</span><ChevronDown size={14}/><input type="date" aria-label="Последний день периода" value={range.to} max={homeQueries(period,null,timezone).to} onChange={event=>{if(event.target.value)setEndDay(event.target.value===homeQueries(period,null,timezone).to?null:event.target.value);}}/></label></div>
    </header>
    <ErrorBanner error={report.error??profile.error}/>
    {!profile.isLoading&&profile.data&&!profile.data.termsAcceptedAt&&<Card className="wd-card wd-terms"><div><h2>Подтвердите условия партнёрской программы</h2>{programTermsUrl&&<a href={programTermsUrl} target="_blank" rel="noreferrer">Открыть условия <ArrowUpRight size={13}/></a>}<ErrorBanner error={acceptTerms.error}/></div><Button onClick={()=>acceptTerms.mutate()} disabled={acceptTerms.isPending}>{acceptTerms.isPending?'Сохраняем…':'Принять условия'}</Button></Card>}
    <Card className="wd-card wd-daily-card p-0"><CoachDay partnerId={partnerId} appearance="workday"/></Card>
    <section className="wd-kpis" aria-label="Ваши результаты" aria-busy={report.isLoading}>
      <WorkdayKpi title="Переходы" value={count(data?.counts.clicks)} current={data?.counts.clicks} previous={baseline?.counts.clicks} points={points.map(p=>({date:p.date,value:p.clicks}))} icon={MousePointerClick} color="blue" compareLabel={compareLabel} href={resultsHref}/>
      <WorkdayKpi title="Регистрации" value={count(data?.counts.registrations)} current={data?.counts.registrations} previous={baseline?.counts.registrations} points={points.map(p=>({date:p.date,value:p.registrations}))} icon={Receipt} color="violet" compareLabel={compareLabel} href={resultsHref}/>
      <WorkdayKpi title="Платящие клиенты" value={count(data?.counts.payingCustomers)} current={data?.counts.payingCustomers} previous={baseline?.counts.payingCustomers} points={points.map(p=>({date:p.date,value:p.payingCustomers??0}))} icon={Users} color="blue" compareLabel={compareLabel} href={resultsHref}/>
      <WorkdayKpi title="Конверсия" value={percent(conversion)} current={conversion??undefined} previous={oldConversion??undefined} points={[]} icon={CreditCard} color="violet" compareLabel={compareLabel} href={resultsHref} hint="Регистрация → оплата · когорта из выбранного периода"/>
    </section>
    <div className="wd-insights">
      <WorkdayRevenue report={data} previous={baseline} loading={report.isLoading} error={report.error} currency={currency} tabs={<HomePeriodTabs period={period} onChange={setPeriod} label="Период выручки"/>} href={resultsHref}/>
      <WorkdayTraffic details={details.data} loading={details.isLoading} error={details.error}/>
      <Card asChild className="wd-card wd-finance p-0"><section aria-label="Финансы за всё время" aria-busy={report.isLoading}><div className="wd-card-heading"><h2><span className="wd-icon"><Wallet size={18}/></span>Финансы</h2><span className="wd-scope">Всё время <ChevronDown size={12}/></span></div>
        <dl>{[['Начислено',balances?.total],['Доступно',balances?.available],['Ожидает выплаты',balances?.pending],['Выплачено',balances?.paid]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{typeof value==='number'?money(value,currency):'—'}</dd></div>)}</dl>
        {(balances?.debt??0)>0&&<p className="wd-finance-debt">Корректировка прошлых выплат: {money(balances!.debt!,currency)}. Учитывается при следующей выплате.</p>}
        <Link className="wd-link-button" to={`${base}/payouts`}>История выплат <ArrowUpRight size={13}/></Link>
      </section></Card>
    </div>
    <WorkdayRegistrations details={details.data} loading={details.isLoading} error={details.error} timezone={data?.timezone??timezone} href={resultsHref}/>
  </div>;
}
