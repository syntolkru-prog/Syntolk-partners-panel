import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeApiKey, logApiCall } from "@/lib/api-keys";
import { calculateCommission } from "@/lib/commission-engine";

export async function POST(request:NextRequest){
  const start=Date.now();const a=await authorizeApiKey(request,"write");if(a.error)return a.error;
  const b=await request.json().catch(()=>null) as any;
  const txId=String(b?.transactionId||""),externalUserId=String(b?.externalUserId||""),amount=Number(b?.amount||0);
  if(!txId||!externalUserId||!Number.isFinite(amount)||amount<=0)return NextResponse.json({error:"invalid revenue event"},{status:400});
  const referral=await prisma.referral.findUnique({where:{externalUserId},include:{partner:{include:{group:true,program:true}}}});
  if(!referral||referral.partner.status!=="ACTIVE")return NextResponse.json({ignored:true});
  const result=await prisma.$transaction(async tx=>{
    const payment=await tx.payment.upsert({where:{externalTransactionId:txId},update:{},create:{externalTransactionId:txId,referralId:referral.id,amount,currency:String(b.currency||"RUB"),subscriptionId:b.subscriptionId||null,invoiceId:b.invoiceId||null,description:b.description||"API revenue",paidAt:b.paidAt?new Date(b.paidAt):new Date(),rawPayload:b}});
    const calculated=await calculateCommission(tx,{amount,currency:String(b.currency||"RUB"),partner:referral.partner,referral,subscriptionId:b.subscriptionId||null,invoiceId:b.invoiceId||null});
    const commission=await tx.commission.upsert({where:{idempotencyKey:`api:earning:${txId}`},update:{},create:{partnerId:referral.partnerId,paymentId:payment.id,kind:"EARNING",idempotencyKey:`api:earning:${txId}`,amount:calculated.amount,rate:calculated.rate,commissionRuleId:calculated.ruleId,note:`Calculated by ${calculated.source}`,availableAt:new Date(Date.now()+calculated.holdDays*86400000)}});
    return {payment,commission};
  });
  await logApiCall(a.key!.id,request,201,start,a.ipHash);return NextResponse.json(result,{status:201});
}
