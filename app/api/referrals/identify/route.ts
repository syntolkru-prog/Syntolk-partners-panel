import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSyntolkInternalKey } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const authError = requireSyntolkInternalKey(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const clickId = String(body?.clickId ?? "").trim();
  const externalUserId = String(body?.externalUserId ?? "").trim();

  if (!clickId || !externalUserId) {
    return NextResponse.json({ error: "clickId and externalUserId are required" }, { status: 400 });
  }

  const existing = await prisma.referral.findUnique({ where: { externalUserId } });
  if (existing) {
    return NextResponse.json({ referral: existing, attributed: false, reason: "already_attributed" });
  }

  const click = await prisma.referralClick.findUnique({
    where: { clickId },
    include: { partner: true },
  });

  if (!click || click.partner.status !== "ACTIVE") {
    return NextResponse.json({ error: "Referral click not found or partner inactive" }, { status: 404 });
  }

  const settings = await prisma.programSettings.upsert({ where: { id: "default" }, create: {}, update: {} });
  if (settings.selfReferralBlocked && click.partner.syntolkUserId && click.partner.syntolkUserId === externalUserId) {
    return NextResponse.json({ error: "Self-referral is not allowed" }, { status: 403 });
  }

  const ageMs = Date.now() - click.createdAt.getTime();
  const maxAgeMs = click.partner.cookieDays * 24 * 60 * 60 * 1000;
  if (ageMs > maxAgeMs) {
    return NextResponse.json({ error: "Referral attribution window expired" }, { status: 410 });
  }

  const referral = await prisma.referral.create({
    data: {
      partnerId: click.partnerId,
      externalUserId,
      firstClickId: click.clickId,
      status: "REGISTERED",
      source: click.source,
      medium: click.medium,
      campaign: click.campaign,
      registeredAt: new Date(),
    },
  });

  return NextResponse.json({ referral, attributed: true });
}
