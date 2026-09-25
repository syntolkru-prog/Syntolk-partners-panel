import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeApiKey, logApiCall } from "@/lib/api-keys";

export async function POST(request:NextRequest){
  const start=Date.now();const a=await authorizeApiKey(request,"write");if(a.error)return a.error;
  const b=await request.json().catch(()=>null) as any;const code=String(b?.code||"").toUpperCase();const amount=Number(b?.amount||0);
  if(!code||!Number.isFinite(amount)||amount<0)return NextResponse.json({error:"code and amount required"},{status:400});
  const coupon=await prisma.coupon.findUnique({where:{code},include:{partner:true,program:true}});
  const now=new Date();
  const valid=!!coupon&&coupon.isActive&&(!coupon.startsAt||coupon.startsAt<=now)&&(!coupon.expiresAt||coupon.expiresAt>=now)&&(!coupon.maxUses||coupon.usedCount<coupon.maxUses)&&(!coupon.minimumAmount||amount>=Number(coupon.minimumAmount));
  if(!valid){await logApiCall(a.key!.id,request,200,start,a.ipHash);return NextResponse.json({valid:false});}
  const discount=coupon!.discountType==="PERCENTAGE"?amount*(Number(coupon!.discountValue)/100):Math.min(amount,Number(coupon!.discountValue));
  if(b.consume===true)await prisma.coupon.update({where:{id:coupon!.id},data:{usedCount:{increment:1}}});
  await logApiCall(a.key!.id,request,200,start,a.ipHash);
  return NextResponse.json({valid:true,coupon:{id:coupon!.id,code:coupon!.code,discountType:coupon!.discountType,discountValue:Number(coupon!.discountValue),partnerId:coupon!.partnerId},discount,finalAmount:Math.max(0,amount-discount)});
}
