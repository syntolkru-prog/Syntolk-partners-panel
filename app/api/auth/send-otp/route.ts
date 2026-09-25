import { createHash, randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, requestIpHash } from "@/lib/rate-limit";
import { sendTemplatedEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  const ipHash = requestIpHash(request.headers);
  const rate = await checkRateLimit(ipHash, "auth/send-otp", 3, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });

  const body = await request.json().catch(() => null) as Record<string,unknown> | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });

  const account = await prisma.account.findUnique({ where: { email } });
  if (!account) return NextResponse.json({ success: true });

  const code = String(randomInt(100000, 999999));
  const codeHash = createHash("sha256").update(`${process.env.JWT_SECRET ?? ""}:${email}:${code}`).digest("hex");
  await prisma.otpCode.create({ data: { email, codeHash, expiresAt: new Date(Date.now() + 10 * 60_000) } });

  await sendTemplatedEmail({
    type: "WELCOME",
    to: email,
    recipientId: account.partnerId,
    variables: { name: account.name, code },
    fallbackSubject: "Код входа Syntolk Partners",
    fallbackBody: `<h2>Syntolk Partners</h2><p>Код подтверждения: <b style="font-size:24px">{{code}}</b></p><p>Код действует 10 минут.</p>`,
  });

  return NextResponse.json({ success: true });
}
