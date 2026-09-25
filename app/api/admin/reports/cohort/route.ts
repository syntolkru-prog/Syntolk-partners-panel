import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";

export async function GET(request:NextRequest){
  const a=await requireAdminAccess(request);if(a.error)return a.error;
  const referrals=await prisma.referral.findMany({include:{payments:true},orderBy:{registeredAt:"asc"}});
  const cohorts=new Map<string,{registered:number,payers:Set<string>,revenue:number}>();
  for(const r of referrals){
    const d=r.registeredAt||r.createdAt;
    const key=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
    const row=cohorts.get(key)||{registered:0,payers:new Set<string>(),revenue:0};
    row.registered++;
    if(r.payments.length)row.payers.add(r.id);
    row.revenue+=r.payments.reduce((s,p)=>s+Number(p.amount),0);
    cohorts.set(key,row);
  }
  return NextResponse.json({cohorts:[...cohorts.entries()].map(([cohort,v])=>({cohort,registered:v.registered,payers:v.payers.size,conversionRate:v.registered?v.payers.size/v.registered:0,revenue:v.revenue}))});
}
