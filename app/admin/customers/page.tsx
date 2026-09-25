import Link from "next/link";
import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";

export default async function Page(){
  const settings=await prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}});
  const customers=await prisma.referral.findMany({include:{partner:true,payments:{include:{commissions:true,refunds:true},orderBy:{paidAt:"desc"}}},orderBy:{createdAt:"desc"},take:300});
  return <Shell title="Клиенты" subtitle="Привлечённые пользователи, подписки, платежи и вклад каждого партнёра." nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="card"><div className="section-title"><div><span className="eyebrow">ATTRIBUTED CUSTOMERS</span><h2>{customers.length} клиентов в выборке</h2></div></div>
    <div className="table-wrap"><table><thead><tr><th>Пользователь</th><th>Партнёр</th><th>Статус</th><th>Платежей</th><th>Выручка</th><th>Комиссия</th></tr></thead><tbody>
      {customers.map(c=>{const revenue=c.payments.reduce((s,p)=>s+Number(p.amount),0);const commission=c.payments.flatMap(p=>p.commissions).reduce((s,x)=>s+Number(x.amount),0);return <tr key={c.id}><td><Link href={`/admin/customers/${c.id}`}><code>{c.externalUserId}</code></Link><small className="block muted">{(c.registeredAt||c.createdAt).toLocaleDateString("ru-RU")}</small></td><td>{c.partner.name}</td><td><span className="status">{c.status}</span></td><td>{c.payments.length}</td><td><Money value={revenue} currency={settings.currency}/></td><td><Money value={commission} currency={settings.currency}/></td></tr>})}
      {!customers.length&&<tr><td colSpan={6} className="muted">Атрибутированных клиентов пока нет.</td></tr>}
    </tbody></table></div></section>
  </Shell>
}
