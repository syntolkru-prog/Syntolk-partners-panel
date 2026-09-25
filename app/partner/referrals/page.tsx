import { redirect } from "next/navigation";
import { Shell, Money } from "@/components/shell";
import { partnerNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

function mask(value:string){
  if(value.includes("@")){const [l,d]=value.split("@");return `${l.slice(0,2)}***@${d}`;}
  return value.length>8?`${value.slice(0,3)}***${value.slice(-3)}`:"***";
}

export default async function PartnerReferralsPage() {
  const session=await currentSession(); if(!session?.partnerId) redirect("/login");
  const settings=await prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}});
  const referrals=await prisma.referral.findMany({
    where:{partnerId:session.partnerId},
    include:{payments:{include:{commissions:true},orderBy:{paidAt:"desc"}}},
    orderBy:{createdAt:"desc"}
  });
  const paid=referrals.filter(r=>r.payments.length>0);
  const active=referrals.filter(r=>r.status==="ACTIVE").length;
  const paymentCount=referrals.reduce((s,r)=>s+r.payments.length,0);
  const recurring=Math.max(0,paymentCount-paid.length);
  const earned=referrals.flatMap(r=>r.payments).flatMap(p=>p.commissions).reduce((s,c)=>s+Number(c.amount),0);

  return <Shell title="Мои клиенты" subtitle="Клиенты, закреплённые за вашей партнёрской ссылкой." nav={partnerNav} role="ПАРТНЁР">
    <section className="stat-grid">
      <article><span>Всего клиентов</span><strong>{referrals.length}</strong><small>за всё время</small></article>
      <article><span>Активные</span><strong>{active}</strong><small>{referrals.length?((active/referrals.length)*100).toFixed(1):"0.0"}%</small></article>
      <article><span>Повторные оплаты</span><strong>{recurring}</strong><small>после первой оплаты</small></article>
      <article><span>Ваш доход</span><strong><Money value={earned} currency={settings.currency}/></strong><small>ledger total</small></article>
    </section>
    <section className="card">
      <div className="section-title"><div><span className="eyebrow">КЛИЕНТЫ</span><h2>История привлечений</h2></div></div>
      <div className="table-wrap"><table><thead><tr><th>Клиент</th><th>Регистрация</th><th>Статус</th><th>Платежей</th><th>Оплатил</th><th>Ваш доход</th></tr></thead><tbody>
        {referrals.map(r=>{
          const revenue=r.payments.reduce((s,p)=>s+Number(p.amount),0);
          const commission=r.payments.flatMap(p=>p.commissions).reduce((s,c)=>s+Number(c.amount),0);
          return <tr key={r.id}><td><b>{settings.hideCustomerEmails?mask(r.externalUserId):r.externalUserId}</b><small className="block muted">{r.campaign||r.source||"direct"}</small></td><td>{(r.registeredAt||r.createdAt).toLocaleDateString("ru-RU")}</td><td><span className="status">{r.status}</span></td><td>{r.payments.length}</td><td><Money value={revenue} currency={settings.currency}/></td><td className={commission<0?"negative":"positive"}><b><Money value={commission} currency={settings.currency}/></b></td></tr>
        })}
        {!referrals.length&&<tr><td colSpan={6} className="muted">Привлечённых клиентов пока нет.</td></tr>}
      </tbody></table></div>
    </section>
  </Shell>
}
