import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/** CloudPayments signs notification bodies with the merchant API secret. */
export function cloudPaymentsSecret(): string | null {
  const secret = process.env.CLOUDPAYMENTS_WEBHOOK_SECRET ?? process.env.CLOUDPAYMENTS_API_SECRET ?? '';
  return secret.length > 0 ? secret : null;
}

export function verifyCloudPaymentsNotification(req: Request, secret: string): boolean {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) return false;

  const candidates = [req.header('x-content-hmac'), req.header('content-hmac')]
    .filter((value): value is string => !!value)
    .map((value) => value.trim())
    .filter(Boolean);
  if (candidates.length === 0) return false;

  const digest = createHmac('sha256', secret).update(rawBody).digest('base64');
  return candidates.some((candidate) => safeEqual(candidate, digest));
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
