import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

async function createInvoice(formData:FormData){
  "use server";
  const s=await currentSession();if(s?.role!=="ADMIN")redirect("/login");
  const partnerId=String(formData.get("partnerId")||"");const amount=Number(formData.get("amount")||0);if(!partnerId||amount<=0)return;
  const year=new Date().getFullYear();const seq=(await prisma.invoice.count())+1;
  await prisma.invoice.create({data:{invoiceNumber:`INV-${year}-${String(seq).padStart(5,"0")}`,partnerId,amount,tax:0,total:amount,currency:String(formData.get("currency")||"RUB"),status:"DRAFT",lineItems:[{description:"Партнёрское вознаграждение",qty:1,unitPrice:amount,total:amount}],billingInfo:{}}});
  revalidatePath("/admin/invoices");
}

export default async function Page(){
  const [invoices,partners,settings]=await Promise.all([
    prisma.invoice.findMany({include:{partner:true,payout:true},orderBy:{createdAt:"desc"},take:100}),
    prisma.partner.findMany({where:{status:"ACTIVE"},select:{id:true,name:true},orderBy:{name:"asc"}}),
    prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}})
  ]);
  return <Shell title="Счета и документы" subtitle="Invoice records, связанные с ручными выплатами и реквизитами партнёров." nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="card"><div className="section-title"><div><span className="eyebrow">INVOICES</span><h2>{invoices.length} счетов в выборке</h2></div></div>
      <form action={createInvoice} className="inline-form"><select className="input" name="partnerId" defaultValue=""><option value="" disabled>Партнёр</option>{partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input className="input mini-input" name="amount" type="number" step="0.01" placeholder="Сумма"/><input type="hidden" name="currency" value={settings.currency}/><button className="button primary" type="submit">+ Создать счёт</button></form>
      <div className="table-wrap"><table><thead><tr><th>Номер</th><th>Партнёр</th><th>Сумма</th><th>Статус</th><th>Выплата</th></tr></thead><tbody>{invoices.map(r=><tr key={r.id}><td><code>{r.invoiceNumber}</code><small className="block muted">{r.createdAt.toLocaleDateString("ru-RU")}</small></td><td>{r.partner.name}</td><td><Money value={Number(r.total)} currency={r.currency}/></td><td><span className="status">{r.status}</span></td><td>{r.payoutId||"—"}</td></tr>)}{!invoices.length&&<tr><td colSpan={5} className="muted">Счетов пока нет.</td></tr>}</tbody></table></div>
    </section>
  </Shell>
}
