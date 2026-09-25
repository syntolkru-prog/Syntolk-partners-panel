import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

async function createProgram(formData:FormData){
  "use server";
  const s=await currentSession();if(s?.role!=="ADMIN")redirect("/login");
  const name=String(formData.get("name")||"").trim();const slug=String(formData.get("slug")||"").trim().toLowerCase();
  if(!name||!slug)return;
  await prisma.program.create({data:{name,slug,commissionRate:Number(formData.get("commissionRate")||20),cookieDays:Number(formData.get("cookieDays")||60),currency:String(formData.get("currency")||"RUB"),requireApproval:true}});
  revalidatePath("/admin/programs");
}
async function createGroup(formData:FormData){
  "use server";
  const s=await currentSession();if(s?.role!=="ADMIN")redirect("/login");
  const name=String(formData.get("name")||"").trim();if(!name)return;
  await prisma.partnerGroup.create({data:{name,commissionRate:Number(formData.get("commissionRate")||20),cookieDays:Number(formData.get("cookieDays")||60)}});
  revalidatePath("/admin/programs");
}

export default async function Page(){
  const [programs,groups,rules]=await Promise.all([
    prisma.program.findMany({include:{_count:{select:{partners:true,groups:true}}},orderBy:[{isDefault:"desc"},{createdAt:"desc"}]}),
    prisma.partnerGroup.findMany({include:{_count:{select:{partners:true}}},orderBy:[{isDefault:"desc"},{name:"asc"}]}),
    prisma.commissionRule.findMany({include:{program:true},orderBy:[{priority:"desc"},{createdAt:"desc"}]})
  ]);
  return <Shell title="Программы" subtitle="Партнёрские программы, группы и правила комиссий." nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="card"><div className="section-title"><div><span className="eyebrow">PROGRAMS</span><h2>Партнёрские программы</h2></div></div>
      <form action={createProgram} className="inline-form"><input className="input" name="name" placeholder="Название"/><input className="input" name="slug" placeholder="slug"/><input className="input mini-input" name="commissionRate" type="number" step="0.01" defaultValue="20"/><input className="input mini-input" name="cookieDays" type="number" defaultValue="60"/><button className="button primary" type="submit">+ Программа</button></form>
      <div className="table-wrap"><table><thead><tr><th>Название</th><th>Комиссия</th><th>Cookie</th><th>Валюта</th><th>Партнёров</th><th>Статус</th></tr></thead><tbody>{programs.map(p=><tr key={p.id}><td><b>{p.name}</b><small className="block muted">{p.slug}</small></td><td>{Number(p.commissionRate)}%</td><td>{p.cookieDays} дней</td><td>{p.currency}</td><td>{p._count.partners}</td><td><span className="status">{p.isActive?"ACTIVE":"INACTIVE"}</span></td></tr>)}{!programs.length&&<tr><td colSpan={6} className="muted">Программ пока нет.</td></tr>}</tbody></table></div>
    </section>
    <section className="grid-two">
      <article className="card"><span className="eyebrow">ГРУППЫ</span><h2>Partner groups</h2><form action={createGroup} className="inline-form"><input className="input" name="name" placeholder="Новая группа"/><input className="input mini-input" name="commissionRate" type="number" step="0.01" defaultValue="20"/><input className="input mini-input" name="cookieDays" type="number" defaultValue="60"/><button className="button primary" type="submit">Добавить</button></form><div className="settings-list">{groups.map(g=><div key={g.id}><span>{g.name} <small className="muted">({g._count.partners})</small></span><b>{Number(g.commissionRate)}% · {g.cookieDays} дней</b></div>)}</div></article>
      <article className="card"><span className="eyebrow">ПРАВИЛА</span><h2>Commission rules</h2><div className="settings-list">{rules.map(r=><div key={r.id}><span>{r.name}<small className="block muted">{r.program?.name||"Все программы"}</small></span><b>{r.type==="PERCENTAGE"?`${Number(r.value)}%`:`${Number(r.value)} фикс.`} · p{r.priority}</b></div>)}{!rules.length&&<p className="muted">Специальных правил нет.</p>}</div></article>
    </section>
  </Shell>
}
