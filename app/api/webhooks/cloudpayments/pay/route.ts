import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cloudPaymentsEventKey, parseCloudPaymentsBody, verifyCloudPaymentsSignature } from "@/lib/cloudpayments";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.CLOUDPAYMENTS_API_SECRET ?? "";
  const signature = request.headers.get("x-content-hmac") ?? request.headers.get("content-hmac");

  if (!verifyCloudPaymentsSignature(rawBody, signature, secret)) {
    return NextResponse.json({ code: 13 }, { status: 401 });
  }

  const payload = parseCloudPaymentsBody(rawBody, request.headers.get("content-type"));
  const transactionId = String(payload.TransactionId ?? "");
  const accountId = String(payload.AccountId ?? "");
  const amount = Number(payload.Amount ?? 0);
  const currency = String(payload.Currency ?? "RUB");
  const subscriptionId = payload.SubscriptionId ? String(payload.SubscriptionId) : null;

  if (!transactionId || !accountId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ code: 13 }, { status: 400 });
  }

  const eventKey = cloudPaymentsEventKey("pay", payload);

  const result = await prisma.$transaction(async (tx) => {
    const existingEvent = await tx.webhookEvent.findUnique({ where: { eventKey } });
    if (existingEvent?.processedAt) return { duplicate: true };

    const event = existingEvent ?? await tx.webhookEvent.create({
      data: { provider: "cloudpayments", eventKey, eventType: "pay", payload },
    });

    const referral = await tx.referral.findUnique({
      where: { externalUserId: accountId },
      include: { partner: true },
    });

    if (!referral || referral.partner.status !== "ACTIVE") {
      await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return { ignored: true };
    }

    const payment = await tx.payment.upsert({
      where: { externalTransactionId: transactionId },
      update: {},
      create: {
        externalTransactionId: transactionId,
        referralId: referral.id,
        amount,
        currency,
        subscriptionId,
        paidAt: new Date(),
        rawPayload: payload,
      },
    });

    const commissionAmount = amount * (Number(referral.partner.commissionRate) / 100);

    await tx.commission.upsert({
      where: { partnerId_paymentId: { partnerId: referral.partnerId, paymentId: payment.id } },
      update: {},
      create: {
        partnerId: referral.partnerId,
        paymentId: payment.id,
        amount: commissionAmount,
        rate: referral.partner.commissionRate,
        availableAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

    await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { duplicate: false };
  });

  return NextResponse.json({ code: 0, ...result });
}
