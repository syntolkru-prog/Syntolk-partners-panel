import { useLayoutEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface SelectOption { id: string; name: string; archived?: boolean }
interface Props {
  label: string;
  ariaLabel?: string;
  allLabel: string;
  options: SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  allowEmpty?: boolean;
  allValues?: string[];
}

export function ResultsMultiSelect({ label, ariaLabel=label, allLabel, options, value, onChange, allowEmpty=true, allValues=[] }: Props) {
  const [open,setOpen]=useState(false),[draft,setDraft]=useState(value),[search,setSearch]=useState('');
  const [position,setPosition]=useState<CSSProperties>({});
  const trigger=useRef<HTMLButtonElement>(null),popup=useRef<HTMLDivElement>(null),id=useId();
  const selected=options.filter(option=>value.includes(option.id));
  const caption=!value.length?allLabel:value.length===1?selected[0]?.name??'Выбран 1 вариант':`Выбрано: ${value.length}`;
  const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus({preventScroll:true});};
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const anchor=trigger.current?.getBoundingClientRect();if(!anchor)return;
      const width=Math.min(Math.max(250,anchor.width),document.documentElement.clientWidth-24);
      const below=window.innerHeight-anchor.bottom-18,above=anchor.top-18,useBelow=below>=Math.min(280,above);
      setPosition({left:Math.max(12,Math.min(anchor.left,document.documentElement.clientWidth-width-12)),width,maxHeight:Math.max(120,Math.min(360,useBelow?below:above)),...(useBelow?{top:anchor.bottom+6}:{bottom:window.innerHeight-anchor.top+6})});
    };
    const outside=(event:PointerEvent)=>{if(!popup.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))close();};
    const scroll=(event:Event)=>{if(!popup.current?.contains(event.target as Node))place();};
    place();popup.current?.querySelector<HTMLElement>('input,button')?.focus({preventScroll:true});
    document.addEventListener('pointerdown',outside);window.addEventListener('resize',place);document.addEventListener('scroll',scroll,true);
    return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',place);document.removeEventListener('scroll',scroll,true);};
  },[open]);
  const toggle=(optionId:string)=>setDraft(previous=>previous.includes(optionId)?previous.filter(item=>item!==optionId):[...previous,optionId]);
  const filtered=options.filter(option=>option.name.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));
  const choice=(option:SelectOption)=><label className="results-multiselect__option" key={option.id}><input type="checkbox" checked={draft.includes(option.id)} onChange={()=>toggle(option.id)}/><span>{option.name}</span></label>;
  return <div className="coach-field results-multiselect"><span>{label}</span>
    <button ref={trigger} type="button" className="results-multiselect__trigger" aria-label={ariaLabel} title={selected.map(option=>option.name).join(', ')||allLabel} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={()=>{if(open)close();else{setDraft(value);setSearch('');setOpen(true);}}}><span>{caption}</span><ChevronDown size={14} aria-hidden="true"/></button>
    {open&&createPortal(<div ref={popup} id={id} role="dialog" aria-label={label} data-results-menu className="results-menu results-multiselect__popup" style={position}
      onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node)&&event.relatedTarget!==trigger.current)close();}}
      onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}}}>
      {options.length>6&&<label className="results-multiselect__search"><Search size={14} aria-hidden="true"/><input aria-label={`Поиск: ${label.toLocaleLowerCase('ru-RU')}`} value={search} onChange={event=>setSearch(event.target.value)} placeholder="Найти…"/></label>}
      <div className="results-multiselect__options">
        <button type="button" className="results-multiselect__all" onClick={()=>setDraft(allValues)}>{draft.length===allValues.length&&draft.every(item=>allValues.includes(item))?<Check size={14} aria-hidden="true"/>:<span/>}{allLabel}</button>
        {filtered.filter(option=>!option.archived).map(choice)}
        {filtered.some(option=>option.archived)&&<details className="results-multiselect__archive"><summary>Архив{draft.filter(item=>options.find(option=>option.id===item)?.archived).length>0&&' · есть выбранные'}</summary>{filtered.filter(option=>option.archived).map(choice)}</details>}
        {!filtered.length&&<p className="results-multiselect__empty">Ничего не найдено</p>}
      </div>
      <div className="results-multiselect__actions"><button type="button" onClick={()=>close(true)}>Отмена</button><button type="button" disabled={!allowEmpty&&!draft.length} onClick={()=>{onChange(draft);close(true);}}>Применить</button></div>
    </div>,document.body)}
  </div>;
}
