import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cloudPaymentsEventKey, parseCloudPaymentsBody, verifyCloudPaymentsSignature } from "@/lib/cloudpayments";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.CLOUDPAYMENTS_API_SECRET ?? "";
  const signatures = {
    contentHmac: request.headers.get("content-hmac"),
    xContentHmac: request.headers.get("x-content-hmac"),
  };

  if (!verifyCloudPaymentsSignature(rawBody, signatures, secret)) {
    return NextResponse.json({ code: 13 }, { status: 401 });
  }

  const payload = parseCloudPaymentsBody(rawBody, request.headers.get("content-type"));
  const transactionId = String(payload.TransactionId ?? "");
  const accountId = String(payload.AccountId ?? "");
  const amount = Number(payload.Amount ?? 0);
  const currency = String(payload.Currency ?? "RUB");
  const subscriptionId = payload.SubscriptionId ? String(payload.SubscriptionId) : null;
  const invoiceId = payload.InvoiceId ? String(payload.InvoiceId) : null;

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
        invoiceId,
        paidAt: new Date(),
        rawPayload: payload,
      },
    });

    const settings = await tx.programSettings.upsert({
      where: { id: "default" },
      create: {},
      update: {},
    });
    const commissionAmount = amount * (Number(referral.partner.commissionRate) / 100);
    const commissionKey = `cloudpayments:earning:${transactionId}`;

    await tx.commission.upsert({
      where: { idempotencyKey: commissionKey },
      update: {},
      create: {
        partnerId: referral.partnerId,
        paymentId: payment.id,
        kind: "EARNING",
        idempotencyKey: commissionKey,
        amount: commissionAmount,
        rate: referral.partner.commissionRate,
        availableAt: new Date(Date.now() + settings.commissionHoldDays * 24 * 60 * 60 * 1000),
      },
    });

    await tx.referral.update({
      where: { id: referral.id },
      data: { status: "ACTIVE" },
    });

    await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { duplicate: false };
  });

  return NextResponse.json({ code: 0, ...result });
}
