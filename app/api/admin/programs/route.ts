import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAdminAccess(request); if (auth.error) return auth.error;
  const programs = await prisma.program.findMany({ include: { _count: { select: { partners: true, groups: true } } }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
  return NextResponse.json({ programs });
}
export async function POST(request: NextRequest) {
  const auth = await requireAdminAccess(request); if (auth.error) return auth.error;
  const b = await request.json().catch(()=>null) as Record<string,unknown>|null;
  const name=String(b?.name??"").trim(), slug=String(b?.slug??"").trim().toLowerCase();
  if(!name||!slug) return NextResponse.json({error:"name and slug required"},{status:400});
  const program=await prisma.program.create({data:{
    name,slug,description:b?.description?String(b.description):null,
    commissionRate:Number(b?.commissionRate??20),cookieDays:Number(b?.cookieDays??60),
    currency:String(b?.currency??"RUB"),isDefault:Boolean(b?.isDefault),requireApproval:b?.requireApproval===undefined?true:Boolean(b.requireApproval),
    minimumPayoutAmount:Number(b?.minimumPayoutAmount??5000),payoutFrequency:String(b?.payoutFrequency??"MONTHLY"),
    termsUrl:b?.termsUrl?String(b.termsUrl):null,logoUrl:b?.logoUrl?String(b.logoUrl):null,brandColor:String(b?.brandColor??"#6c5ce7")
  }});
  if(program.isDefault) await prisma.program.updateMany({where:{id:{not:program.id},isDefault:true},data:{isDefault:false}});
  return NextResponse.json({program},{status:201});
}
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminAccess(request); if (auth.error) return auth.error;
  const b=await request.json().catch(()=>null) as Record<string,unknown>|null; const id=String(b?.id??"");
  if(!id) return NextResponse.json({error:"id required"},{status:400});
  const data:any={};
  for(const k of ["name","description","currency","payoutFrequency","termsUrl","logoUrl","brandColor"] as const) if(b?.[k]!==undefined) data[k]=b[k];
  for(const k of ["commissionRate","cookieDays","minimumPayoutAmount"] as const) if(b?.[k]!==undefined) data[k]=Number(b[k]);
  for(const k of ["isActive","isDefault","requireApproval"] as const) if(b?.[k]!==undefined) data[k]=Boolean(b[k]);
  const program=await prisma.program.update({where:{id},data});
  if(program.isDefault) await prisma.program.updateMany({where:{id:{not:id},isDefault:true},data:{isDefault:false}});
  return NextResponse.json({program});
}
