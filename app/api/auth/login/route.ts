import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, requestIpHash } from "@/lib/rate-limit";
import { setSessionCookie, signSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const ipHash = requestIpHash(request.headers);
  const rate = await checkRateLimit(ipHash, "auth/login", 5, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });

  const body = await request.json().catch(() => null) as Record<string,unknown> | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  const account = await prisma.account.findUnique({ where: { email }, include: { partner: true } });
  if (!account?.passwordHash || account.status !== "ACTIVE") return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  if (!await compare(password, account.passwordHash)) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

  await prisma.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  const token = await signSession({ accountId: account.id, role: account.role, email: account.email, partnerId: account.partnerId });
  await setSessionCookie(token);
  return NextResponse.json({ success: true, role: account.role, partnerStatus: account.partner?.status ?? null });
}
