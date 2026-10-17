import { useQuery } from '@tanstack/react-query';
import { api, currentTenantSlug } from '../../api.js';
import { Button, Card } from '../../ui.js';
import { TenantLink } from '../../tenant-link.js';
import './coach.css';

interface Welcome { enabled:boolean;paused:boolean;needsOnboarding:boolean;takeover:boolean;message:string;task:{title:string}|null }
export function CoachWelcome({partnerId,prefix='/coach/me',onAction}:{partnerId:string;prefix?:string;onAction?:(action:string)=>void}) {
  const query=useQuery({queryKey:['coach',currentTenantSlug(),partnerId,prefix,'welcome'],queryFn:()=>api<Welcome>(`${prefix}/welcome`),staleTime:30000});
  const data=query.data;
  // Optional accompaniment must not block access to the core dashboard.
  if(!data?.enabled)return null;
  return <section className="coach" aria-label="Ваш помощник Syntolk"><Card style={{marginBottom:14}}>
    <h2>Твой помощник Syntolk</h2><p className="coach-pre">{data.message}</p>
    {onAction?<div className="coach-actions"><Button variant={data.paused?'secondary':'primary'} onClick={()=>onAction('plan')}>{data.paused?'Открыть календарь работ':'Перейти к календарю работ'}</Button></div>:<TenantLink to="/plan">Открыть календарь работ →</TenantLink>}
  </Card></section>;
}
