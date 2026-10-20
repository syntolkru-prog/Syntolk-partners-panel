import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useQuery} from '@tanstack/react-query';
import {api,currentTenantSlug} from '../api.js';
import type {AnalyticsReport} from './PartnerAnalytics.js';

export interface CurrentValuesFilter {period:'today'|'7d'|'30d'|'all'|'custom';from:string;to:string;allContent:boolean}
type ContentCounts={preparedMaterials:number;publishedMaterials:number;publishedPlacements:number};
type Conversions=AnalyticsReport['conversions']&{cohortRegistrations?:number;cohortPaidRegistrations?:number};
export type CurrentReport=AnalyticsReport&{conversions:Conversions;content:ContentCounts;breakdown?:{formats:FactRow[];platforms:FactRow[]}};
type FactRow={id:string;name:string;counts:AnalyticsReport['counts'];amountsMinor:Pick<AnalyticsReport['amountsMinor'],'observedPayments'|'netAccrued'>;conversions:Conversions;content:ContentCounts;formats?:FactRow[]};
const civilDay=(date=new Date(),timezone='Europe/Moscow')=>new Intl.DateTimeFormat('sv-SE',{timeZone:timezone}).format(date);
const validDay=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day;

/** Data bridge only: the original calculator owns every field, tab and chart. */
export function CalculatorCurrentValues({partnerId,programId,scenarioId,scenarioName,active,filter,onFilter,root}:{
  partnerId:string;programId:string;scenarioId:string;scenarioName:string;active:boolean;filter:CurrentValuesFilter;onFilter:(value:CurrentValuesFilter)=>void;root:HTMLElement|null;
}){
  const today=civilDay(),tenant=currentTenantSlug();
  const valid=filter.period!=='custom'||validDay(filter.from)&&validDay(filter.to)&&filter.from<=filter.to&&filter.to<=today;
  const params=new URLSearchParams({programId,period:filter.period});
  if(!filter.allContent)params.set('scenarioId',scenarioId);
  if(filter.period==='custom'){params.set('from',filter.from);params.set('to',filter.to);}
  const query=useQuery({queryKey:['calculator-current-values',tenant,partnerId,params.toString()],
    queryFn:()=>api<CurrentReport>(`/partners/${partnerId}/analytics/current?${params}`),
    enabled:active&&!!programId&&!!partnerId&&valid,retry:false,refetchInterval:5000,refetchOnWindowFocus:true,staleTime:0});
  const chartReport=valid?query.data:undefined;
  const selectionScope=JSON.stringify([tenant,partnerId,scenarioId,params.toString(),today]);
  const [selection,setSelection]=useState<{scope:string;date:string}|null>(null);
  const point=active&&selection?.scope===selectionScope?chartReport?.series?.points.find(item=>item.date===selection.date):undefined;
  let selectedPoint:{date:string;from:string;to:string}|null=null;
  if(point){
    const next=new Date(point.date+'T12:00:00Z');
    if(chartReport?.series?.bucket==='month')next.setUTCMonth(next.getUTCMonth()+1);else next.setUTCDate(next.getUTCDate()+(chartReport?.series?.bucket==='week'?7:1));
    next.setUTCDate(next.getUTCDate()-1);
    const from=point.since?civilDay(new Date(point.since),chartReport?.timezone):point.date;
    const to=point.until?civilDay(new Date(Date.parse(point.until)-1),chartReport?.timezone):next.toISOString().slice(0,10);
    selectedPoint={date:point.date,from,to:to>today?today:to};
  }
  const pointParams=new URLSearchParams({programId,period:'custom',from:selectedPoint?.from??'',to:selectedPoint?.to??''});
  if(!filter.allContent)pointParams.set('scenarioId',scenarioId);
  const pointQuery=useQuery({queryKey:['calculator-current-values',tenant,partnerId,pointParams.toString()],
    queryFn:()=>api<CurrentReport>(`/partners/${partnerId}/analytics/current?${pointParams}`),
    enabled:active&&!!programId&&!!partnerId&&valid&&!!selectedPoint,retry:false,refetchInterval:5000,refetchOnWindowFocus:true,staleTime:0});
  const report=selectedPoint?pointQuery.data:chartReport;
  const [datesOpen,setDatesOpen]=useState(false),[draft,setDraft]=useState({from:filter.from,to:filter.to});
  const error=!valid?'Выберите начало и конец прошедшего или текущего периода.':query.error||selectedPoint&&pointQuery.error?'Не удалось получить фактические значения.':!programId?'Выберите партнёрскую программу.':'';
  const [refreshState,setRefreshState]=useState<'idle'|'loading'|'success'|'error'>('idle');
  const refreshId=useRef(0);
  useEffect(()=>{refreshId.current++;setRefreshState('idle');setSelection(null);},[selectionScope,active]);
  const storageKey='syntolk-calculator-fact-views-v1:'+JSON.stringify([tenant,partnerId,programId,filter.allContent?'all':scenarioId,filter.period,filter.from,filter.to,['7d','30d','today'].includes(filter.period)?today:'',...(selectedPoint?[selectedPoint.from,selectedPoint.to]:[])]);
  const payload={active,filter,report,chartReport,selectedPoint,error,storageKey,scenarioName,refreshState};
  const latest=useRef({...payload,onFilter});latest.current={...payload,onFilter};
  const refresh=useRef(()=>{});
  refresh.current=()=>{
    if(!programId||!partnerId||!valid||refreshState==='loading')return;
    const id=++refreshId.current;setRefreshState('loading');
    void Promise.all([query.refetch({cancelRefetch:false}),...(selectedPoint?[pointQuery.refetch({cancelRefetch:false})]:[])])
      .then(results=>{if(id===refreshId.current)setRefreshState(results.some(result=>result.isError)?'error':'success');});
  };
  const select=useRef((date:string|null)=>{});
  select.current=date=>{
    if(!active)return;
    if(!date){setSelection(null);return;}
    if(!chartReport?.series?.points.some(item=>item.date===date))return;
    setSelection(current=>current?.scope===selectionScope&&current.date===date?null:{scope:selectionScope,date});
  };
  useEffect(()=>{
    if(!root)return;
    const send=()=>{const {onFilter:_,...payload}=latest.current;root.dispatchEvent(new CustomEvent('syntolk-calculator-current-values',{detail:payload}));};
    const change=(event:Event)=>{
      const value=(event as CustomEvent<Partial<CurrentValuesFilter>>).detail;
      if(value.period==='custom'){setDraft({from:latest.current.filter.from,to:latest.current.filter.to});setDatesOpen(true);return;}
      latest.current.onFilter({...latest.current.filter,...value});
    };
    const reload=()=>refresh.current();
    const inspect=(event:Event)=>select.current((event as CustomEvent<string|null>).detail);
    root.addEventListener('syntolk-calculator-ready',send);
    root.addEventListener('syntolk-calculator-fact-filter',change);
    root.addEventListener('syntolk-calculator-refresh',reload);
    root.addEventListener('syntolk-calculator-fact-point',inspect);
    send();
    return ()=>{root.removeEventListener('syntolk-calculator-ready',send);root.removeEventListener('syntolk-calculator-fact-filter',change);root.removeEventListener('syntolk-calculator-refresh',reload);root.removeEventListener('syntolk-calculator-fact-point',inspect);};
  },[root]);
  useEffect(()=>{
    if(root){const {onFilter:_,...payload}=latest.current;root.dispatchEvent(new CustomEvent('syntolk-calculator-current-values',{detail:payload}));}
  },[root,active,filter,report,chartReport,point?.date,error,storageKey,scenarioName,refreshState]);
  const validDraft=validDay(draft.from)&&validDay(draft.to)&&draft.from<=draft.to&&draft.to<=today;
  return root&&datesOpen&&active?createPortal(<dialog open aria-label="Свои даты факта" className="pf-section" style={{position:'fixed',zIndex:1000,top:'25vh',width:'min(420px,90vw)',padding:20,border:'1px solid var(--pf-border)',borderRadius:'var(--pf-radius)',background:'var(--pf-surface)',color:'var(--pf-text)'}}>
    <div className="pf-fields-grid"><label className="pf-field"><span>С</span><input type="date" aria-label="Начало периода факта" max={today} value={draft.from} onInput={event=>{const value=event.currentTarget.value;setDraft(current=>({...current,from:value}));}} onChange={event=>{const value=event.target.value;setDraft(current=>({...current,from:value}));}}/></label><label className="pf-field"><span>По</span><input type="date" aria-label="Конец периода факта" max={today} value={draft.to} onInput={event=>{const value=event.currentTarget.value;setDraft(current=>({...current,to:value}));}} onChange={event=>{const value=event.target.value;setDraft(current=>({...current,to:value}));}}/></label></div>
    <div className="pf-fields-grid" style={{marginTop:16}}><button type="button" className="pf-text-button" onClick={()=>{setDatesOpen(false);root.querySelector<HTMLSelectElement>('#pf-horizon')!.value=filter.period;}}>Отмена</button><button type="button" disabled={!validDraft} onClick={()=>{onFilter({...filter,period:'custom',...draft});setDatesOpen(false);}}>Применить</button></div>
  </dialog>,root):null;
}
