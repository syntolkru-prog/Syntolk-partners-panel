import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, requestIpHash } from "@/lib/rate-limit";
import { sendTemplatedEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  const ipHash = requestIpHash(request.headers);
  const rate = await checkRateLimit(ipHash, "auth/register", 3, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });

  const body = await request.json().catch(() => null) as Record<string,unknown> | null;
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const code = String(body?.referralCode ?? "").trim().toLowerCase() || `p-${randomBytes(5).toString("hex")}`;

  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10) {
    return NextResponse.json({ error: "Invalid registration data" }, { status: 400 });
  }

  const exists = await prisma.account.findUnique({ where: { email } });
  if (exists) return NextResponse.json({ error: "Account already exists" }, { status: 409 });

  const settings = await prisma.programSettings.upsert({ where: { id: "default" }, create: {}, update: {} });
  const passwordHash = await hash(password, 12);

  const result = await prisma.$transaction(async tx => {
    const partner = await tx.partner.create({
      data: {
        name, email, code,
        status: settings.requireApproval ? "PENDING" : "ACTIVE",
        commissionRate: settings.baseCommissionRate,
        cookieDays: settings.cookieDays,
      },
    });
    const account = await tx.account.create({
      data: { partnerId: partner.id, email, name, passwordHash, role: "PARTNER", status: "PENDING" },
    });
    return { partner, account };
  });

  await sendTemplatedEmail({
    type: "PARTNER_APPLICATION",
    to: email,
    recipientId: result.partner.id,
    variables: { name },
    fallbackSubject: "Заявка в Syntolk Partners получена",
    fallbackBody: `<h2>Здравствуйте, {{name}}</h2><p>Заявка в партнёрскую программу Syntolk создана. Подтвердите email кодом из следующего письма.</p>`,
  }).catch(()=>null);

  return NextResponse.json({ success: true, accountId: result.account.id, partnerStatus: result.partner.status, verificationRequired: true }, { status: 201 });
}
