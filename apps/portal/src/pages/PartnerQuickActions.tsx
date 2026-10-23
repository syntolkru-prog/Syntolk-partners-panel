import {ArrowUpRight,CalendarRange,FilePlus2,Link2} from 'lucide-react';
import {TenantLink} from '../tenant-link.js';
import './partner-quick-actions.css';
import {Tooltip} from '../components/tremor/raw/components/Tooltip/Tooltip.js';

const actions=[
  {to:'/calculator?scenarioId=new',icon:CalendarRange,title:'Создать сценарий работ',description:'Составьте план контента и получите задачи в календаре.',kind:'plan'},
  {to:'/links?section=create&view=links&create=partner',icon:Link2,title:'Создать партнёрскую ссылку',description:'Для профиля, закрепа и переписки с будущими клиентами.',kind:'link'},
  {to:'/links?section=create&view=publications&create=publication',icon:FilePlus2,title:'Создать ссылку на публикацию',description:'Для поста, ролика или статьи — с отдельной статистикой.',kind:'publication'},
];
export function PartnerQuickActions({compact=false}:{compact?:boolean}){
  if(compact)return <nav className="ph-actions" aria-label="Быстрый старт партнёра">
    {actions.map(({to,icon:Icon,title,description,kind})=><Tooltip key={kind} content={description} asChild><TenantLink to={to} className="ph-action">
      <span className="ph-action__icon"><Icon size={17} strokeWidth={1.7} aria-hidden="true"/></span>
      <strong>{title}</strong><ArrowUpRight className="ph-action__arrow" size={14} aria-hidden="true"/>
    </TenantLink></Tooltip>)}
  </nav>;
  return <section className="partner-quick-actions" aria-label="Быстрый старт партнёра">
    <div className="partner-quick-actions__intro"><h2>С чего начнём?</h2><p>Работайте по сценарию или сразу создавайте ссылки — калькулятор не обязателен.</p></div>
    <div className="partner-quick-actions__grid">{actions.map(({to,icon:Icon,title,description,kind})=><TenantLink key={kind} to={to} className={`partner-quick-action partner-quick-action--${kind}`}><span className="partner-quick-action__icon"><Icon size={21} strokeWidth={1.7}/></span><ArrowUpRight className="partner-quick-action__arrow" size={17}/><strong>{title}</strong><span className="partner-quick-action__description">{description}</span></TenantLink>)}</div>
  </section>;
}
