import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

async function save(formData:FormData){
  "use server";
  const s=await currentSession();if(s?.role!=="ADMIN")redirect("/login");
  const data={
    baseCommissionRate:Number(formData.get("baseCommissionRate")||20),
    commissionHoldDays:Number(formData.get("commissionHoldDays")||14),
    minimumPayoutAmount:Number(formData.get("minimumPayoutAmount")||5000),
    cookieDays:Number(formData.get("cookieDays")||60),
    requireApproval:formData.get("requireApproval")==="on",
    selfReferralBlocked:formData.get("selfReferralBlocked")==="on",
    hideCustomerEmails:formData.get("hideCustomerEmails")==="on",
    requireBusinessEmail:formData.get("requireBusinessEmail")==="on",
    disablePersonalizedLinks:formData.get("disablePersonalizedLinks")==="on",
    brandName:String(formData.get("brandName")||"Syntolk"),
    supportEmail:String(formData.get("supportEmail")||"")||null,
    websiteUrl:String(formData.get("websiteUrl")||"https://syntolk.ru")
  };
  await prisma.programSettings.upsert({where:{id:"default"},create:data,update:data});
  await prisma.auditLog.create({data:{actorId:s.accountId,actorType:"ADMIN",action:"UPDATE_PROGRAM_SETTINGS",objectType:"PROGRAM_SETTINGS",objectId:"default",payload:data}});
  revalidatePath("/admin/settings");
}

export default async function AdminSettingsPage(){
  const settings=await prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}});
  return <Shell title="Настройки программы" subtitle="Правила атрибуции, комиссии, холд, выплаты и бренд партнёрского кабинета." nav={adminNav} role="АДМИНИСТРАТОР">
    <form action={save} className="settings-layout">
      <article className="card"><span className="eyebrow">КОМИССИИ</span><h2>Финансовые правила</h2><div className="form-grid">
        <label><span>Базовая комиссия</span><div className="input-suffix"><input className="input" name="baseCommissionRate" type="number" step="0.01" defaultValue={Number(settings.baseCommissionRate)}/><b>%</b></div></label>
        <label><span>Холд начисления</span><div className="input-suffix"><input className="input" name="commissionHoldDays" type="number" defaultValue={settings.commissionHoldDays}/><b>дней</b></div></label>
        <label><span>Минимальная выплата</span><div className="input-suffix"><input className="input" name="minimumPayoutAmount" type="number" defaultValue={Number(settings.minimumPayoutAmount)}/><b>{settings.currency}</b></div></label>
        <label><span>Cookie window</span><div className="input-suffix"><input className="input" name="cookieDays" type="number" defaultValue={settings.cookieDays}/><b>дней</b></div></label>
      </div></article>
      <article className="card"><span className="eyebrow">АТРИБУЦИЯ</span><h2>Правила привлечения</h2><div className="checkbox-list"><label><input type="checkbox" name="requireApproval" defaultChecked={settings.requireApproval}/> Подтверждать новых партнёров</label><label><input type="checkbox" name="selfReferralBlocked" defaultChecked={settings.selfReferralBlocked}/> Запретить self-referral</label><label><input type="checkbox" name="hideCustomerEmails" defaultChecked={settings.hideCustomerEmails}/> Скрывать идентификаторы клиентов</label><label><input type="checkbox" name="requireBusinessEmail" defaultChecked={settings.requireBusinessEmail}/> Требовать business email</label><label><input type="checkbox" name="disablePersonalizedLinks" defaultChecked={settings.disablePersonalizedLinks}/> Запретить персональные referral codes</label></div></article>
      <article className="card"><span className="eyebrow">БРЕНД</span><h2>Партнёрский кабинет</h2><div className="form-grid"><label><span>Название</span><input className="input" name="brandName" defaultValue={settings.brandName}/></label><label><span>Сайт</span><input className="input" name="websiteUrl" defaultValue={settings.websiteUrl}/></label><label><span>Support email</span><input className="input" name="supportEmail" defaultValue={settings.supportEmail||""}/></label></div></article>
      <article className="card"><span className="eyebrow">CLOUDPAYMENTS</span><h2>Платежная интеграция</h2><div className="integration-status"><span className="dot"></span><div><b>Pay · Refund · Cancel</b><small>HMAC, idempotency, recurring, proportional reversals</small></div></div><div className="callout">Минимальная выплата: <b><Money value={Number(settings.minimumPayoutAmount)} currency={settings.currency}/></b></div><button className="button primary" type="submit">Сохранить настройки</button></article>
    </form>
  </Shell>
}
