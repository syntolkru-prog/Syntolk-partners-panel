import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, requestIpHash } from "@/lib/rate-limit";

export async function authorizeApiKey(request:NextRequest, requiredScope:"read"|"write"|"admin"){
  const raw=request.headers.get("x-api-key")||request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!raw)return {key:null,error:NextResponse.json({error:"API key required"},{status:401})};
  const keyHash=createHash("sha256").update(raw).digest("hex");
  const key=await prisma.apiKey.findUnique({where:{keyHash}});
  if(!key||!key.isActive||(key.expiresAt&&key.expiresAt<new Date()))return {key:null,error:NextResponse.json({error:"Invalid API key"},{status:401})};
  const scopes=Array.isArray(key.scopes)?key.scopes as string[]:[];
  if(requiredScope==="admin"&&!scopes.includes("admin"))return {key:null,error:NextResponse.json({error:"Insufficient scope"},{status:403})};
  if(requiredScope==="write"&&!scopes.some(s=>["write","admin"].includes(s)))return {key:null,error:NextResponse.json({error:"Insufficient scope"},{status:403})};
  const rate=await checkRateLimit(key.id,new URL(request.url).pathname,key.rateLimit,60_000);
  if(!rate.allowed)return {key:null,error:NextResponse.json({error:"Rate limit exceeded"},{status:429})};
  await prisma.apiKey.update({where:{id:key.id},data:{lastUsedAt:new Date()}});
  return {key,error:null,ipHash:requestIpHash(request.headers),rate};
}

export async function logApiCall(keyId:string,request:NextRequest,statusCode:number,start:number,ipHash?:string){
  await prisma.apiUsageLog.create({data:{apiKeyId:keyId,endpoint:new URL(request.url).pathname,method:request.method,statusCode,responseMs:Date.now()-start,ipHash,userAgent:request.headers.get("user-agent")}}).catch(()=>null);
}
