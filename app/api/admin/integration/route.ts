import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
export async function GET(request:NextRequest){const a=await requireAdminAccess(request);if(a.error)return a.error;return NextResponse.json({integrations:await prisma.integrationSettings.findMany({orderBy:{createdAt:"desc"}})});}
export async function PATCH(request:NextRequest){const a=await requireAdminAccess(request);if(a.error)return a.error;const b=await request.json() as any;const key=String(b.key||"syntolk");const data:any={provider:b.provider||"SYNTOLK",publicKey:b.publicKey||null,webhookUrl:b.webhookUrl||null,trackingScript:b.trackingScript||null,isActive:b.isActive===undefined?true:Boolean(b.isActive),config:b.config||{}};const integration=await prisma.integrationSettings.upsert({where:{key},create:{key,...data},update:data});return NextResponse.json({integration});}
