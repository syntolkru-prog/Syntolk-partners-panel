import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, GitCompareArrows, X } from 'lucide-react';

export interface DateChoice {from:string;to:string;preset?:'today'|'7d'|'30d'}
export const calendarDay=(value:string,timezone='Europe/Moscow')=>new Intl.DateTimeFormat('sv-SE',{timeZone:timezone}).format(new Date(value));
const shiftDay=(day:string,amount:number)=>{const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10);};
const shiftMonth=(month:string,amount:number)=>{const date=new Date(`${month}-01T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+amount);return date.toISOString().slice(0,7);};
const labelDay=(day:string)=>new Date(`${day}T12:00:00Z`).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
export const rangeCaption=(range:DateChoice)=>range.from===range.to?labelDay(range.from):`${labelDay(range.from)} — ${labelDay(range.to)}`;
export const validDateRange=(range:DateChoice,today?:string)=>[range.from,range.to].every(day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day)&&range.from<=range.to&&(!today||range.to<=today);
export const reportRange=(period:{since:string;until:string}|undefined,timezone='Europe/Moscow'):DateChoice|undefined=>period?{from:calendarDay(period.since,timezone),to:calendarDay(new Date(Date.parse(period.until)-1).toISOString(),timezone)}:undefined;
export function clearResultsComparison(params:URLSearchParams) {
  const next=new URLSearchParams(params);
  for(const key of ['compare','includeComparison','compareFrom','compareTo'])next.delete(key);
  return next;
}
export function applyResultsPeriods(params:URLSearchParams,primary:DateChoice,comparison:DateChoice|null) {
  const next=clearResultsComparison(params);
  for(const key of ['since','until','from','to'])next.delete(key);
  next.set('period',primary.preset??'custom');
  if(!primary.preset){next.set('from',primary.from);next.set('to',primary.to);}
  if(comparison){next.set('compare','true');next.set('compareFrom',comparison.from);next.set('compareTo',comparison.to);}
  return next;
}
export const resultsPeriods={today:'Сегодня','7d':'Последние 7 дней','30d':'Последние 30 дней',all:'Всё время',custom:'Свои даты'};
export type ResultsPeriod=keyof typeof resultsPeriods;

export function ResultsDatePicker({label,value,timezone='Europe/Moscow',onChange,onApply,comparison=false,onClear,active=true,caption,disabled=false,primaryValue,period,onPeriodChange,calendarLabel=label}:{
  label:string;value:DateChoice;timezone?:string;onChange:(range:DateChoice)=>void;comparison?:boolean;onClear?:()=>void;active?:boolean;caption?:string;disabled?:boolean;
  period?:ResultsPeriod;onPeriodChange?:(period:ResultsPeriod)=>void;calendarLabel?:string;
  /** When comparing, the main period can be edited in the same menu as the comparison period. */
  primaryValue?:DateChoice;onApply?:(primary:DateChoice|undefined,comparison:DateChoice)=>void;
}) {
  const today=calendarDay(new Date().toISOString(),timezone),id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const monthCount=comparison&&window.innerWidth>480?2:1;
  const anchorMonth=(day:string)=>shiftMonth(day.slice(0,7),monthCount===2?-1:0);
  const [open,setOpen]=useState(false),[periodMenu,setPeriodMenu]=useState(false),[draft,setDraft]=useState(value),[primaryDraft,setPrimaryDraft]=useState(primaryValue),[month,setMonth]=useState(anchorMonth(value.to||primaryValue?.to||today)),[choosingEnd,setChoosingEnd]=useState(false),[focusDay,setFocusDay]=useState(value.to||today),[editing,setEditing]=useState<'primary'|'comparison'>('comparison');
  const selected=comparison&&editing==='primary'&&primaryDraft?primaryDraft:draft;
  const setSelected=(range:DateChoice)=>{if(comparison&&editing==='primary')setPrimaryDraft(range);else setDraft(range);};
  const openCalendar=()=>{setPeriodMenu(false);setDraft(value);setPrimaryDraft(primaryValue);setEditing('comparison');setChoosingEnd(false);setFocusDay(value.to||primaryValue?.to||today);setMonth(anchorMonth(value.to||primaryValue?.to||today));setOpen(true);};
  const edit=(slot:'primary'|'comparison')=>{setEditing(slot);setChoosingEnd(false);const range=slot==='primary'?primaryDraft:draft;setMonth(anchorMonth(range?.to||range?.from||today));setFocusDay(range?.to||range?.from||today);};
  const pendingFocus=useRef(false);
  const [position,setPosition]=useState<CSSProperties>({});
  const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{const anchor=trigger.current?.getBoundingClientRect();if(!anchor)return;const width=Math.min(periodMenu?230:comparison?660:320,window.innerWidth-32),left=Math.max(16,Math.min(anchor.left,window.innerWidth-width-16));setPosition({width,left:left-anchor.left,maxHeight:Math.max(180,window.innerHeight-anchor.bottom-28)});};
    place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);
  },[open,periodMenu,comparison]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const input=periodMenu?root.current?.querySelector<HTMLElement>('[role=menuitemradio][aria-checked=true]'):[...(root.current?.querySelectorAll<HTMLInputElement>('input')??[])].find(element=>element.getAttribute('aria-label')===`${calendarLabel}: начало`);
    input?.focus({preventScroll:true});
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open,periodMenu,calendarLabel]);
  useEffect(()=>{if(open&&pendingFocus.current){root.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus({preventScroll:true});pendingFocus.current=false;}},[focusDay,month,open]);
  const chooseDay=(day:string)=>{
    setFocusDay(day);
    if(!choosingEnd){setSelected({from:day,to:''});setChoosingEnd(true);}
    else{setSelected({from:day<selected.from?day:selected.from,to:day<selected.from?selected.from:day});setChoosingEnd(false);}
  };
  const keyboardDay=(event:React.KeyboardEvent,day:string)=>{
    const steps:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
    if(!(event.key in steps))return;event.preventDefault();
    const next=shiftDay(day,steps[event.key]!);if(next>today)return;
    if(next.slice(0,7)<month||next.slice(0,7)>shiftMonth(month,monthCount-1))setMonth(next.slice(0,7));
    pendingFocus.current=true;setFocusDay(next);
  };
  const valid=validDateRange(draft,today)&&(!comparison||!primaryDraft||validDateRange(primaryDraft,today));
  const changeMonth=(value:string)=>{if(/^\d{4}-\d{2}$/.test(value)){setMonth(value);setFocusDay(`${value}-01`);}};
  const inputs=(range:DateChoice,slot:'primary'|'comparison',fieldLabel:string)=>{
    const change=(field:'from'|'to',value:string)=>{const changed={from:range.from,to:range.to,[field]:value};if(slot==='primary')setPrimaryDraft(changed);else setDraft(changed);setEditing(slot);setChoosingEnd(false);if(value)setMonth(anchorMonth(value));};
    return <div className="results-calendar__inputs"><label>Начало<input type="date" aria-label={`${fieldLabel}: начало`} value={range.from} max={today} onFocus={()=>{if(comparison&&editing!==slot)edit(slot);}} onInput={event=>change('from',event.currentTarget.value)} onChange={event=>change('from',event.target.value)}/></label><span>—</span><label>Конец<input type="date" aria-label={`${fieldLabel}: конец`} value={range.to} max={today} onFocus={()=>{if(comparison&&editing!==slot)edit(slot);}} onInput={event=>change('to',event.currentTarget.value)} onChange={event=>change('to',event.target.value)}/></label></div>;
  };
  return <div ref={root} className={`results-date-picker${comparison&&active&&onClear?' results-date-picker--comparing':''}`}>
    <button ref={trigger} type="button" className={`results-button${comparison&&active?' is-active':''}`} aria-label={label} aria-haspopup={open&&!periodMenu?'dialog':onPeriodChange?'menu':'dialog'} aria-expanded={open} aria-controls={id} onClick={()=>{
      if(open){close();return;}if(onPeriodChange){setPeriodMenu(true);setOpen(true);}else openCalendar();
    }} disabled={disabled}>{comparison?<GitCompareArrows size={15}/>:<CalendarDays size={15}/>}<span>{caption??(comparison?(active?`Сравнение: ${rangeCaption(value)}`:'Сравнить периоды'):period&&period!=='custom'?resultsPeriods[period]:rangeCaption(value))}</span>{onPeriodChange&&<ChevronDown size={13}/>}</button>
    {comparison&&active&&onClear&&<button type="button" className="results-button results-date-picker__clear" aria-label="Сбросить сравнение" title="Сбросить сравнение" onClick={()=>{onClear();close();}}><X size={14} aria-hidden="true"/><span>Сбросить</span></button>}
    {open&&<div id={id} className={`results-calendar${periodMenu?' results-calendar--periods':!comparison?' results-calendar--compact':''}`} style={position} role={periodMenu?'menu':'dialog'} aria-label={periodMenu?label:calendarLabel} data-results-menu onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
      if(periodMenu&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=[...(root.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]')??[])],index=items.indexOf(document.activeElement as HTMLElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
    }}>
      {periodMenu?Object.entries(resultsPeriods).map(([key,name])=><button key={key} type="button" role="menuitemradio" aria-checked={period===key} onClick={()=>{onPeriodChange?.(key as ResultsPeriod);if(key==='custom')openCalendar();else close();}}>{name}</button>):<>
      <div className="results-calendar__main">
        <div className={comparison?'results-calendar__ranges':undefined}>
        {comparison&&primaryDraft&&<section className="results-calendar__period-block" data-active={editing==='primary'} onClick={()=>{if(editing!=='primary')edit('primary');}}><strong>Основной период</strong>{inputs(primaryDraft,'primary','Основной период')}</section>}
        <section className={comparison?'results-calendar__period-block':undefined} data-active={comparison?editing==='comparison':undefined} onClick={()=>{if(comparison&&editing!=='comparison')edit('comparison');}}>
          {comparison&&<strong>Период сравнения</strong>}
          {inputs(draft,'comparison',calendarLabel)}
        </section>
        </div>
        <div className="results-calendar__navigation"><button type="button" className="results-icon-button" aria-label="Предыдущий месяц" onClick={()=>setMonth(shiftMonth(month,-1))}><ChevronLeft size={15}/></button><input type="month" aria-label="Месяц календаря" value={month} max={today.slice(0,7)} onInput={event=>changeMonth(event.currentTarget.value)} onChange={event=>changeMonth(event.target.value)}/><button type="button" className="results-icon-button" aria-label="Следующий месяц" disabled={shiftMonth(month,monthCount-1)>=today.slice(0,7)} onClick={()=>setMonth(shiftMonth(month,1))}><ChevronRight size={15}/></button></div>
        <div className="results-calendar__months">{Array.from({length:monthCount},(_,i)=>shiftMonth(month,i)).map(current=>{
          const first=new Date(`${current}-01T12:00:00Z`),offset=(first.getUTCDay()+6)%7,last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
          return <section key={current} aria-label={first.toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'})}>{comparison&&<h3>{first.toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'})}</h3>}<div className="results-calendar__days">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day=><span key={day}>{day}</span>)}{Array.from({length:offset},(_,i)=><span key={`blank-${i}`}/>)}{Array.from({length:last.getUTCDate()},(_,i)=>{
            const day=`${current}-${String(i+1).padStart(2,'0')}`,edge=day===selected.from||day===selected.to,inRange=!!(selected.from&&selected.to&&day>=selected.from&&day<=selected.to);
            return <button key={day} type="button" data-day={day} aria-label={labelDay(day)} aria-pressed={edge} aria-current={day===today?'date':undefined} disabled={day>today} tabIndex={day===focusDay?0:-1} className={`${edge?'is-edge':''}${inRange?' is-in-range':''}`} onClick={()=>chooseDay(day)} onKeyDown={event=>keyboardDay(event,day)}>{i+1}</button>;
          })}{Array.from({length:42-offset-last.getUTCDate()},(_,i)=><span key={`after-${i}`} aria-hidden="true"/>)}</div></section>;
        })}</div>
        <footer className="results-calendar__footer">{comparison&&active&&onClear&&<button type="button" className="results-text-button results-calendar__clear" onClick={()=>{onClear();close();}}>Убрать сравнение</button>}<button type="button" className="results-button" onClick={close}>Отмена</button><button type="button" className="results-button is-active" disabled={!valid} onClick={()=>{if(onApply)onApply(comparison&&primaryDraft?primaryDraft:undefined,draft);else onChange(draft);close();}}>Применить</button></footer>
      </div>
      </>}
    </div>}
  </div>;
}
