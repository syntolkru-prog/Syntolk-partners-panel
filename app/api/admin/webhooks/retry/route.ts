import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/api-auth";
import { retryOutgoingWebhookLog } from "@/lib/outgoing-webhooks";
export async function POST(request:NextRequest){const a=await requireAdminAccess(request);if(a.error)return a.error;const b=await request.json() as any;if(!b.logId)return NextResponse.json({error:"logId required"},{status:400});try{return NextResponse.json(await retryOutgoingWebhookLog(String(b.logId)));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"retry_failed"},{status:400});}}
