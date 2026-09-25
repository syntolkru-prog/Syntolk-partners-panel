import Link from "next/link";
import { Shell } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";

export default async function Page(){
  const since=new Date(Date.now()-30*86400000);
  const [clicks,refs,payments,refunds,activePartners,scheduled,saved]=await Promise.all([
    prisma.referralClick.count({where:{createdAt:{gte:since}}}),
    prisma.referral.count({where:{createdAt:{gte:since}}}),
    prisma.payment.findMany({where:{paidAt:{gte:since}},select:{amount:true,subscriptionId:true,referralId:true}}),
    prisma.refund.findMany({where:{refundedAt:{gte:since}},select:{amount:true}}),
    prisma.partner.count({where:{status:"ACTIVE",OR:[{lastActiveAt:{gte:since}},{clicks:{some:{createdAt:{gte:since}}}},{referrals:{some:{createdAt:{gte:since}}}}]}}),
    prisma.scheduledReport.findMany({orderBy:{createdAt:"desc"},take:10}),
    prisma.savedReport.findMany({orderBy:{createdAt:"desc"},take:10})
  ]);
  const revenue=payments.reduce((s,p)=>s+Number(p.amount),0),refundAmount=refunds.reduce((s,r)=>s+Number(r.amount),0);
  const payerCount=new Set(payments.map(p=>p.referralId)).size;const recurring=payments.filter(p=>p.subscriptionId).length;
  return <Shell title="Отчёты и аналитика" subtitle="Performance, cohort-анализ, сохранённые отчёты и расписание отправки." nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="stat-grid"><article><span>Click → signup</span><strong>{clicks?((refs/clicks)*100).toFixed(1):"0.0"}%</strong><small>{refs} регистраций</small></article><article><span>Signup → payer</span><strong>{refs?((payerCount/refs)*100).toFixed(1):"0.0"}%</strong><small>{payerCount} плательщиков</small></article><article><span>Refund rate</span><strong>{revenue?((refundAmount/revenue)*100).toFixed(1):"0.0"}%</strong><small>по сумме</small></article><article><span>Recurring share</span><strong>{payments.length?((recurring/payments.length)*100).toFixed(1):"0.0"}%</strong><small>{recurring} платежей</small></article></section>
    <section className="grid-two"><article className="card"><span className="eyebrow">COHORT</span><h2>Когорты регистраций</h2><p className="muted">API строит месячные когорты по conversion и revenue.</p><Link className="button secondary" href="/api/admin/reports/cohort">Открыть JSON</Link></article><article className="card"><span className="eyebrow">SCHEDULED</span><h2>Отчёты по расписанию</h2><p className="muted">Активных: {scheduled.filter(r=>r.isActive).length}. Сохранённых шаблонов: {saved.length}.</p><div className="settings-list">{scheduled.map(r=><div key={r.id}><span>{r.name}</span><b>{r.frequency} · {r.isActive?"ON":"OFF"}</b></div>)}</div></article></section>
    <section className="card"><div className="section-title"><div><span className="eyebrow">EXPORT</span><h2>Выгрузки</h2></div><span className="muted">{activePartners} активных партнёров за 30 дней</span></div><div className="landing-actions"><Link className="button secondary" href="/api/admin/reports/export?type=partners">Partners CSV</Link><Link className="button secondary" href="/api/admin/reports/export?type=transactions">Transactions CSV</Link><Link className="button secondary" href="/api/admin/reports/export?type=payouts">Payouts CSV</Link></div></section>
  </Shell>
}
