import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
import { sendTemplatedEmail } from "@/lib/email";

function nextDate(frequency:string,from:Date){const d=new Date(from);if(frequency==="DAILY")d.setUTCDate(d.getUTCDate()+1);else if(frequency==="MONTHLY")d.setUTCMonth(d.getUTCMonth()+1);else d.setUTCDate(d.getUTCDate()+7);return d;}

export async function POST(request:NextRequest){
  const a=await requireAdminAccess(request);if(a.error)return a.error;
  const now=new Date();
  const reports=await prisma.scheduledReport.findMany({where:{isActive:true,OR:[{nextRunAt:null},{nextRunAt:{lte:now}}]}});
  let sent=0;
  const stats=await prisma.payment.aggregate({_sum:{amount:true},_count:true});
  for(const report of reports){
    const recipients=Array.isArray(report.recipients)?report.recipients as string[]:[];
    for(const to of recipients){
      await sendTemplatedEmail({type:"COMMISSION_CREATED",to,fallbackSubject:`Syntolk Partners — ${report.name}`,fallbackBody:`<h2>${report.name}</h2><p>Платежей: ${stats._count}</p><p>Общая выручка партнёрского канала: ${Number(stats._sum.amount||0).toLocaleString("ru-RU")} ₽</p>`});
      sent++;
    }
    await prisma.scheduledReport.update({where:{id:report.id},data:{lastRunAt:now,nextRunAt:nextDate(report.frequency,now)}});
  }
  return NextResponse.json({processed:reports.length,sent});
}
