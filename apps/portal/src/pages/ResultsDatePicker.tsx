import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, GitCompareArrows } from 'lucide-react';

export interface DateChoice {from:string;to:string;preset?:'today'|'7d'|'30d'}
export const calendarDay=(value:string,timezone='Europe/Moscow')=>new Intl.DateTimeFormat('sv-SE',{timeZone:timezone}).format(new Date(value));
const shiftDay=(day:string,amount:number)=>{const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10);};
const shiftMonth=(month:string,amount:number)=>{const date=new Date(`${month}-01T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+amount);return date.toISOString().slice(0,7);};
const labelDay=(day:string)=>new Date(`${day}T12:00:00Z`).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
export const rangeCaption=(range:DateChoice)=>range.from===range.to?labelDay(range.from):`${labelDay(range.from)} — ${labelDay(range.to)}`;
const anchorMonth=(day:string)=>shiftMonth(day.slice(0,7),window.innerWidth<=480?0:-1);

export function ResultsDatePicker({label,value,timezone='Europe/Moscow',onChange,comparison=false,onPrevious,onClear,active=true,caption}:{
  label:string;value:DateChoice;timezone?:string;onChange:(range:DateChoice)=>void;comparison?:boolean;onPrevious?:()=>void;onClear?:()=>void;active?:boolean;caption?:string;
}) {
  const today=calendarDay(new Date().toISOString(),timezone),id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const [open,setOpen]=useState(false),[draft,setDraft]=useState(value),[month,setMonth]=useState(anchorMonth(value.to)),[choosingEnd,setChoosingEnd]=useState(false),[focusDay,setFocusDay]=useState(value.to);
  const monthCount=window.innerWidth<=480?1:2;
  const pendingFocus=useRef(false);
  const [position,setPosition]=useState<CSSProperties>({});
  const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{const anchor=trigger.current?.getBoundingClientRect();if(!anchor)return;const width=Math.min(660,window.innerWidth-32),left=Math.max(16,Math.min(anchor.left,window.innerWidth-width-16));setPosition({width,left:left-anchor.left,maxHeight:Math.max(180,window.innerHeight-anchor.bottom-28)});};
    place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    root.current?.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true});
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  useEffect(()=>{if(open&&pendingFocus.current){root.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus({preventScroll:true});pendingFocus.current=false;}},[focusDay,month,open]);
  const chooseDay=(day:string)=>{
    setFocusDay(day);
    if(!choosingEnd){setDraft({from:day,to:''});setChoosingEnd(true);}
    else{setDraft({from:day<draft.from?day:draft.from,to:day<draft.from?draft.from:day});setChoosingEnd(false);}
  };
  const preset=(kind:'today'|'7d'|'30d'|'month')=>{setDraft({from:kind==='month'?`${today.slice(0,7)}-01`:shiftDay(today,kind==='7d'?-6:kind==='30d'?-29:0),to:today,...(kind!=='month'?{preset:kind}:{})});setMonth(anchorMonth(today));setFocusDay(today);setChoosingEnd(false);};
  const keyboardDay=(event:React.KeyboardEvent,day:string)=>{
    const steps:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
    if(!(event.key in steps))return;event.preventDefault();
    const next=shiftDay(day,steps[event.key]!);if(next>today)return;
    if(next.slice(0,7)<month||next.slice(0,7)>shiftMonth(month,monthCount-1))setMonth(next.slice(0,7));
    pendingFocus.current=true;setFocusDay(next);
  };
  const valid=!!(draft.from&&draft.to&&draft.from<=draft.to&&draft.to<=today);
  return <div ref={root} className="results-date-picker">
    <button ref={trigger} type="button" className={`results-button${comparison&&active?' is-active':''}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={()=>{
      if(open){close();return;}setDraft(value);setChoosingEnd(false);setFocusDay(value.to);setMonth(anchorMonth(value.to));setOpen(true);
    }}>{comparison?<GitCompareArrows size={15}/>:<CalendarDays size={15}/>}<span>{caption??(comparison?(active?`Сравнение: ${rangeCaption(value)}`:'Сравнить периоды'):rangeCaption(value))}</span></button>
    {open&&<div id={id} className="results-calendar" style={position} role="dialog" aria-label={label} data-results-menu onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
      <aside className="results-calendar__presets">{comparison?<>
        <button type="button" onClick={()=>{onPrevious?.();close();}}>Предыдущий период</button>
        <button type="button" onClick={()=>{onClear?.();close();}}>Без сравнения</button>
        <p>Или выберите свои даты в календаре.</p>
      </>:([['today','Сегодня'],['7d','7 дней'],['30d','30 дней'],['month','Этот месяц']] as const).map(([key,name])=><button type="button" key={key} onClick={()=>preset(key)}>{name}</button>)}</aside>
      <div className="results-calendar__main">
        <div className="results-calendar__inputs"><label>Начало<input type="date" aria-label={`${label}: начало`} value={draft.from} max={today} onChange={event=>{setDraft({from:event.target.value,to:draft.to});setChoosingEnd(false);if(event.target.value)setMonth(event.target.value.slice(0,7));}}/></label><span>—</span><label>Конец<input type="date" aria-label={`${label}: конец`} value={draft.to} min={draft.from||undefined} max={today} onChange={event=>{setDraft({from:draft.from,to:event.target.value});setChoosingEnd(false);}}/></label></div>
        <div className="results-calendar__navigation"><button type="button" className="results-icon-button" aria-label="Предыдущий месяц" onClick={()=>{const next=shiftMonth(month,-1);setMonth(next);setFocusDay(`${next}-01`);}}><ChevronLeft size={15}/></button><span>{choosingEnd?'Выберите конец периода':'Выберите начало периода'}</span><button type="button" className="results-icon-button" aria-label="Следующий месяц" disabled={shiftMonth(month,monthCount-1)>=today.slice(0,7)} onClick={()=>{const next=shiftMonth(month,1);setMonth(next);setFocusDay(`${next}-01`);}}><ChevronRight size={15}/></button></div>
        <div className="results-calendar__months">{Array.from({length:monthCount},(_,i)=>shiftMonth(month,i)).map(current=>{
          const first=new Date(`${current}-01T12:00:00Z`),offset=(first.getUTCDay()+6)%7,last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
          return <section key={current} aria-label={first.toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'})}><h3>{first.toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'})}</h3><div className="results-calendar__days">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day=><span key={day}>{day}</span>)}{Array.from({length:offset},(_,i)=><span key={`blank-${i}`}/>)}{Array.from({length:last.getUTCDate()},(_,i)=>{
            const day=`${current}-${String(i+1).padStart(2,'0')}`,edge=day===draft.from||day===draft.to,inRange=!!(draft.from&&draft.to&&day>=draft.from&&day<=draft.to);
            return <button key={day} type="button" data-day={day} aria-label={labelDay(day)} aria-pressed={edge} aria-current={day===today?'date':undefined} disabled={day>today} tabIndex={day===focusDay?0:-1} className={`${edge?'is-edge':''}${inRange?' is-in-range':''}`} onClick={()=>chooseDay(day)} onKeyDown={event=>keyboardDay(event,day)}>{i+1}</button>;
          })}</div></section>;
        })}</div>
        <footer className="results-calendar__footer"><span>{valid?rangeCaption(draft):'Выберите начало и конец периода'}</span><button type="button" className="results-button" onClick={close}>Отмена</button><button type="button" className="results-button is-active" disabled={!valid} onClick={()=>{onChange(draft);close();}}>Применить</button></footer>
      </div>
    </div>}
  </div>;
}
