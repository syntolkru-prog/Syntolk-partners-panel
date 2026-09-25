import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestIpHash } from "@/lib/rate-limit";
import { evaluateClickFraud } from "@/lib/fraud";

export async function GET(request:NextRequest,{params}:{params:Promise<{code:string}>}){
  const {code}=await params;
  const partner=await prisma.partner.findUnique({where:{code:code.toLowerCase()}});
  const settings=await prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}});
  if(!partner||partner.status!=="ACTIVE") return NextResponse.redirect(new URL(settings.websiteUrl));

  const clickId=randomUUID();
  const ipHash=requestIpHash(request.headers);
  const ua=request.headers.get("user-agent")||"";
  const fraud=await evaluateClickFraud({partnerId:partner.id,ipHash,userAgent:ua});
  const q=request.nextUrl.searchParams;

  await prisma.referralClick.create({data:{
    clickId,partnerId:partner.id,landingUrl:settings.websiteUrl,referer:request.headers.get("referer"),userAgent:ua,ipHash,
    source:q.get("utm_source"),medium:q.get("utm_medium"),campaign:q.get("utm_campaign"),content:q.get("utm_content"),term:q.get("utm_term"),
    isSuspicious:fraud.suspicious,fraudScore:fraud.score,fraudReasons:fraud.reasons
  }});

  const destination=new URL(settings.websiteUrl);
  for(const [k,v] of q.entries()) destination.searchParams.set(k,v);
  destination.searchParams.set("ref",partner.code);
  destination.searchParams.set("click_id",clickId);

  return NextResponse.redirect(destination);
}
