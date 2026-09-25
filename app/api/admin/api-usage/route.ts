import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
export async function GET(request:NextRequest){const a=await requireAdminAccess(request);if(a.error)return a.error;const q=new URL(request.url).searchParams;const apiKeyId=q.get("apiKeyId");const logs=await prisma.apiUsageLog.findMany({where:apiKeyId?{apiKeyId}:{},include:{apiKey:{select:{name:true,prefix:true}}},orderBy:{createdAt:"desc"},take:500});return NextResponse.json({logs});}
