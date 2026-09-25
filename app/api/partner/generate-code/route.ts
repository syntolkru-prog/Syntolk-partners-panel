import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePartnerAccess } from "@/lib/api-auth";
export async function POST(request:NextRequest){const a=await requirePartnerAccess();if(a.error)return a.error;const partnerId=a.session!.partnerId;if(!partnerId)return NextResponse.json({error:"Partner profile required"},{status:403});const b=await request.json().catch(()=>({})) as any;let code=String(b.code||"").trim().toLowerCase();if(!code)code=`p-${randomBytes(5).toString("hex")}`;if(!/^[a-z0-9_-]{3,40}$/.test(code))return NextResponse.json({error:"Invalid code"},{status:400});const exists=await prisma.partner.findUnique({where:{code}});if(exists&&exists.id!==partnerId)return NextResponse.json({error:"Code already used"},{status:409});const partner=await prisma.partner.update({where:{id:partnerId},data:{code}});return NextResponse.json({code:partner.code});}
