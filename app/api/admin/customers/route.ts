import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
export async function GET(request:NextRequest){const a=await requireAdminAccess(request);if(a.error)return a.error;const customers=await prisma.referral.findMany({include:{partner:true,payments:{include:{commissions:true,refunds:true},orderBy:{paidAt:"desc"}}},orderBy:{createdAt:"desc"}});return NextResponse.json({customers:customers.map(c=>({...c,totalRevenue:c.payments.reduce((s,p)=>s+Number(p.amount),0),totalCommission:c.payments.flatMap(p=>p.commissions).reduce((s,x)=>s+Number(x.amount),0),refunds:c.payments.flatMap(p=>p.refunds).reduce((s,x)=>s+Number(x.amount),0)}))});}
