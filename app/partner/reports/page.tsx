import { redirect } from "next/navigation";
import { Shell, Money } from "@/components/shell";
import { partnerNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

export default async function Page(){
  const session=await currentSession();if(!session?.partnerId)redirect("/login");
  const partnerId=session.partnerId;const since=new Date(Date.now()-30*86400000);
  const settings=await prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}});
  const [clicks,refs,payments,commissions]=await Promise.all([
    prisma.referralClick.findMany({where:{partnerId,createdAt:{gte:since}},select:{source:true}}),
    prisma.referral.findMany({where:{partnerId,createdAt:{gte:since}},select:{id:true}}),
    prisma.payment.findMany({where:{referral:{partnerId},paidAt:{gte:since}},select:{amount:true,subscriptionId:true,referralId:true}}),
    prisma.commission.findMany({where:{partnerId,createdAt:{gte:since}},select:{amount:true}})
  ]);
  const revenue=payments.reduce((s,p)=>s+Number(p.amount),0);const earning=commissions.reduce((s,c)=>s+Number(c.amount),0);
  const payers=new Set(payments.map(p=>p.referralId)).size;const recurring=payments.filter(p=>p.subscriptionId).length;
  const sourceCounts=new Map<string,number>();for(const c of clicks){const k=c.source||"direct";sourceCounts.set(k,(sourceCounts.get(k)||0)+1);}
  const sources=[...sourceCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  return <Shell title="Аналитика" subtitle="Ваша воронка, продажи, recurring и заработок за последние 30 дней." nav={partnerNav} role="ПАРТНЁР">
    <section className="stat-grid"><article><span>Переходы</span><strong>{clicks.length}</strong><small>30 дней</small></article><article><span>Регистрации</span><strong>{refs.length}</strong><small>{clicks.length?((refs.length/clicks.length)*100).toFixed(1):"0.0"}% click → signup</small></article><article><span>Плательщики</span><strong>{payers}</strong><small>{refs.length?((payers/refs.length)*100).toFixed(1):"0.0"}% signup → pay</small></article><article><span>Заработок</span><strong><Money value={earning} currency={settings.currency}/></strong><small>с выручки <Money value={revenue} currency={settings.currency}/></small></article></section>
    <section className="grid-two"><article className="card"><span className="eyebrow">RECURRING</span><h2>Повторные оплаты</h2><div className="payout-box"><strong>{recurring}</strong><span>платежей с SubscriptionId</span></div></article><article className="card"><span className="eyebrow">SOURCE</span><h2>Источники переходов</h2><div className="settings-list">{sources.map(([name,count])=><div key={name}><span>{name}</span><b>{clicks.length?((count/clicks.length)*100).toFixed(1):"0"}%</b></div>)}{!sources.length&&<p className="muted">Переходов за период нет.</p>}</div></article></section>
  </Shell>
}
