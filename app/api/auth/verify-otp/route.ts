import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, requestIpHash } from "@/lib/rate-limit";
import { setSessionCookie, signSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const ipHash = requestIpHash(request.headers);
  const rate = await checkRateLimit(ipHash, "auth/verify-otp", 5, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });

  const body = await request.json().catch(() => null) as Record<string,unknown> | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const code = String(body?.code ?? "").trim();
  if (!email || !/^\d{6}$/.test(code)) return NextResponse.json({ error: "Invalid code" }, { status: 400 });

  const otp = await prisma.otpCode.findFirst({ where: { email, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!otp || otp.attempts >= 5) return NextResponse.json({ error: "Code expired or invalid" }, { status: 400 });

  const hash = createHash("sha256").update(`${process.env.JWT_SECRET ?? ""}:${email}:${code}`).digest("hex");
  if (hash !== otp.codeHash) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return NextResponse.json({ error: "Code expired or invalid" }, { status: 400 });
  }

  const account = await prisma.account.update({
    where: { email },
    data: { status: "ACTIVE", emailVerifiedAt: new Date(), lastLoginAt: new Date() },
    include: { partner: true },
  });
  await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });

  const token = await signSession({ accountId: account.id, role: account.role, email: account.email, partnerId: account.partnerId });
  await setSessionCookie(token);
  return NextResponse.json({ success: true, role: account.role, partnerStatus: account.partner?.status ?? null });
}
