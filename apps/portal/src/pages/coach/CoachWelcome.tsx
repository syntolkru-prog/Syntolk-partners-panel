import { useQuery } from '@tanstack/react-query';
import { api, currentTenantSlug } from '../../api.js';
import { Button, Card } from '../../ui.js';
import { TenantLink } from '../../tenant-link.js';
import './coach.css';

interface Welcome { enabled:boolean;paused:boolean;needsOnboarding:boolean;takeover:boolean;message:string;task:{title:string;minutes:number}|null }
export function CoachWelcome({partnerId,prefix='/coach/me',onAction}:{partnerId:string;prefix?:string;onAction?:(action:string,minutes?:number)=>void}) {
  const query=useQuery({queryKey:['coach',currentTenantSlug(),partnerId,prefix,'welcome'],queryFn:()=>api<Welcome>(`${prefix}/welcome`),staleTime:30000});
  const data=query.data;
  // Optional accompaniment must not block access to the core dashboard.
  if(!data?.enabled)return null;
  return <section className="coach" aria-label="Ваш помощник Syntolk"><Card style={{marginBottom:14}}>
    <h2>Твой помощник Syntolk</h2><p className="coach-pre">{data.message}</p>
    {onAction?<div className="coach-actions">
      {data.needsOnboarding?<Button onClick={()=>onAction('profile')}>Давай познакомимся</Button>:data.paused?<Button variant="secondary" onClick={()=>onAction('profile')}>Настройки сопровождения</Button>:<>
        <Button onClick={()=>onAction('chat')}>{data.takeover?'Написать менеджеру':'Продолжить вместе'}</Button>
        {!data.takeover&&[20,30,60].map(minutes=><Button key={minutes} variant="secondary" onClick={()=>onAction('chat',minutes)}>У меня {minutes} минут</Button>)}
      </>}
    </div>:<TenantLink to="/coach">{data.needsOnboarding?'Познакомиться с помощником':data.paused?'Открыть настройки сопровождения':'Продолжить с помощником →'}</TenantLink>}
  </Card></section>;
}
