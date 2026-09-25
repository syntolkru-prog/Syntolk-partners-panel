import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeApiKey, logApiCall } from "@/lib/api-keys";

export async function POST(request:NextRequest){
  const start=Date.now();const a=await authorizeApiKey(request,"write");if(a.error)return a.error;
  const b=await request.json().catch(()=>null) as any;
  if(!b.externalUserId||!b.partnerCode)return NextResponse.json({error:"externalUserId and partnerCode required"},{status:400});
  const partner=await prisma.partner.findUnique({where:{code:String(b.partnerCode).toLowerCase()}});
  if(!partner||partner.status!=="ACTIVE")return NextResponse.json({error:"partner not found"},{status:404});
  const existing=await prisma.referral.findUnique({where:{externalUserId:String(b.externalUserId)}});
  const referral=existing||await prisma.referral.create({data:{partnerId:partner.id,externalUserId:String(b.externalUserId),status:"REGISTERED",source:b.source||"api",medium:b.medium||null,campaign:b.campaign||null,registeredAt:new Date(),metadata:b.metadata||{}}});
  await logApiCall(a.key!.id,request,existing?200:201,start,a.ipHash);
  return NextResponse.json({referral,created:!existing},{status:existing?200:201});
}

export async function GET(request:NextRequest){
  const start=Date.now();const a=await authorizeApiKey(request,"read");if(a.error)return a.error;
  const externalUserId=new URL(request.url).searchParams.get("externalUserId");if(!externalUserId)return NextResponse.json({error:"externalUserId required"},{status:400});
  const referral=await prisma.referral.findUnique({where:{externalUserId},include:{partner:true}});
  await logApiCall(a.key!.id,request,200,start,a.ipHash);return NextResponse.json({referral});
}
