import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;
  const settings = await prisma.programSettings.upsert({
    where: { id: "default" },
    create: {},
    update: {},
  });
  return NextResponse.json({ settings });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const allowed = [
    "programName", "websiteUrl", "currency", "baseCommissionRate", "cookieDays",
    "commissionHoldDays", "minimumPayoutAmount", "hideCustomerEmails",
    "requireApproval", "allowManualReferrals", "selfReferralBlocked",
    "termsOfService", "brandName", "brandLogoUrl", "supportEmail", "companyName",
    "portalSubdomain", "faviconUrl", "brandBackgroundColor", "brandButtonColor", "brandTextColor",
    "blockedCountries", "urlParameters", "blockKeywords", "blockSocialMediaAds",
    "disablePersonalizedLinks", "requireBusinessEmail", "enablePostbacks", "payoutFrequency",
    "payoutMethods", "programWideCouponCode",
  ] as const;

  const data: any = {};
  for (const key of allowed) {
    if (body[key] !== undefined) data[key] = body[key];
  }

  const settings = await prisma.programSettings.upsert({
    where: { id: "default" },
    create: data,
    update: data,
  });

  await prisma.auditLog.create({
    data: {
      actorType: "ADMIN",
      action: "UPDATE_PROGRAM_SETTINGS",
      objectType: "PROGRAM_SETTINGS",
      objectId: "default",
      payload: data,
    },
  });

  return NextResponse.json({ settings });
}
