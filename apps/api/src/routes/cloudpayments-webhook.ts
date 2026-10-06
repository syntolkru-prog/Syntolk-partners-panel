import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { cloudPaymentsSecret, verifyCloudPaymentsNotification } from '../cloudpayments.js';
import { ingestPaymentEvent, PaymentEventError, recordPaymentRefund } from '../payment-events.js';
import { tenantOf } from '../tenancy.js';

const payloadSchema = z.object({
  TransactionId: z.union([z.string(), z.number()]).optional(),
  PaymentTransactionId: z.union([z.string(), z.number()]).optional(),
  Amount: z.coerce.number().nonnegative().optional(),
  Currency: z.string().length(3).optional(),
  InvoiceId: z.string().optional(),
  AccountId: z.string().optional(),
  DateTime: z.string().optional(),
  Data: z.union([z.string(), z.record(z.unknown())]).optional(),
  Id: z.union([z.string(), z.number()]).optional(),
  Description: z.string().optional(),
}).passthrough();

export const cloudPaymentsWebhookRouter = Router();

cloudPaymentsWebhookRouter.post('/webhooks/cloudpayments/:kind', async (req, res) => {
  const kind = req.params.kind;
  if (!['pay', 'refund', 'recurrent', 'fail', 'cancel', 'confirm'].includes(kind)) {
    return res.status(404).json({ error: 'unknown_notification' });
  }

  const secret = cloudPaymentsSecret();
  if (!secret) return res.status(503).json({ error: 'cloudpayments_not_configured' });
  if (!verifyCloudPaymentsNotification(req, secret)) {
    return res.status(401).json({ error: 'invalid_notification_signature' });
  }

  const body = payloadSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ code: 13, error: 'invalid_notification' });

  try {
    if (kind === 'pay' || kind === 'recurrent') await handlePay(req, body.data, kind);
    else if (kind === 'refund') await handleRefund(req, body.data);
    // Fail/Cancel/Confirm/Recurrent update payment state in the future, but
    // never create a commission by themselves. Acknowledge them now so Cloud
    // does not redeliver a notification that has no earning side effect.
    return res.json({ code: 0 });
  } catch (error) {
    if (error instanceof PaymentEventError) {
      const status = error.code === 'invalid_payment_notification' ? 400 : 409;
      return res.status(status).json({ code: 13, error: error.code });
    }
    throw error;
  }
});

async function handlePay(req: Request, payload: z.infer<typeof payloadSchema>, kind: 'pay' | 'recurrent'): Promise<void> {
  const { db, tenantId } = tenantOf(req);
  const data = parseData(payload.Data);
  const userId = payload.AccountId ?? stringValue(data.userId);
  const transactionId = String(payload.TransactionId ?? payload.InvoiceId ?? '');
  if (!userId || !transactionId || payload.Amount == null) {
    throw new PaymentEventError('invalid_payment_notification');
  }

  await ingestPaymentEvent(db, tenantId, {
    userId,
    // Both Pay and Recurrent are successful-payment notifications. They use
    // one idempotency key because some CloudPayments configurations deliver
    // both for the same transaction; this prevents a double commission.
    type: stringValue(data.eventType) ?? 'invoice_paid',
    value: payload.Amount,
    currency: payload.Currency ?? 'RUB',
    externalEventId: `cloud_pay_${transactionId}`,
    metadata: {
      source: 'cloudpayments',
      notificationKind: kind,
      transactionId: payload.TransactionId ?? null,
      invoiceId: payload.InvoiceId ?? null,
      accountId: userId,
      data,
    },
    ts: parseCloudDate(payload.DateTime),
  });
}

async function handleRefund(req: Request, payload: z.infer<typeof payloadSchema>): Promise<void> {
  const { db, tenantId } = tenantOf(req);
  const paymentTransactionId = String(payload.PaymentTransactionId ?? '');
  const refundTransactionId = String(payload.TransactionId ?? '');
  if (!paymentTransactionId || !refundTransactionId || payload.Amount == null) {
    throw new PaymentEventError('invalid_refund_amount');
  }

  await recordPaymentRefund(db, tenantId, {
    originalExternalEventId: `cloud_pay_${paymentTransactionId}`,
    refundExternalEventId: `cloud_refund_${refundTransactionId}`,
    amount: payload.Amount,
    currency: payload.Currency,
    metadata: {
      source: 'cloudpayments',
      transactionId: payload.TransactionId ?? null,
      paymentTransactionId: payload.PaymentTransactionId ?? null,
      invoiceId: payload.InvoiceId ?? null,
      data: parseData(payload.Data),
    },
    ts: parseCloudDate(payload.DateTime),
  });
}

function parseData(data: unknown): Record<string, unknown> {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseCloudDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
