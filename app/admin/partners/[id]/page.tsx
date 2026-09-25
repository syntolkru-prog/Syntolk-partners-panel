import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";

export default async function Page({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  return <Shell title="Карточка партнёра" subtitle={`Partner ID: ${id}`} nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="hero-panel"><div><span className="muted">Иван Петров</span><strong className="hero-money">20%</strong><span className="positive">Активен</span></div><div className="hero-meta"><span>К выплате <b><Money value={48820}/></b></span><span>Принёс Syntolk <b><Money value={2493820}/></b></span></div></section>
    <section className="stat-grid"><article><span>Переходы</span><strong>18 492</strong><small>всё время</small></article><article><span>Клиенты</span><strong>219</strong><small>атрибутированы</small></article><article><span>Recurring payments</span><strong>487</strong><small>повторные</small></article><article><span>Refund rate</span><strong>1,4%</strong><small>по сумме</small></article></section>
    <section className="grid-two"><article className="card"><span className="eyebrow">УСЛОВИЯ</span><h2>Настройки партнёра</h2><div className="settings-list"><div><span>Группа</span><b>Блогеры</b></div><div><span>Комиссия</span><b>20%</b></div><div><span>Cookie</span><b>60 дней</b></div><div><span>Referral code</span><b>ivan</b></div></div></article><article className="card"><span className="eyebrow">ДЕЙСТВИЯ</span><h2>Управление</h2><div className="landing-actions"><button className="button secondary">Изменить условия</button><button className="button secondary">Приостановить</button><button className="button primary">Создать выплату</button></div></article></section>
  </Shell>
}
