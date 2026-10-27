import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {useInfiniteQuery} from '@tanstack/react-query';
import {X} from 'lucide-react';
import {api,currentTenantSlug} from '../api.js';
import {Button,ErrorBanner} from '../ui.js';
import {rangeCaption,type DateChoice} from './ResultsDatePicker.js';
import {WorkdayRegistrationTable} from './PartnerWorkdayPanels.js';
import type {RegistrationPage} from './partner-workday-data.js';

export function WorkdayRegistrationsDialog({partnerId,query,range,onClose}:{partnerId:string;query:string;range:DateChoice;onClose:()=>void}){
  const root=useRef<HTMLDialogElement>(null);
  const result=useInfiniteQuery({queryKey:['home-registrations',currentTenantSlug(),partnerId,query],initialPageParam:'',
    queryFn:({pageParam})=>api<RegistrationPage>(`/partners/${partnerId}/analytics/registrations?${query}&limit=50${pageParam?`&cursor=${encodeURIComponent(pageParam)}`:''}`),
    getNextPageParam:page=>page.nextCursor??undefined});
  useEffect(()=>{root.current?.showModal();},[]);
  useEffect(()=>{const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=overflow;};},[]);
  const rows=result.data?.pages.flatMap(page=>page.registrations)??[],first=result.data?.pages[0];
  return createPortal(<dialog ref={root} className="partner-workday wd-registration-dialog" aria-label="Регистрации за период" onCancel={event=>{event.preventDefault();onClose();}}>
    <header className="wd-card-heading"><div><h2>Регистрации за период{first?` · ${first.total}`:''}</h2><p>{rangeCaption(range)}</p></div><button className="wd-link-button" type="button" aria-label="Закрыть регистрации" onClick={onClose}><X size={18}/></button></header>
    <div className="wd-registration-dialog-body" role="region" aria-label="Список регистраций" tabIndex={0}><ErrorBanner error={result.error}/><WorkdayRegistrationTable rows={rows} loading={result.isLoading} error={!rows.length?result.error:undefined} timezone={first?.timezone??'Europe/Moscow'}/>
      <footer><span>{first?`Показано ${rows.length} из ${first.total}`:''}</span>{result.hasNextPage&&<Button variant="secondary" disabled={result.isFetchingNextPage} onClick={()=>{void result.fetchNextPage();}}>{result.isFetchingNextPage?'Загрузка…':'Показать ещё'}</Button>}</footer>
    </div>
  </dialog>,document.body);
}
