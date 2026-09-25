import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

async function mature(){
  "use server";
  const session=await currentSession();if(session?.role!=="ADMIN")redirect("/login");
  const now=new Date();
  await prisma.commission.updateMany({where:{status:"PENDING",availableAt:{lte:now}},data:{status:"APPROVED",approvedAt:now}});
  revalidatePath("/admin/commissions");
}

export default async function Page(){
  const settings=await prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}});
  const [pending,approved,paid,refunds,rules,recent]=await Promise.all([
    prisma.commission.aggregate({where:{status:"PENDING"},_sum:{amount:true},_count:true}),
    prisma.commission.aggregate({where:{status:"APPROVED"},_sum:{amount:true},_count:true}),
    prisma.commission.aggregate({where:{status:"PAID"},_sum:{amount:true},_count:true}),
    prisma.commission.aggregate({where:{kind:"REFUND"},_sum:{amount:true},_count:true}),
    prisma.commissionRule.findMany({where:{isActive:true},orderBy:[{priority:"desc"},{createdAt:"asc"}]}),
    prisma.commission.findMany({take:100,orderBy:{createdAt:"desc"},include:{partner:true,payment:true,commissionRule:true}})
  ]);
  return <Shell title="Начисления" subtitle="Ledger комиссий: earnings, refund-корректировки, холд и ручные adjustments." nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="stat-grid"><article><span>Pending</span><strong><Money value={Number(pending._sum.amount||0)} currency={settings.currency}/></strong><small>{pending._count} записей</small></article><article><span>Approved</span><strong><Money value={Number(approved._sum.amount||0)} currency={settings.currency}/></strong><small>{approved._count} записей</small></article><article><span>Paid</span><strong><Money value={Number(paid._sum.amount||0)} currency={settings.currency}/></strong><small>{paid._count} записей</small></article><article><span>Refund adjustments</span><strong className="negative"><Money value={Number(refunds._sum.amount||0)} currency={settings.currency}/></strong><small>{refunds._count} корректировок</small></article></section>
    <section className="grid-two"><article className="card"><span className="eyebrow">ПРАВИЛА</span><h2>Commission rules</h2><div className="settings-list">{rules.map(r=><div key={r.id}><span>{r.name}</span><b>{r.type==="PERCENTAGE"?`${Number(r.value)}%`:`${Number(r.value).toLocaleString("ru-RU")} ₽`} · priority {r.priority}</b></div>)}{!rules.length&&<p className="muted">Активных правил нет — используется ставка партнёра/группы/программы.</p>}</div></article><article className="card"><span className="eyebrow">ХОЛД</span><h2>Созревание комиссий</h2><p className="muted">PENDING-записи с истёкшим availableAt переводятся в APPROVED.</p><form action={mature}><button className="button primary" type="submit">Проверить созревшие</button></form></article></section>
    <section className="card"><div className="table-wrap"><table><thead><tr><th>Дата</th><th>Партнёр</th><th>Тип</th><th>Сумма</th><th>Ставка</th><th>Правило</th><th>Статус</th></tr></thead><tbody>{recent.map(c=><tr key={c.id}><td>{c.createdAt.toLocaleDateString("ru-RU")}</td><td>{c.partner.name}</td><td>{c.kind}</td><td className={Number(c.amount)<0?"negative":"positive"}><Money value={Number(c.amount)} currency={settings.currency}/></td><td>{Number(c.rate).toFixed(2).replace(".00","")}%</td><td>{c.commissionRule?.name||c.note||"—"}</td><td><span className="status">{c.status}</span></td></tr>)}</tbody></table></div></section>
  </Shell>
}
