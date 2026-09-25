import { randomUUID, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function hashIp(value: string) {
  const salt = process.env.REFERRAL_IP_HASH_SALT ?? "development-only";
  return createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const code = String(body?.code ?? "").trim();

  if (!code) return NextResponse.json({ error: "Referral code is required" }, { status: 400 });

  const partner = await prisma.partner.findUnique({ where: { code } });
  if (!partner || partner.status !== "ACTIVE") {
    return NextResponse.json({ error: "Referral code is invalid or inactive" }, { status: 404 });
  }

  const clickId = randomUUID();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip");
  const ip = forwarded || realIp || "unknown";

  await prisma.referralClick.create({
    data: {
      clickId,
      partnerId: partner.id,
      landingUrl: body?.landingUrl ? String(body.landingUrl) : null,
      referer: body?.referer ? String(body.referer) : null,
      userAgent: request.headers.get("user-agent"),
      ipHash: hashIp(ip),
      source: body?.source ? String(body.source) : null,
      medium: body?.medium ? String(body.medium) : null,
      campaign: body?.campaign ? String(body.campaign) : null,
      content: body?.content ? String(body.content) : null,
      term: body?.term ? String(body.term) : null,
    },
  });

  return NextResponse.json({
    clickId,
    partner: { code: partner.code, name: partner.name },
    expiresInDays: partner.cookieDays,
  });
}
