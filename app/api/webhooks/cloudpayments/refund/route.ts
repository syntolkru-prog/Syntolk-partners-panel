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
      data: { provider: "cloudpayments", eventKey, eventType: "refund", payload },
    });

    const payment = await tx.payment.findUnique({
      where: { externalTransactionId: originalTransactionId },
      include: { commissions: true, refunds: true },
    });

    if (!payment) {
      await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return { ignored: true };
    }

    await tx.refund.upsert({
      where: { externalTransactionId: refundTransactionId },
      update: {},
      create: {
        paymentId: payment.id,
        externalTransactionId: refundTransactionId,
        amount,
        refundedAt: new Date(),
        rawPayload: payload,
      },
    });

    const refundedBefore = payment.refunds.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalRefunded = Math.min(Number(payment.amount), refundedBefore + amount);
    const fullyRefunded = totalRefunded >= Number(payment.amount);

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    });

    for (const commission of payment.commissions) {
      const retained = Math.max(0, Number(payment.amount) - totalRefunded);
      const correctedAmount = retained * (Number(commission.rate) / 100);

      await tx.commission.update({
        where: { id: commission.id },
        data: {
          amount: correctedAmount,
          status: correctedAmount === 0 ? "REVERSED" : commission.status,
        },
      });
    }

    await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { duplicate: false };
  });

  return NextResponse.json({ code: 0, ...result });
}
