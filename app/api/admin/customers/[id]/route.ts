import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){const a=await requireAdminAccess(request);if(a.error)return a.error;const {id}=await params;const customer=await prisma.referral.findUnique({where:{id},include:{partner:{include:{group:true,program:true}},payments:{include:{commissions:true,refunds:true},orderBy:{paidAt:"desc"}}}});if(!customer)return NextResponse.json({error:"Not found"},{status:404});return NextResponse.json({customer});}
