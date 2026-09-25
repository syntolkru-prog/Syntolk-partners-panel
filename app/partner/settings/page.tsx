import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Shell, Money } from "@/components/shell";
import { partnerNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

async function saveProfile(formData:FormData){
  "use server";
  const session=await currentSession();if(!session?.partnerId)redirect("/login");
  const name=String(formData.get("name")||"").trim();const code=String(formData.get("code")||"").trim().toLowerCase();
  const payoutDetails=String(formData.get("payoutDetails")||"").trim();
  if(name)await prisma.$transaction([
    prisma.partner.update({where:{id:session.partnerId},data:{name,payoutDetails:{text:payoutDetails}}}),
    prisma.account.update({where:{id:session.accountId},data:{name}})
  ]);
  if(code&&/^[a-z0-9_-]{3,40}$/.test(code)){
    const settings=await prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}});
    if(!settings.disablePersonalizedLinks){
      const existing=await prisma.partner.findUnique({where:{code}});
      if(!existing||existing.id===session.partnerId)await prisma.partner.update({where:{id:session.partnerId},data:{code}});
    }
  }
  revalidatePath("/partner/settings");
}

async function saveNotifications(formData:FormData){
  "use server";
  const session=await currentSession();if(!session?.partnerId)redirect("/login");
  await prisma.partner.update({where:{id:session.partnerId},data:{notificationPreferences:{
    commission:formData.get("commission")==="on",payout:formData.get("payout")==="on",refund:formData.get("refund")==="on"
  }}});
  revalidatePath("/partner/settings");
}

export default async function Page(){
  const session=await currentSession();if(!session?.partnerId)redirect("/login");
  const [partner,settings]=await Promise.all([
    prisma.partner.findUnique({where:{id:session.partnerId},include:{group:true,program:true}}),
    prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}})
  ]);
  if(!partner)redirect("/login");
  const rate=partner.usesCustomCommission?Number(partner.commissionRate):partner.group?Number(partner.group.commissionRate):partner.program?Number(partner.program.commissionRate):Number(settings.baseCommissionRate);
  const prefs=(partner.notificationPreferences||{}) as Record<string,unknown>;
  const payout=(partner.payoutDetails as any)?.text||"";
  return <Shell title="Настройки" subtitle="Профиль, referral code, реквизиты ручной выплаты и уведомления." nav={partnerNav} role="ПАРТНЁР"><section className="settings-layout">
    <article className="card"><span className="eyebrow">ПРОФИЛЬ</span><h2>Партнёрские данные</h2><form action={saveProfile}><div className="form-grid"><label><span>Имя</span><input className="input" name="name" defaultValue={partner.name}/></label><label><span>Referral code</span><input className="input" name="code" defaultValue={partner.code} disabled={settings.disablePersonalizedLinks}/></label></div><label><span>Реквизиты ручной выплаты</span><textarea className="input textarea" name="payoutDetails" defaultValue={payout}/></label><button className="button primary" type="submit">Сохранить</button></form></article>
    <article className="card"><span className="eyebrow">УСЛОВИЯ</span><h2>Текущая программа</h2><div className="settings-list"><div><span>Комиссия</span><b>{rate}%</b></div><div><span>Cookie window</span><b>{partner.cookieDays} дней</b></div><div><span>Холд</span><b>{settings.commissionHoldDays} дней</b></div><div><span>Минимальная выплата</span><b><Money value={Number(settings.minimumPayoutAmount)} currency={settings.currency}/></b></div></div></article>
    <article className="card"><span className="eyebrow">УВЕДОМЛЕНИЯ</span><h2>Что сообщать</h2><form action={saveNotifications} className="checkbox-list"><label><input type="checkbox" name="commission" defaultChecked={prefs.commission!==false}/> Новая комиссия</label><label><input type="checkbox" name="payout" defaultChecked={prefs.payout!==false}/> Выплата</label><label><input type="checkbox" name="refund" defaultChecked={prefs.refund!==false}/> Возвраты</label><button className="button primary" type="submit">Сохранить уведомления</button></form></article>
  </section></Shell>
}
