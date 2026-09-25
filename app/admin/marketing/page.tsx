import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

async function createCoupon(formData:FormData){
  "use server";
  const s=await currentSession();if(s?.role!=="ADMIN")redirect("/login");
  const code=String(formData.get("code")||"").trim().toUpperCase();const value=Number(formData.get("value")||0);
  if(!code||value<=0)return;
  await prisma.coupon.create({data:{code,discountType:String(formData.get("type")||"PERCENTAGE") as any,discountValue:value,currency:String(formData.get("currency")||"RUB"),partnerId:String(formData.get("partnerId")||"")||null,createdBy:s.accountId}});
  revalidatePath("/admin/marketing");
}
async function createResource(formData:FormData){
  "use server";
  const s=await currentSession();if(s?.role!=="ADMIN")redirect("/login");
  const title=String(formData.get("title")||"").trim();if(!title)return;
  await prisma.marketingResource.create({data:{title,type:String(formData.get("type")||"OTHER") as any,description:String(formData.get("description")||"")||null,url:String(formData.get("url")||"")||null,content:String(formData.get("content")||"")||null,category:String(formData.get("category")||"")||null,createdBy:s.accountId}});
  revalidatePath("/admin/marketing");
}

export default async function Page(){
  const [coupons,resources,partners,settings]=await Promise.all([
    prisma.coupon.findMany({include:{partner:true,program:true},orderBy:{createdAt:"desc"},take:100}),
    prisma.marketingResource.findMany({orderBy:[{sortOrder:"asc"},{createdAt:"desc"}],take:100}),
    prisma.partner.findMany({where:{status:"ACTIVE"},select:{id:true,name:true},orderBy:{name:"asc"}}),
    prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}})
  ]);
  return <Shell title="Маркетинг" subtitle="Купоны, баннеры, готовые тексты, лендинги и бренд-материалы для партнёров." nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="grid-two">
      <article className="card"><span className="eyebrow">COUPONS</span><h2>Промокоды</h2>
        <form action={createCoupon} className="form-stack"><input className="input" name="code" placeholder="CODE20"/><div className="inline-form"><select className="input" name="type" defaultValue="PERCENTAGE"><option>PERCENTAGE</option><option>FIXED</option></select><input className="input mini-input" name="value" type="number" step="0.01" placeholder="20"/><select className="input" name="partnerId" defaultValue=""><option value="">Для всех</option>{partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div><input type="hidden" name="currency" value={settings.currency}/><button className="button primary" type="submit">+ Промокод</button></form>
        <div className="settings-list">{coupons.map(c=><div key={c.id}><span>{c.code}<small className="block muted">{c.partner?.name||c.program?.name||"Вся программа"}</small></span><b>{Number(c.discountValue)}{c.discountType==="PERCENTAGE"?"%":` ${c.currency}`} · {c.isActive?"ON":"OFF"}</b></div>)}{!coupons.length&&<p className="muted">Промокодов нет.</p>}</div>
      </article>
      <article className="card"><span className="eyebrow">RESOURCES</span><h2>Материалы</h2>
        <form action={createResource} className="form-stack"><input className="input" name="title" placeholder="Название"/><select className="input" name="type" defaultValue="BANNER"><option>BANNER</option><option>LOGO</option><option>TEXT</option><option>LANDING</option><option>EMAIL_TEMPLATE</option><option>SOCIAL_POST</option><option>DOCUMENT</option><option>VIDEO</option><option>OTHER</option></select><input className="input" name="url" placeholder="https://..."/><textarea className="input textarea" name="content" placeholder="Текст или HTML-контент"/><button className="button primary" type="submit">+ Материал</button></form>
        <div className="settings-list">{resources.map(r=><div key={r.id}><span>{r.title}<small className="block muted">{r.category||r.description||"—"}</small></span><b>{r.type} · {r.downloads}</b></div>)}{!resources.length&&<p className="muted">Материалов нет.</p>}</div>
      </article>
    </section>
  </Shell>
}
