import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
export async function GET(request:NextRequest){const a=await requireAdminAccess(request);if(a.error)return a.error;const refunds=await prisma.refund.findMany({include:{payment:{include:{referral:{include:{partner:true}}}},commissions:true},orderBy:{refundedAt:"desc"}});return NextResponse.json({refunds});}
