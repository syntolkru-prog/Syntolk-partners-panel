import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

async function invite(formData:FormData){
  "use server";
  const s=await currentSession();if(s?.role!=="ADMIN")redirect("/login");
  const email=String(formData.get("email")||"").trim().toLowerCase();
  const name=String(formData.get("name")||"").trim();
  const role=String(formData.get("role")||"VIEWER") as any;
  if(!email||!name)return;
  await prisma.teamMember.upsert({
    where:{email},
    create:{email,name,role,permissions:[],invitedBy:s.accountId},
    update:{name,role,status:"PENDING",invitedBy:s.accountId,invitedAt:new Date()}
  });
  revalidatePath("/admin/team");
}
async function remove(formData:FormData){
  "use server";
  const s=await currentSession();if(s?.role!=="ADMIN")redirect("/login");
  const id=String(formData.get("id")||"");if(id)await prisma.teamMember.delete({where:{id}});
  revalidatePath("/admin/team");
}

export default async function Page(){
  const team=await prisma.teamMember.findMany({orderBy:{createdAt:"desc"}});
  return <Shell title="Команда" subtitle="Роли и granular permissions для сотрудников, которые работают с партнёркой." nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="card"><div className="section-title"><div><span className="eyebrow">TEAM</span><h2>{team.length} участников</h2></div></div>
      <form action={invite} className="inline-form"><input className="input" name="name" placeholder="Имя"/><input className="input" name="email" type="email" placeholder="email"/><select className="input mini-input" name="role" defaultValue="VIEWER"><option>OWNER</option><option>ADMIN</option><option>MANAGER</option><option>VIEWER</option></select><button className="button primary" type="submit">+ Пригласить</button></form>
      <div className="table-wrap"><table><thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>Статус</th><th></th></tr></thead><tbody>{team.map(r=><tr key={r.id}><td><b>{r.name}</b></td><td>{r.email}</td><td>{r.role}</td><td><span className="status">{r.status}</span></td><td><form action={remove}><input type="hidden" name="id" value={r.id}/><button className="button secondary" type="submit">Удалить</button></form></td></tr>)}{!team.length&&<tr><td colSpan={5} className="muted">Команда ещё не добавлена.</td></tr>}</tbody></table></div>
    </section>
    <section className="card"><span className="eyebrow">PERMISSIONS</span><h2>Роли</h2><div className="settings-list"><div><span>OWNER</span><b>Полный доступ</b></div><div><span>ADMIN</span><b>Управление программой</b></div><div><span>MANAGER</span><b>Партнёры / комиссии / отчёты</b></div><div><span>VIEWER</span><b>Только просмотр</b></div></div></section>
  </Shell>
}
