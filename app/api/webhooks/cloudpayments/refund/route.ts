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
  const refundTransactionId = String(payload.TransactionId ?? "");
  const originalTransactionId = String(payload.PaymentTransactionId ?? payload.OriginalTransactionId ?? "");
  const amount = Number(payload.Amount ?? 0);

  if (!refundTransactionId || !originalTransactionId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ code: 13 }, { status: 400 });
  }

  const eventKey = cloudPaymentsEventKey("refund", payload);

  const result = await prisma.$transaction(async (tx) => {
    const existingEvent = await tx.webhookEvent.findUnique({ where: { eventKey } });
    if (existingEvent?.processedAt) return { duplicate: true };

    const event = existingEvent ?? await tx.webhookEvent.create({
      data: { provider: "cloudpayments", eventKey, eventType: "refund", payload: payload as any },
    });

    const payment = await tx.payment.findUnique({
      where: { externalTransactionId: originalTransactionId },
      include: {
        referral: { include: { partner: true } },
        refunds: true,
      },
    });

    if (!payment) {
      await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return { ignored: true };
    }

    const refund = await tx.refund.upsert({
      where: { externalTransactionId: refundTransactionId },
      update: {},
      create: {
        paymentId: payment.id,
        externalTransactionId: refundTransactionId,
        amount,
        refundedAt: new Date(),
        rawPayload: payload as any,
      },
    });

    const refundedBefore = payment.refunds.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalRefunded = Math.min(Number(payment.amount), refundedBefore + amount);
    const fullyRefunded = totalRefunded >= Number(payment.amount);

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    });

    const rate = payment.referral.partner.commissionRate;
    const adjustmentAmount = -Math.min(amount, Number(payment.amount)) * (Number(rate) / 100);
    const adjustmentKey = `cloudpayments:refund:${refundTransactionId}`;

    await tx.commission.upsert({
      where: { idempotencyKey: adjustmentKey },
      update: {},
      create: {
        partnerId: payment.referral.partnerId,
        paymentId: payment.id,
        refundId: refund.id,
        kind: "REFUND",
        idempotencyKey: adjustmentKey,
        amount: adjustmentAmount,
        rate,
        status: "APPROVED",
        availableAt: new Date(),
        approvedAt: new Date(),
        note: "Корректировка комиссии из-за возврата CloudPayments",
      },
    });

    await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { duplicate: false };
  });

  return NextResponse.json({ code: 0, ...result });
}
