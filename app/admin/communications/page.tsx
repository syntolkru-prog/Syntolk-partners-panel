import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";
import { sendTemplatedEmail } from "@/lib/email";

async function testEmail(formData:FormData){
  "use server";
  const s=await currentSession();if(s?.role!=="ADMIN")redirect("/login");
  const to=String(formData.get("to")||"").trim();
  if(!to)return;
  await sendTemplatedEmail({type:"WELCOME",to,variables:{name:"Тестовый партнёр",code:"123456"},fallbackSubject:"Тест Syntolk Partners",fallbackBody:"<h2>Тестовое письмо Syntolk Partners</h2>"});
}

export default async function Page(){
  const today=new Date();today.setHours(0,0,0,0);
  const [templates,logs,sentToday,failedToday]=await Promise.all([
    prisma.emailTemplate.findMany({orderBy:{createdAt:"desc"}}),
    prisma.emailLog.findMany({orderBy:{createdAt:"desc"},take:30}),
    prisma.emailLog.count({where:{status:"SENT",createdAt:{gte:today}}}),
    prisma.emailLog.count({where:{status:"FAILED",createdAt:{gte:today}}})
  ]);
  return <Shell title="Коммуникации" subtitle="Email-шаблоны, история отправки и уведомления партнёров." nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="grid-two"><article className="card"><span className="eyebrow">EMAIL TEMPLATES</span><h2>{templates.length} шаблонов</h2><div className="settings-list">{templates.map(t=><div key={t.id}><span>{t.name}<small className="block muted">{t.type}</small></span><b>{t.isActive?"Активен":"Выключен"}</b></div>)}{!templates.length&&<p className="muted">Шаблоны не созданы.</p>}</div></article>
    <article className="card"><span className="eyebrow">DELIVERY</span><h2>Email logs</h2><div className="metrics-list"><div><span>Отправлено сегодня</span><b>{sentToday}</b></div><div><span>Ошибок сегодня</span><b>{failedToday}</b></div><div><span>Provider</span><b>Resend</b></div></div><form action={testEmail} className="inline-form"><input className="input" name="to" type="email" placeholder="Тестовый email"/><button className="button secondary" type="submit">Отправить тест</button></form></article></section>
    <section className="card"><div className="table-wrap"><table><thead><tr><th>Дата</th><th>Получатель</th><th>Тема</th><th>Статус</th><th>Ошибка</th></tr></thead><tbody>{logs.map(l=><tr key={l.id}><td>{l.createdAt.toLocaleString("ru-RU")}</td><td>{l.recipientEmail}</td><td>{l.subject}</td><td><span className="status">{l.status}</span></td><td>{l.error||"—"}</td></tr>)}{!logs.length&&<tr><td colSpan={5} className="muted">Писем ещё не отправлялось.</td></tr>}</tbody></table></div></section>
  </Shell>
}
