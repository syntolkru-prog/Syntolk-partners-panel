import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { partnerNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

async function markAllRead(){
  "use server";
  const session=await currentSession();if(!session?.partnerId)redirect("/login");
  await prisma.notification.updateMany({where:{partnerId:session.partnerId,readAt:null},data:{readAt:new Date()}});
  revalidatePath("/partner/notifications");
}

export default async function Page(){
  const session=await currentSession();if(!session?.partnerId)redirect("/login");
  const rows=await prisma.notification.findMany({where:{partnerId:session.partnerId},orderBy:{createdAt:"desc"},take:100});
  const unread=rows.filter(r=>!r.readAt).length;
  return <Shell title="Уведомления" subtitle="Начисления, возвраты, созревание комиссий и выплаты." nav={partnerNav} role="ПАРТНЁР">
    <section className="card"><div className="section-title"><div><span className="eyebrow">EVENTS</span><h2>{unread} непрочитанных</h2></div>{unread>0&&<form action={markAllRead}><button className="button secondary" type="submit">Отметить всё прочитанным</button></form>}</div>
      <div className="notification-list">{rows.map(r=><article className="notification-row" key={r.id}><small>{r.createdAt.toLocaleString("ru-RU")}</small><b>{r.title}{!r.readAt?" · NEW":""}</b><span>{r.message}</span></article>)}{!rows.length&&<p className="muted">Уведомлений пока нет.</p>}</div>
    </section>
  </Shell>
}
