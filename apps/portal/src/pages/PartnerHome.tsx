import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CreditCard, MousePointerClick, Receipt, Users, Wallet } from 'lucide-react';
import {ResultsDatePicker,rangeCaption,type DateChoice} from './ResultsDatePicker.js';
import {WorkdayRegistrationsDialog} from './WorkdayRegistrationsDialog.js';
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
import './results-explorer.css';

interface PartnerProfile { termsAcceptedAt:string|null }
const periodLabels = {today:'Сегодня','7d':'7 дней','30d':'30 дней',all:'Весь период',custom:'Свои даты'};
export function HomePeriodTabs({period,onChange,label,includeToday=false}:{period:WorkdayPeriod;onChange:(value:WorkdayPeriod)=>void;label:string;includeToday?:boolean}) {
  const periods:WorkdayPeriod[]=includeToday?['today','7d','30d','all']:['7d','30d','all'];
  return <Tabs value={period} onValueChange={value=>onChange(value as WorkdayPeriod)} className="wd-period-tabs"><TabsList variant="solid" aria-label={label}>{periods.map(value=><TabsTrigger key={value} value={value}>{periodLabels[value]}</TabsTrigger>)}</TabsList></Tabs>;
}
export function PartnerHome({partnerId,name}:{partnerId:string;name:string}) {
  const cache=useQueryClient();
  const base=useTenantBase(), {programTermsUrl}=useBrand();
  const [period,setPeriod]=useState<WorkdayPeriod>('30d'),[custom,setCustom]=useState<DateChoice|undefined>(),[registrationsOpen,setRegistrationsOpen]=useState(false);
  const [timezone,setTimezone]=useState('Europe/Moscow');
  const range=homeQueries(period,null,timezone,new Date(),custom);
  const query=new URLSearchParams(range.current);query.set('groupBy','platform');query.set('includeSeries','true');
  const report=useQuery({queryKey:['partner-analytics',currentTenantSlug(),partnerId,query.toString()],queryFn:()=>api<AnalyticsReport>(`/partners/${partnerId}/analytics?${query}`),refetchInterval:30000,refetchOnWindowFocus:true});
  useEffect(()=>{if(report.data?.timezone)setTimezone(report.data.timezone);},[report.data?.timezone]);
  const previousQuery=new URLSearchParams(range.previous??undefined);previousQuery.set('groupBy','platform');
  const previous=useQuery({queryKey:['partner-analytics',currentTenantSlug(),partnerId,previousQuery.toString()],queryFn:()=>api<AnalyticsReport>(`/partners/${partnerId}/analytics?${previousQuery}`),enabled:!!range.previous,refetchInterval:30000});
  const detailsQuery=new URLSearchParams(range.current);detailsQuery.set('includeRegistrations','true');
  const details=useQuery({queryKey:['partner-analytics-details',currentTenantSlug(),partnerId,detailsQuery.toString()],queryFn:()=>api<HomeDetails>(`/partners/${partnerId}/analytics/details?${detailsQuery}`),refetchInterval:30000,refetchOnWindowFocus:true});
  const sourceQuery=new URLSearchParams(range.current);sourceQuery.set('groupBy','source');
  const sources=useQuery({queryKey:['partner-analytics',currentTenantSlug(),partnerId,sourceQuery.toString()],queryFn:()=>api<AnalyticsReport>(`/partners/${partnerId}/analytics?${sourceQuery}`),refetchInterval:30000,refetchOnWindowFocus:true});
  const profile=useQuery({queryKey:['partner-profile',partnerId],queryFn:()=>api<PartnerProfile>(`/partners/${partnerId}`)});
  const acceptingTerms=useRef(false);
  const acceptTerms=useMutation({mutationFn:()=>api<{partner?:PartnerProfile}>(`/partners/${partnerId}/terms`,{method:'POST',body:{accepted:true,version:'syntolk-v1'}}),onSuccess:result=>{if(result.partner?.termsAcceptedAt)cache.setQueryData(['partner-profile',partnerId],result.partner);return profile.refetch();},onSettled:()=>{acceptingTerms.current=false;}});
  const submitTerms=()=>{if(acceptingTerms.current||acceptTerms.isPending)return;acceptingTerms.current=true;acceptTerms.mutate();};
  const data=report.data, baseline=range.previous?previous.data:undefined, currency=data?.currency??'RUB', points=data?.series?.points??[];
  const resultsHref=`${base}/results?${range.current}`;
  const conversion=homeConversion(data), oldConversion=homeConversion(baseline);
  const count=(value:number|undefined)=>value===undefined?'—':value.toLocaleString('ru-RU');
  const percent=(value:number|null)=>value===null?'—':`${(value*100).toLocaleString('ru-RU',{maximumFractionDigits:1})}%`;
  const compareLabel=period==='all'?'':period==='today'?'vs. предыдущий день':period==='custom'?`vs. предыдущий период (${range.days} дн.)`:`vs. предыдущие ${period==='7d'?'7':'30'} дней`;
  const balances=data?.periodBalances;
  return <div className="partner-workday" data-design="syntolk-workday">
    <header className="wd-header"><div><p className="wd-greeting">Здравствуйте, {name.replace(/\s+Syntolk$/,'')}</p><h1>Ваш рабочий день <span aria-hidden="true">👋</span></h1><p className="wd-subtitle">Здесь основные показатели, задачи и статистика по партнёрской программе Syntolk.</p></div>
      <div className="wd-header-controls"><HomePeriodTabs period={period} onChange={setPeriod} label="Период статистики"/><ResultsDatePicker label="Выбрать даты статистики" calendarLabel="Период статистики" value={{from:range.from,to:range.to}} timezone={timezone} caption={period==='custom'?rangeCaption({from:range.from,to:range.to}):'Выбрать даты'} onChange={value=>{setCustom(value);setPeriod('custom');}}/></div>
    </header>
    <ErrorBanner error={report.error??profile.error}/>
    {!profile.isLoading&&profile.data&&!profile.data.termsAcceptedAt&&<Card className="wd-card wd-terms"><div><h2>Подтвердите условия партнёрской программы</h2>{programTermsUrl&&<a href={programTermsUrl} target="_blank" rel="noreferrer">Открыть условия <ArrowUpRight size={13}/></a>}<ErrorBanner error={acceptTerms.error}/></div><Button onClick={submitTerms} disabled={acceptTerms.isPending}>{acceptTerms.isPending?'Сохраняем…':'Принять условия'}</Button></Card>}
    <Card className="wd-card wd-daily-card p-0"><CoachDay partnerId={partnerId} appearance="workday"/></Card>
    <section className="wd-kpis" aria-label="Ваши результаты" aria-busy={report.isLoading}>
      <WorkdayKpi title="Переходы" value={count(data?.counts.clicks)} current={data?.counts.clicks} previous={baseline?.counts.clicks} points={points.map(p=>({date:p.date,value:p.clicks}))} icon={MousePointerClick} color="blue" compareLabel={compareLabel} href={resultsHref}/>
      <WorkdayKpi title="Регистрации" value={count(data?.counts.registrations)} current={data?.counts.registrations} previous={baseline?.counts.registrations} points={points.map(p=>({date:p.date,value:p.registrations}))} icon={Receipt} color="violet" compareLabel={compareLabel} href={resultsHref} onOpen={()=>setRegistrationsOpen(true)}/>
      <WorkdayKpi title="Платящие клиенты" value={count(data?.counts.payingCustomers)} current={data?.counts.payingCustomers} previous={baseline?.counts.payingCustomers} points={points.map(p=>({date:p.date,value:p.payingCustomers??0}))} icon={Users} color="blue" compareLabel={compareLabel} href={resultsHref}/>
      <WorkdayKpi title="Конверсия" value={percent(conversion)} current={conversion??undefined} previous={oldConversion??undefined} points={[]} icon={CreditCard} color="violet" compareLabel={compareLabel} href={resultsHref} hint="Регистрация → оплата · когорта из выбранного периода"/>
    </section>
    <div className="wd-insights">
      <WorkdayRevenue report={data} previous={baseline} loading={report.isLoading} error={report.error} currency={currency} href={resultsHref}/>
      <WorkdayTraffic details={details.data} sourcesReport={sources.data} loading={sources.isLoading} error={sources.error} resultsHref={resultsHref}/>
      <Card asChild className="wd-card wd-finance p-0"><section aria-label="Финансы за выбранный период" aria-busy={report.isLoading}><div className="wd-card-heading"><h2><span className="wd-icon"><Wallet size={18}/></span>Финансы</h2></div>
        <dl>{[['Начислено',balances?.total],['Доступно',balances?.available],['Ожидает выплаты',balances?.pending],['Выплачено',balances?.paid]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{typeof value==='number'?money(value,currency):'—'}</dd></div>)}</dl>
        {(data?.balances?.debt??0)>0&&<p className="wd-finance-debt">Корректировка прошлых выплат: {money(data!.balances!.debt!,currency)}. Учитывается при следующей выплате.</p>}
        <Link className="wd-link-button" to={`${base}/payouts`}>История выплат <ArrowUpRight size={13}/></Link>
      </section></Card>
    </div>
    <WorkdayRegistrations details={details.data} loading={details.isLoading} error={details.error} timezone={data?.timezone??timezone} onOpen={()=>setRegistrationsOpen(true)}/>
    {registrationsOpen&&<WorkdayRegistrationsDialog partnerId={partnerId} query={range.current.toString()} range={{from:range.from,to:range.to}} onClose={()=>setRegistrationsOpen(false)}/>}
  </div>;
}
