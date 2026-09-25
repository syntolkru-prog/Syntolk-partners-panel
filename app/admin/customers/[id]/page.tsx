import { notFound } from "next/navigation";
import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";

export default async function Page({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const [customer,settings]=await Promise.all([
    prisma.referral.findUnique({where:{id},include:{partner:{include:{group:true,program:true}},payments:{include:{commissions:true,refunds:true},orderBy:{paidAt:"desc"}}}}),
    prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}})
  ]);
  if(!customer)notFound();
  const revenue=customer.payments.reduce((s,p)=>s+Number(p.amount),0);
  const refunds=customer.payments.flatMap(p=>p.refunds).reduce((s,r)=>s+Number(r.amount),0);
  const commission=customer.payments.flatMap(p=>p.commissions).reduce((s,c)=>s+Number(c.amount),0);
  return <Shell title="Карточка клиента" subtitle={customer.externalUserId} nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="stat-grid"><article><span>Партнёр</span><strong>{customer.partner.name}</strong><small>{customer.partner.code}</small></article><article><span>Платежей</span><strong>{customer.payments.length}</strong><small>{customer.status}</small></article><article><span>Выручка</span><strong><Money value={revenue} currency={settings.currency}/></strong><small>до возвратов</small></article><article><span>Комиссия</span><strong><Money value={commission} currency={settings.currency}/></strong><small>refunds: <Money value={refunds} currency={settings.currency}/></small></article></section>
    <section className="card"><div className="table-wrap"><table><thead><tr><th>Дата</th><th>Transaction</th><th>Сумма</th><th>Статус</th><th>Комиссия</th><th>Возврат</th></tr></thead><tbody>{customer.payments.map(p=><tr key={p.id}><td>{p.paidAt.toLocaleString("ru-RU")}</td><td><code>{p.externalTransactionId}</code></td><td><Money value={Number(p.amount)} currency={p.currency}/></td><td><span className="status">{p.status}</span></td><td><Money value={p.commissions.reduce((s,c)=>s+Number(c.amount),0)} currency={settings.currency}/></td><td><Money value={p.refunds.reduce((s,r)=>s+Number(r.amount),0)} currency={p.currency}/></td></tr>)}</tbody></table></div></section>
  </Shell>
}
