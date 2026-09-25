import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/api-auth";
import { sendTemplatedEmail } from "@/lib/email";
export async function POST(request:NextRequest){const a=await requireAdminAccess(request);if(a.error)return a.error;const b=await request.json() as any;if(!b.to)return NextResponse.json({error:"to required"},{status:400});const result=await sendTemplatedEmail({type:b.type||"WELCOME",to:b.to,variables:{name:"Тестовый партнёр",code:"123456"},fallbackSubject:"Тест Syntolk Partners",fallbackBody:"<h2>Тестовое письмо Syntolk Partners</h2>"});return NextResponse.json(result);}
