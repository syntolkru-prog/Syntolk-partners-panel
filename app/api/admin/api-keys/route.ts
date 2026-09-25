import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";

export async function GET(request:NextRequest){
  const a=await requireAdminAccess(request); if(a.error)return a.error;
  const keys=await prisma.apiKey.findMany({select:{id:true,name:true,prefix:true,scopes:true,rateLimit:true,isActive:true,lastUsedAt:true,expiresAt:true,createdAt:true,account:{select:{email:true,name:true}}},orderBy:{createdAt:"desc"}});
  return NextResponse.json({keys});
}
export async function POST(request:NextRequest){
  const a=await requireAdminAccess(request); if(a.error)return a.error;
  const b=await request.json() as any;
  const accountId=a.session?.accountId || b.accountId;
  if(!accountId||!b.name)return NextResponse.json({error:"admin session/accountId and name required"},{status:400});
  const raw=`sk_partner_${randomBytes(24).toString("base64url")}`;
  const keyHash=createHash("sha256").update(raw).digest("hex");
  const key=await prisma.apiKey.create({data:{accountId,name:String(b.name),keyHash,prefix:raw.slice(0,14),scopes:b.scopes||["read"],rateLimit:Number(b.rateLimit||100),expiresAt:b.expiresAt?new Date(b.expiresAt):null}});
  return NextResponse.json({key:{id:key.id,name:key.name,prefix:key.prefix,secret:raw}},{status:201});
}
export async function PATCH(request:NextRequest){
  const a=await requireAdminAccess(request);if(a.error)return a.error;const b=await request.json() as any;if(!b.id)return NextResponse.json({error:"id required"},{status:400});
  const data:any={};for(const k of ["name","scopes","isActive"]){if(b[k]!==undefined)data[k]=b[k]}if(b.rateLimit!==undefined)data.rateLimit=Number(b.rateLimit);if(b.expiresAt!==undefined)data.expiresAt=b.expiresAt?new Date(b.expiresAt):null;
  return NextResponse.json({key:await prisma.apiKey.update({where:{id:b.id},data})});
}
export async function DELETE(request:NextRequest){
  const a=await requireAdminAccess(request);if(a.error)return a.error;const id=new URL(request.url).searchParams.get("id");if(!id)return NextResponse.json({error:"id required"},{status:400});await prisma.apiKey.delete({where:{id}});return NextResponse.json({success:true});
}
