import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
export async function POST(request:NextRequest){const a=await requireAdminAccess(request);if(a.error)return a.error;const result=await prisma.otpCode.deleteMany({where:{OR:[{expiresAt:{lt:new Date()}},{usedAt:{not:null},createdAt:{lt:new Date(Date.now()-86400000)}}]}});return NextResponse.json({deleted:result.count});}
