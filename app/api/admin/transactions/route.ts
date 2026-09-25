import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
export async function GET(request:NextRequest){const a=await requireAdminAccess(request);if(a.error)return a.error;const q=new URL(request.url).searchParams;const partnerId=q.get("partnerId");const status=q.get("status") as any;const payments=await prisma.payment.findMany({where:{...(status?{status}:{}),...(partnerId?{referral:{partnerId}}:{})},include:{referral:{include:{partner:true}},commissions:true,refunds:true},orderBy:{paidAt:"desc"}});return NextResponse.json({transactions:payments});}
