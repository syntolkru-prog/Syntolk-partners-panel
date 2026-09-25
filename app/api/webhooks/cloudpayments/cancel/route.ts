import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cloudPaymentsEventKey, parseCloudPaymentsBody, verifyCloudPaymentsSignature } from "@/lib/cloudpayments";
import { triggerOutgoingWebhook } from "@/lib/outgoing-webhooks";

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
  const amount = Number(payload.Amount ?? 0);

  if (!transactionId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ code: 13 }, { status: 400 });
  }

  const eventKey = cloudPaymentsEventKey("cancel", payload);

  const result = await prisma.$transaction(async (tx) => {
    const existingEvent = await tx.webhookEvent.findUnique({ where: { eventKey } });
    if (existingEvent?.processedAt) return { duplicate: true };

    const event = existingEvent ?? await tx.webhookEvent.create({
      data: { provider: "cloudpayments", eventKey, eventType: "cancel", payload: payload as any },
    });

    const payment = await tx.payment.findUnique({
      where: { externalTransactionId: transactionId },
      include: { referral: { include: { partner: true } } },
    });

    if (!payment) {
      await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return { ignored: true };
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "CANCELED" },
    });

    const rate = payment.referral.partner.commissionRate;
    const adjustmentKey = `cloudpayments:cancel:${transactionId}`;
    const adjustmentAmount = -Math.min(amount, Number(payment.amount)) * (Number(rate) / 100);

    await tx.commission.upsert({
      where: { idempotencyKey: adjustmentKey },
      update: {},
      create: {
        partnerId: payment.referral.partnerId,
        paymentId: payment.id,
        kind: "REFUND",
        idempotencyKey: adjustmentKey,
        amount: adjustmentAmount,
        rate,
        status: "APPROVED",
        availableAt: new Date(),
        approvedAt: new Date(),
        note: "Корректировка комиссии из-за отмены CloudPayments",
      },
    });

    await tx.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });

    return { duplicate: false, partnerId: payment.referral.partnerId, paymentId: payment.id, adjustmentAmount };
  });

  if ("partnerId" in result && result.partnerId) {
    await prisma.notification.create({ data: { partnerId: result.partnerId as string, type: "PAYMENT_CANCELED", title: "Оплата отменена", message: `Комиссия скорректирована на ${Number(result.adjustmentAmount).toLocaleString("ru-RU")} ₽`, metadata: { paymentId: result.paymentId } } }).catch(()=>null);
    await triggerOutgoingWebhook("payment.canceled", result).catch(()=>null);
  }
  return NextResponse.json({ code: 0, ...result });
}
