import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
export async function POST(request:NextRequest){const a=await requireAdminAccess(request);if(a.error)return a.error;const b=await request.json().catch(()=>({})) as any;const key=String(b.key||"syntolk");const publicKey=`pk_partner_${randomBytes(18).toString("base64url")}`;const integration=await prisma.integrationSettings.upsert({where:{key},create:{key,provider:b.provider||"SYNTOLK",publicKey,config:{}},update:{publicKey,isActive:true}});return NextResponse.json({integration:{...integration,publicKey}});}
