import Link from "next/link";
import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";

export default async function Page(){
  const since=new Date(Date.now()-30*86400000);
  const settings=await prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}});
  const [payments,refunds]=await Promise.all([
    prisma.payment.findMany({where:{paidAt:{gte:since}},include:{referral:{include:{partner:true}},commissions:true,refunds:true},orderBy:{paidAt:"desc"},take:200}),
    prisma.refund.findMany({where:{refundedAt:{gte:since}},select:{amount:true}})
  ]);
  const revenue=payments.reduce((s,p)=>s+Number(p.amount),0);
  const refundAmount=refunds.reduce((s,r)=>s+Number(r.amount),0);
  const recurring=payments.filter(p=>p.subscriptionId).length;
  return <Shell title="Транзакции" subtitle="Все платежи CloudPayments, подписки, возвраты и связанные комиссии." nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="stat-grid">
      <article><span>Платежей за 30 дней</span><strong>{payments.length}</strong><small>включая recurring</small></article>
      <article><span>Выручка</span><strong><Money value={revenue} currency={settings.currency}/></strong><small>партнёрский канал</small></article>
      <article><span>Возвраты</span><strong><Money value={refundAmount} currency={settings.currency}/></strong><small>{revenue?((refundAmount/revenue)*100).toFixed(1):"0.0"}% выручки</small></article>
      <article><span>Recurring</span><strong>{recurring}</strong><small>платежей с SubscriptionId</small></article>
    </section>
    <section className="card">
      <div className="section-title"><div><span className="eyebrow">CLOUDPAYMENTS</span><h2>Последние операции</h2></div><Link className="button secondary" href="/api/admin/reports/export?type=transactions">Экспорт CSV</Link></div>
      <div className="table-wrap"><table><thead><tr><th>Transaction ID</th><th>Партнёр</th><th>Сумма</th><th>Комиссия</th><th>Возврат</th><th>Статус</th></tr></thead><tbody>
        {payments.map(p=><tr key={p.id}><td><code>{p.externalTransactionId}</code><small className="block muted">{p.paidAt.toLocaleString("ru-RU")}</small></td><td>{p.referral.partner.name}</td><td><Money value={Number(p.amount)} currency={p.currency}/></td><td><Money value={p.commissions.reduce((s,c)=>s+Number(c.amount),0)} currency={settings.currency}/></td><td><Money value={p.refunds.reduce((s,r)=>s+Number(r.amount),0)} currency={p.currency}/></td><td><span className="status">{p.status}</span></td></tr>)}
        {!payments.length&&<tr><td colSpan={6} className="muted">Операций за период нет.</td></tr>}
      </tbody></table></div>
    </section>
  </Shell>
}
