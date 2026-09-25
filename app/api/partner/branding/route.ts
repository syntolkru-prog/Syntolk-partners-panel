import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePartnerAccess } from "@/lib/api-auth";
export async function GET(){const a=await requirePartnerAccess();if(a.error)return a.error;const s=await prisma.programSettings.upsert({where:{id:"default"},create:{},update:{}});return NextResponse.json({branding:{brandName:s.brandName,companyName:s.companyName,brandLogoUrl:s.brandLogoUrl,faviconUrl:s.faviconUrl,brandBackgroundColor:s.brandBackgroundColor,brandButtonColor:s.brandButtonColor,brandTextColor:s.brandTextColor,supportEmail:s.supportEmail,websiteUrl:s.websiteUrl,programName:s.programName,currency:s.currency}});}
