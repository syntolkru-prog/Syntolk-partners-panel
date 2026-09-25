import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePartnerAccess } from "@/lib/api-auth";
export async function GET(){const a=await requirePartnerAccess();if(a.error)return a.error;return NextResponse.json({resources:await prisma.marketingResource.findMany({where:{isActive:true},orderBy:[{sortOrder:"asc"},{createdAt:"desc"}]})});}
export async function POST(request:NextRequest){const a=await requirePartnerAccess();if(a.error)return a.error;const b=await request.json() as any;if(!b.id)return NextResponse.json({error:"id required"},{status:400});const resource=await prisma.marketingResource.update({where:{id:b.id},data:{downloads:{increment:1}}});return NextResponse.json({resource});}
