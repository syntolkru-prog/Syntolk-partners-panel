import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";
import { sendTemplatedEmail } from "@/lib/email";

async function updatePartner(formData:FormData){
  "use server";
  const s=await currentSession();if(s?.role!=="ADMIN")redirect("/login");
  const id=String(formData.get("id")||"");if(!id)return;
  const status=String(formData.get("status")||"PENDING") as any;
  const custom=String(formData.get("commissionRate")||"").trim();
  const data:any={
    status,
    groupId:String(formData.get("groupId")||"")||null,
    programId:String(formData.get("programId")||"")||null,
    syntolkUserId:String(formData.get("syntolkUserId")||"")||null,
    cookieDays:Number(formData.get("cookieDays")||60),
    note:String(formData.get("note")||"")||null
  };
  if(custom){data.commissionRate=Number(custom);data.usesCustomCommission=true;}else data.usesCustomCommission=false;
  if(status==="ACTIVE")data.approvedAt=new Date();
  if(status==="SUSPENDED")data.suspendedAt=new Date();
  const partner=await prisma.partner.update({where:{id},data});
  await prisma.auditLog.create({data:{actorId:s.accountId,actorType:"ADMIN",action:"UPDATE_PARTNER",objectType:"PARTNER",objectId:id,payload:data}});
  if(status==="ACTIVE")await sendTemplatedEmail({type:"PARTNER_APPROVED",to:partner.email,recipientId:partner.id,variables:{name:partner.name},fallbackSubject:"Syntolk Partners: заявка одобрена",fallbackBody:"<h2>Заявка одобрена</h2>"}).catch(()=>null);
  revalidatePath(`/admin/partners/${id}`);
}

export default async function Page({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const [partner,groups,programs,settings]=await Promise.all([
    prisma.partner.findUnique({where:{id},include:{group:true,program:true,_count:{select:{clicks:true,referrals:true}},referrals:{select:{payments:{include:{refunds:true}}}},commissions:{select:{amount:true,status:true}},payouts:true}}),
    prisma.partnerGroup.findMany({orderBy:{name:"asc"}}),
    prisma.program.findMany({where:{isActive:true},orderBy:{name:"asc"}}),
    prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}})
  ]);
  if(!partner)notFound();
  const revenue=partner.referrals.flatMap(r=>r.payments).reduce((s,p)=>s+Number(p.amount),0);
  const refundAmount=partner.referrals.flatMap(r=>r.payments).flatMap(p=>p.refunds).reduce((s,r)=>s+Number(r.amount),0);
  const available=partner.commissions.filter(c=>c.status==="APPROVED").reduce((s,c)=>s+Number(c.amount),0);
  const recurring=partner.referrals.flatMap(r=>r.payments).filter(p=>p.subscriptionId).length;
  const rate=partner.usesCustomCommission?Number(partner.commissionRate):partner.group?Number(partner.group.commissionRate):partner.program?Number(partner.program.commissionRate):Number(settings.baseCommissionRate);
  return <Shell title="Карточка партнёра" subtitle={partner.email} nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="hero-panel"><div><span className="muted">{partner.name}</span><strong className="hero-money">{rate}%</strong><span className="positive">{partner.status}</span></div><div className="hero-meta"><span>К выплате <b><Money value={available} currency={settings.currency}/></b></span><span>Принёс Syntolk <b><Money value={revenue} currency={settings.currency}/></b></span></div></section>
    <section className="stat-grid"><article><span>Переходы</span><strong>{partner._count.clicks}</strong><small>всё время</small></article><article><span>Клиенты</span><strong>{partner._count.referrals}</strong><small>атрибутированы</small></article><article><span>Recurring payments</span><strong>{recurring}</strong><small>SubscriptionId</small></article><article><span>Refund rate</span><strong>{revenue?((refundAmount/revenue)*100).toFixed(1):"0.0"}%</strong><small>по сумме</small></article></section>
    <section className="card"><span className="eyebrow">УПРАВЛЕНИЕ</span><h2>Условия партнёра</h2><form action={updatePartner} className="form-stack"><input type="hidden" name="id" value={partner.id}/><div className="form-grid"><label><span>Статус</span><select className="input" name="status" defaultValue={partner.status}><option>PENDING</option><option>ACTIVE</option><option>SUSPENDED</option><option>REJECTED</option></select></label><label><span>Индивидуальная ставка, %</span><input className="input" name="commissionRate" type="number" step="0.01" defaultValue={partner.usesCustomCommission?Number(partner.commissionRate):""} placeholder="пусто = группа/программа"/></label><label><span>Cookie days</span><input className="input" name="cookieDays" type="number" defaultValue={partner.cookieDays}/></label><label><span>Syntolk user ID</span><input className="input" name="syntolkUserId" defaultValue={partner.syntolkUserId||""}/></label><label><span>Группа</span><select className="input" name="groupId" defaultValue={partner.groupId||""}><option value="">Без группы</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label><span>Программа</span><select className="input" name="programId" defaultValue={partner.programId||""}><option value="">Default</option>{programs.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><label><span>Внутренняя заметка</span><textarea className="input textarea" name="note" defaultValue={partner.note||""}/></label><button className="button primary" type="submit">Сохранить партнёра</button></form></section>
  </Shell>
}
