import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
function csvCell(v:unknown){const s=String(v??"");return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
export async function GET(request:NextRequest){
  const a=await requireAdminAccess(request);if(a.error)return a.error;
  const type=new URL(request.url).searchParams.get("type")||"transactions";
  let rows:string[][]=[];
  if(type==="partners"){const data=await prisma.partner.findMany({include:{_count:{select:{referrals:true,clicks:true}}}});rows=[["id","name","email","code","status","commissionRate","clicks","referrals"],...data.map(x=>[x.id,x.name,x.email,x.code,x.status,String(x.commissionRate),String(x._count.clicks),String(x._count.referrals)])];}
  else if(type==="payouts"){const data=await prisma.payout.findMany({include:{partner:true}});rows=[["id","partner","amount","status","method","reference","paidAt"],...data.map(x=>[x.id,x.partner.name,String(x.amount),x.status,x.method||"",x.reference||"",x.paidAt?.toISOString()||""])];}
  else {const data=await prisma.payment.findMany({include:{referral:{include:{partner:true}},commissions:true}});rows=[["transactionId","partner","amount","currency","status","subscriptionId","paidAt","commission"],...data.map(x=>[x.externalTransactionId,x.referral.partner.name,String(x.amount),x.currency,x.status,x.subscriptionId||"",x.paidAt.toISOString(),String(x.commissions.reduce((s,c)=>s+Number(c.amount),0))])];}
  const csv=rows.map(r=>r.map(csvCell).join(",")).join("\n");
  return new NextResponse(csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="syntolk-${type}.csv"`}});
}
