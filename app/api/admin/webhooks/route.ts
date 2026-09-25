import { createHmac, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
import { AVAILABLE_PARTNER_EVENTS, safeWebhookUrl, triggerOutgoingWebhook } from "@/lib/outgoing-webhooks";

export async function GET(request:NextRequest){
  const a=await requireAdminAccess(request);if(a.error)return a.error;
  const hooks=await prisma.outgoingWebhook.findMany({include:{logs:{orderBy:{createdAt:"desc"},take:10}},orderBy:{createdAt:"desc"}});
  const stats=await prisma.outgoingWebhookLog.groupBy({by:["status"],_count:{id:true}});
  return NextResponse.json({webhooks:hooks.map(h=>({...h,secret:"••••••••"})),availableEvents:AVAILABLE_PARTNER_EVENTS,stats:Object.fromEntries(stats.map(s=>[s.status,s._count.id]))});
}

export async function POST(request:NextRequest){
  const a=await requireAdminAccess(request);if(a.error)return a.error;
  const b=await request.json() as any;
  const action=b.action||"create";

  if(action==="create"){
    if(!b.name||!b.url||!safeWebhookUrl(String(b.url)))return NextResponse.json({error:"valid HTTPS name/url required"},{status:400});
    const events=Array.isArray(b.events)?b.events:[...AVAILABLE_PARTNER_EVENTS];
    const invalid=events.filter((e:string)=>!AVAILABLE_PARTNER_EVENTS.includes(e as any));
    if(invalid.length)return NextResponse.json({error:"invalid events",invalid},{status:400});
    const secret=`whsec_${randomBytes(24).toString("hex")}`;
    const hook=await prisma.outgoingWebhook.create({data:{name:b.name,url:b.url,secret,events,isActive:true}});
    return NextResponse.json({webhook:{...hook,secret}},{status:201});
  }

  if(action==="trigger"){
    if(!AVAILABLE_PARTNER_EVENTS.includes(b.eventType))return NextResponse.json({error:"invalid eventType"},{status:400});
    await triggerOutgoingWebhook(b.eventType,b.eventData||{manual:true});
    return NextResponse.json({success:true});
  }

  if(action==="test"){
    let url=String(b.url||""),secret=randomBytes(24).toString("hex"),hookId:string|null=null;
    if(b.webhookId){
      const hook=await prisma.outgoingWebhook.findUnique({where:{id:String(b.webhookId)}});
      if(!hook)return NextResponse.json({error:"webhook not found"},{status:404});
      url=hook.url;secret=hook.secret;hookId=hook.id;
    }
    if(!safeWebhookUrl(url))return NextResponse.json({error:"unsafe webhook URL"},{status:400});
    const payload={event:"test",timestamp:new Date().toISOString(),data:{message:"Syntolk Partners webhook test"}};
    const raw=JSON.stringify(payload);const signature=createHmac("sha256",secret).update(raw).digest("hex");
    try{
      const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-syntolk-signature":signature,"x-syntolk-event":"test"},body:raw,signal:AbortSignal.timeout(15000)});
      const responseText=(await response.text().catch(()=>"")).slice(0,1000);
      if(hookId)await prisma.outgoingWebhookLog.create({data:{webhookId:hookId,eventType:"test",payload,status:response.ok?"SUCCESS":"FAILED",statusCode:response.status,response:responseText,completedAt:new Date(),attempts:1}});
      return NextResponse.json({success:response.ok,statusCode:response.status,response:responseText});
    }catch(error){
      if(hookId)await prisma.outgoingWebhookLog.create({data:{webhookId:hookId,eventType:"test",payload,status:"FAILED",error:error instanceof Error?error.message:"network_error",completedAt:new Date(),attempts:1}});
      return NextResponse.json({success:false,error:"connection_failed"},{status:400});
    }
  }

  return NextResponse.json({error:"invalid action"},{status:400});
}

export async function PATCH(request:NextRequest){
  const a=await requireAdminAccess(request);if(a.error)return a.error;const b=await request.json() as any;if(!b.id)return NextResponse.json({error:"id required"},{status:400});
  const data:any={};for(const k of ["name","url","events","isActive"]){if(b[k]!==undefined)data[k]=b[k]}
  if(data.url&&!safeWebhookUrl(String(data.url)))return NextResponse.json({error:"unsafe webhook URL"},{status:400});
  let rotatedSecret:string|undefined;if(b.rotateSecret){rotatedSecret=`whsec_${randomBytes(24).toString("hex")}`;data.secret=rotatedSecret;}
  const hook=await prisma.outgoingWebhook.update({where:{id:b.id},data});
  return NextResponse.json({webhook:{...hook,secret:rotatedSecret||"••••••••"}});
}
export async function DELETE(request:NextRequest){const a=await requireAdminAccess(request);if(a.error)return a.error;const id=new URL(request.url).searchParams.get("id");if(!id)return NextResponse.json({error:"id required"},{status:400});await prisma.outgoingWebhook.delete({where:{id}});return NextResponse.json({success:true});}
