import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePartnerAccess } from "@/lib/api-auth";
export async function GET(){const a=await requirePartnerAccess();if(a.error)return a.error;const partnerId=a.session!.partnerId;if(!partnerId)return NextResponse.json({notifications:[]});return NextResponse.json({notifications:await prisma.notification.findMany({where:{partnerId},orderBy:{createdAt:"desc"},take:100})});}
export async function PATCH(request:NextRequest){const a=await requirePartnerAccess();if(a.error)return a.error;const partnerId=a.session!.partnerId;const b=await request.json() as any;if(!partnerId||!b.id)return NextResponse.json({error:"invalid request"},{status:400});const n=await prisma.notification.updateMany({where:{id:b.id,partnerId},data:{readAt:new Date()}});return NextResponse.json({updated:n.count});}
