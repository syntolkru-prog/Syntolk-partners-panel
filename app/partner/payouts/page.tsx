import { redirect } from "next/navigation";
import { Shell, Money } from "@/components/shell";
import { partnerNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

export default async function PartnerPayoutsPage() {
  const session=await currentSession();if(!session?.partnerId)redirect("/login");
  const partnerId=session.partnerId;
  const settings=await prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}});
  const [approved,pending,payouts]=await Promise.all([
    prisma.commission.aggregate({where:{partnerId,status:"APPROVED",payoutItems:{none:{}}},_sum:{amount:true}}),
    prisma.commission.aggregate({where:{partnerId,status:"PENDING"},_sum:{amount:true}}),
    prisma.payout.findMany({where:{partnerId},include:{items:true,invoices:true},orderBy:{createdAt:"desc"}}),
  ]);
  const available=Number(approved._sum.amount||0), pendingAmount=Number(pending._sum.amount||0);
  const paid=payouts.filter(p=>p.status==="PAID").reduce((s,p)=>s+Number(p.amount),0);
  const minimum=Number(settings.minimumPayoutAmount);

  return <Shell title="Выплаты" subtitle="Баланс, готовые суммы и история ручных выплат." nav={partnerNav} role="ПАРТНЁР">
    <section className="hero-panel"><div><span className="muted">Доступно к выплате</span><strong className="hero-money"><Money value={available} currency={settings.currency}/></strong><span className={available>=minimum?"positive":"muted"}>{available>=minimum?"Минимальная сумма достигнута":`До минимума ещё ${Math.max(0,minimum-available).toLocaleString("ru-RU")} ₽`}</span></div><div className="hero-meta"><span>Ожидает холда <b><Money value={pendingAmount} currency={settings.currency}/></b></span><span>Выплачено <b><Money value={paid} currency={settings.currency}/></b></span></div></section>
    <section className="card">
      <div className="section-title"><div><span className="eyebrow">ИСТОРИЯ</span><h2>Выплаты</h2></div></div>
      <div className="table-wrap"><table><thead><tr><th>Дата</th><th>Сумма</th><th>Начислений</th><th>Способ</th><th>Статус</th><th>Reference</th></tr></thead><tbody>
        {payouts.map(p=><tr key={p.id}><td>{(p.paidAt||p.preparedAt||p.createdAt).toLocaleDateString("ru-RU")}</td><td><b><Money value={Number(p.amount)} currency={settings.currency}/></b></td><td>{p.items.length}</td><td>{p.method||"MANUAL"}</td><td><span className="status">{p.status}</span></td><td>{p.reference||"—"}</td></tr>)}
        {!payouts.length&&<tr><td colSpan={6} className="muted">Выплат пока нет.</td></tr>}
      </tbody></table></div>
    </section>
    <section className="card"><span className="eyebrow">ПРАВИЛА</span><h2>Как формируется баланс</h2><p className="muted">Каждая успешная оплата создаёт отдельное начисление. После {settings.commissionHoldDays} дней оно становится доступным. Минимальная сумма ручной выплаты — <Money value={minimum} currency={settings.currency}/>. Возвраты отображаются отдельной отрицательной строкой и уменьшают следующий баланс.</p></section>
  </Shell>
}
